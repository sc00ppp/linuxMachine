mod auth;
mod config;
mod hub;
mod launch;
mod protocol;
mod registry;
mod resolve;
mod ring;
mod server;
mod ytdlp;

use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;

use auth::PairingService;
use hub::Hub;
use server::{AppState, PORT};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt().with_target(false).init();

    let pairing = Arc::new(PairingService::new());
    let pin = pairing.pin();

    // Keep the PIN on stdout so a launcher can capture it independently of
    // structured logs, and make it unmistakable during manual development.
    println!();
    println!("================================");
    println!("  CONSOLED PAIRING PIN: {pin}");
    println!("================================");
    println!();

    let state = AppState::new(pairing, Arc::new(Hub::new(64, 256)));
    state.start_background_tasks();
    let app = server::router(state);
    let addr = SocketAddr::from((Ipv4Addr::UNSPECIFIED, PORT));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tracing::info!(%addr, "consoled listening");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}
