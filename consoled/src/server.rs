//! Axum HTTP and WebSocket server for the living-room console link.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::connect_info::ConnectInfo;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Request, State};
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN,
};
use axum::http::{HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use tokio::sync::broadcast::error::RecvError;
use tokio::time::{sleep, timeout, Instant};

use crate::auth::{PairResult, PairingService};
use crate::hub::Hub;
use crate::protocol::{Channel, ClientFrame, Role, ServerFrame};

pub const PORT: u16 = 43_919;
const IDLE_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Clone)]
pub struct AppState {
    pairing: Arc<PairingService>,
    hub: Arc<Hub>,
}

impl AppState {
    pub fn new(pairing: Arc<PairingService>, hub: Arc<Hub>) -> Self {
        Self { pairing, hub }
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health).options(preflight))
        .route("/pair", post(pair).options(preflight))
        .route("/pair-info", get(pair_info).options(preflight))
        .route("/ws", get(ws_upgrade).options(preflight))
        .layer(middleware::from_fn(add_cors_headers))
        .with_state(state)
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true}))
}

#[derive(Deserialize)]
struct PairRequest {
    pin: String,
}

async fn pair(State(state): State<AppState>, Json(request): Json<PairRequest>) -> Response {
    match state.pairing.pair(&request.pin) {
        PairResult::Token(token) => {
            tracing::info!("phone paired");
            Json(serde_json::json!({"token": token})).into_response()
        }
        PairResult::Forbidden => {
            tracing::warn!("phone pairing PIN rejected");
            StatusCode::FORBIDDEN.into_response()
        }
        PairResult::RateLimited => {
            tracing::warn!("phone pairing attempt cap reached");
            StatusCode::TOO_MANY_REQUESTS.into_response()
        }
    }
}

async fn pair_info(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
) -> Response {
    if !peer.ip().is_loopback() {
        tracing::warn!(%peer, "non-loopback pair-info request rejected");
        return StatusCode::FORBIDDEN.into_response();
    }
    Json(serde_json::json!({
        "pin": state.pairing.pin(),
        "port": PORT
    }))
    .into_response()
}

async fn preflight() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn add_cors_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type"),
    );
    response
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state, peer))
}

async fn send_frame(socket: &mut WebSocket, frame: ServerFrame) -> bool {
    let text = match serde_json::to_string(&frame) {
        Ok(text) => text,
        Err(error) => {
            tracing::error!(%error, "failed to serialize server frame");
            return true;
        }
    };
    socket.send(Message::Text(text.into())).await.is_ok()
}

async fn reject_auth(socket: &mut WebSocket, reason: impl Into<String>) {
    let _ = send_frame(
        socket,
        ServerFrame::AuthErr {
            reason: reason.into(),
        },
    )
    .await;
}

async fn authenticate(socket: &mut WebSocket, state: &AppState, peer: SocketAddr) -> Option<Role> {
    loop {
        let incoming = match timeout(IDLE_TIMEOUT, socket.recv()).await {
            Err(_) => {
                reject_auth(socket, "authentication timed out").await;
                return None;
            }
            Ok(None) | Ok(Some(Err(_))) => return None,
            Ok(Some(Ok(message))) => message,
        };

        let text = match incoming {
            // Transport control frames are not application protocol frames.
            Message::Ping(_) | Message::Pong(_) => continue,
            Message::Text(text) => text,
            Message::Close(_) => return None,
            Message::Binary(_) => {
                reject_auth(socket, "expected JSON text auth frame").await;
                return None;
            }
        };

        let frame = match serde_json::from_str::<ClientFrame>(text.as_str()) {
            Ok(frame) => frame,
            Err(_) => {
                reject_auth(socket, "invalid auth frame").await;
                return None;
            }
        };

        let ClientFrame::Auth { role, token } = frame else {
            reject_auth(socket, "first frame must be auth").await;
            return None;
        };

        let accepted = match role {
            Role::Tv => peer.ip().is_loopback(),
            Role::Phone => token
                .as_deref()
                .map(|token| state.pairing.verify_phone_token(token))
                .unwrap_or(false),
        };

        if !accepted {
            let reason = match role {
                Role::Tv => "tv role requires a loopback peer",
                Role::Phone => "invalid phone token",
            };
            reject_auth(socket, reason).await;
            return None;
        }

        if !send_frame(socket, ServerFrame::AuthOk).await {
            return None;
        }
        return Some(role);
    }
}

async fn handle_socket(mut socket: WebSocket, state: AppState, peer: SocketAddr) {
    static CONNECTION_ID: AtomicU64 = AtomicU64::new(1);
    let connection_id = CONNECTION_ID.fetch_add(1, Ordering::Relaxed);
    tracing::info!(connection_id, %peer, "connection opened");

    let Some(role) = authenticate(&mut socket, &state, peer).await else {
        tracing::warn!(connection_id, %peer, "connection closed before authentication");
        return;
    };
    tracing::info!(connection_id, ?role, "connection authenticated");

    main_loop(socket, state, role, connection_id, peer).await;
}

