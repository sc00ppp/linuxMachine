//! The complete Round 3 JSON wire vocabulary.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Tv,
    Phone,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "t")]
pub enum ClientFrame {
    #[serde(rename = "auth")]
    Auth {
        role: Role,
        #[serde(default)]
        token: Option<String>,
    },
    #[serde(rename = "sub")]
    Sub {
        chan: String,
        #[serde(default)]
        after: Option<u64>,
    },
    #[serde(rename = "send")]
    Send { chan: String, payload: Value },
    #[serde(rename = "ping")]
    Ping,
}

#[derive(Debug, Serialize)]
#[serde(tag = "t")]
pub enum ServerFrame {
    #[serde(rename = "authOk")]
    AuthOk,
    #[serde(rename = "authErr")]
    AuthErr { reason: String },
    #[serde(rename = "event")]
    Event {
        chan: &'static str,
        seq: u64,
        payload: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        replay: Option<bool>,
    },
    #[serde(rename = "synced")]
    Synced { chan: &'static str, seq: u64 },
    #[serde(rename = "pong")]
    Pong,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Channel {
    State,
    Input,
    Text,
}

impl Channel {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "state" => Some(Self::State),
            "input" => Some(Self::Input),
            "text" => Some(Self::Text),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::State => "state",
            Self::Input => "input",
            Self::Text => "text",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_names_match_the_contract() {
        let auth = serde_json::to_value(ServerFrame::AuthOk).unwrap();
        assert_eq!(auth, serde_json::json!({"t": "authOk"}));

        let event = serde_json::to_value(ServerFrame::Event {
            chan: "state",
            seq: 7,
            payload: serde_json::json!({"mode": "home"}),
            replay: None,
        })
        .unwrap();
        assert_eq!(
            event,
            serde_json::json!({
                "t": "event",
                "chan": "state",
                "seq": 7,
                "payload": {"mode": "home"}
            })
        );
    }

    #[test]
    fn replay_is_only_serialized_when_true_is_supplied() {
        let event = serde_json::to_value(ServerFrame::Event {
            chan: "state",
            seq: 1,
            payload: serde_json::json!({}),
            replay: Some(true),
        })
        .unwrap();
        assert_eq!(event["replay"], true);
    }
}