async fn main_loop(
    mut socket: WebSocket,
    state: AppState,
    role: Role,
    connection_id: u64,
    peer: SocketAddr,
) {
    let mut live = state.hub.subscribe_live();
    // The value is the connection's delivered floor for that channel. Besides
    // deduping the replay/live handoff, it prevents queued pre-subscription
    // input/text broadcasts from leaking into a new live-only subscription.
    let mut subscribed: HashMap<Channel, u64> = HashMap::new();
    let idle = sleep(IDLE_TIMEOUT);
    tokio::pin!(idle);

    let close_reason = loop {
        tokio::select! {
            _ = &mut idle => {
                break "idle timeout";
            }
            incoming = socket.recv() => {
                let message = match incoming {
                    None => break "stream ended",
                    Some(Err(error)) => {
                        tracing::debug!(connection_id, %error, "websocket read error");
                        break "read error";
                    }
                    Some(Ok(message)) => message,
                };
                idle.as_mut().reset(Instant::now() + IDLE_TIMEOUT);

                match message {
                    Message::Close(_) => break "client close",
                    Message::Ping(_) | Message::Pong(_) => continue,
                    Message::Binary(_) => {
                        tracing::debug!(connection_id, "ignored binary websocket frame");
                        continue;
                    }
                    Message::Text(text) => {
                        let frame = match serde_json::from_str::<ClientFrame>(text.as_str()) {
                            Ok(frame) => frame,
                            Err(error) => {
                                tracing::debug!(connection_id, %error, "ignored invalid client frame");
                                continue;
                            }
                        };
                        if !handle_client_frame(
                            &mut socket,
                            &state,
                            role,
                            connection_id,
                            frame,
                            &mut subscribed,
                        )
                        .await
                        {
                            break "write error";
                        }
                    }
                }
            }
            received = live.recv() => {
                match received {
                    Ok(event) => {
                        if event.source_connection == connection_id {
                            continue;
                        }
                        let Some(floor) = subscribed.get_mut(&event.chan) else {
                            continue;
                        };
                        if event.seq <= *floor {
                            continue;
                        }
                        let frame = ServerFrame::Event {
                            chan: event.chan.as_str(),
                            seq: event.seq,
                            payload: event.payload,
                            replay: None,
                        };
                        if !send_frame(&mut socket, frame).await {
                            break "write error";
                        }
                        *floor = event.seq;
                    }
                    Err(RecvError::Lagged(skipped)) => {
                        // State clients recover by re-subscribing from their
                        // floor; input/text are deliberately live-only.
                        tracing::warn!(connection_id, skipped, "connection lagged live fanout");
                    }
                    Err(RecvError::Closed) => break "hub closed",
                }
            }
        }
    };

    tracing::info!(connection_id, %peer, close_reason, "connection closed");
}

async fn handle_client_frame(
    socket: &mut WebSocket,
    state: &AppState,
    role: Role,
    connection_id: u64,
    frame: ClientFrame,
    subscribed: &mut HashMap<Channel, u64>,
) -> bool {
    match frame {
        ClientFrame::Sub { chan, after } => {
            let Some(chan) = Channel::parse(&chan) else {
                tracing::debug!(connection_id, channel = %chan, "ignored unknown subscription");
                return true;
            };

            let (replay, latest) = state.hub.replay(chan, after);
            for event in replay {
                if !send_frame(
                    socket,
                    ServerFrame::Event {
                        chan: chan.as_str(),
                        seq: event.seq,
                        payload: event.payload,
                        replay: Some(true),
                    },
                )
                .await
                {
                    return false;
                }
            }
            // The sentinel is sent before the channel joins live delivery.
            if !send_frame(
                socket,
                ServerFrame::Synced {
                    chan: chan.as_str(),
                    seq: latest,
                },
            )
            .await
            {
                return false;
            }
            subscribed.insert(chan, latest);
            tracing::info!(
                connection_id,
                channel = chan.as_str(),
                after,
                latest,
                "channel subscribed"
            );
            true
        }
        ClientFrame::Send { chan, payload } => {
            let Some(chan) = Channel::parse(&chan) else {
                tracing::debug!(connection_id, channel = %chan, "ignored send to unknown channel");
                return true;
            };
            if !payload.is_object() {
                tracing::debug!(
                    connection_id,
                    channel = chan.as_str(),
                    "ignored non-object payload"
                );
                return true;
            }
            if !role_can_publish(role, chan) {
                tracing::warn!(
                    connection_id,
                    ?role,
                    channel = chan.as_str(),
                    "role attempted disallowed publish"
                );
                return true;
            }

            let seq = state.hub.publish(connection_id, chan, payload);
            tracing::debug!(
                connection_id,
                channel = chan.as_str(),
                seq,
                "event published"
            );
            true
        }
        ClientFrame::Ping => send_frame(socket, ServerFrame::Pong).await,
        ClientFrame::Auth { .. } => {
            tracing::debug!(connection_id, "ignored repeated auth frame");
            true
        }
    }
}

fn role_can_publish(role: Role, chan: Channel) -> bool {
    matches!(
        (role, chan),
        (Role::Tv, Channel::State) | (Role::Phone, Channel::Input) | (Role::Phone, Channel::Text)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_publish_permissions_match_the_contract_directions() {
        assert!(role_can_publish(Role::Tv, Channel::State));
        assert!(!role_can_publish(Role::Tv, Channel::Input));
        assert!(!role_can_publish(Role::Tv, Channel::Text));
        assert!(!role_can_publish(Role::Phone, Channel::State));
        assert!(role_can_publish(Role::Phone, Channel::Input));
        assert!(role_can_publish(Role::Phone, Channel::Text));
    }
}
