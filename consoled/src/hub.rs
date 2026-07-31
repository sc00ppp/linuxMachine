//! Live fanout plus the replay ring for the `state` channel.
//!
//! The publish locks preserve the donor hub's important ordering invariant:
//! sequence assignment, ring append, and broadcast happen as one serialized
//! operation, so live delivery order cannot disagree with replay order.

use std::sync::Mutex;

use serde_json::Value;
use tokio::sync::broadcast;

use crate::protocol::Channel;
use crate::ring::HistoryRing;

#[derive(Debug, Clone)]
pub struct HubEvent {
    pub source_connection: u64,
    pub chan: Channel,
    pub seq: u64,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReplayEvent {
    pub seq: u64,
    pub payload: Value,
}

#[derive(Default)]
struct LiveSequences {
    input: u64,
    text: u64,
}

impl LiveSequences {
    fn current(&self, chan: Channel) -> u64 {
        match chan {
            Channel::Input => self.input,
            Channel::Text => self.text,
            Channel::State => unreachable!("state sequence belongs to the ring"),
        }
    }

    fn next(&mut self, chan: Channel) -> u64 {
        let sequence = match chan {
            Channel::Input => &mut self.input,
            Channel::Text => &mut self.text,
            Channel::State => unreachable!("state sequence belongs to the ring"),
        };
        *sequence = sequence.checked_add(1).expect("live sequence exhausted");
        *sequence
    }
}

pub struct Hub {
    live: broadcast::Sender<HubEvent>,
    state_ring: HistoryRing<Channel, Value>,
    state_publish_lock: Mutex<()>,
    live_sequences: Mutex<LiveSequences>,
}

impl Hub {
    pub fn new(state_ring_cap: usize, broadcast_depth: usize) -> Self {
        let (live, _) = broadcast::channel(broadcast_depth);
        Self {
            live,
            state_ring: HistoryRing::new(state_ring_cap),
            state_publish_lock: Mutex::new(()),
            live_sequences: Mutex::new(LiveSequences::default()),
        }
    }

    pub fn subscribe_live(&self) -> broadcast::Receiver<HubEvent> {
        self.live.subscribe()
    }

    /// Publish one event, recording `state` and keeping the other channels live.
    pub fn publish(&self, source_connection: u64, chan: Channel, payload: Value) -> u64 {
        match chan {
            Channel::State => {
                let _guard = self
                    .state_publish_lock
                    .lock()
                    .expect("state publish lock poisoned");
                let seq = self.state_ring.append(chan, payload.clone());
                let _ = self.live.send(HubEvent {
                    source_connection,
                    chan,
                    seq,
                    payload,
                });
                seq
            }
            Channel::Input | Channel::Text => {
                let mut sequences = self
                    .live_sequences
                    .lock()
                    .expect("live sequence lock poisoned");
                let seq = sequences.next(chan);
                let _ = self.live.send(HubEvent {
                    source_connection,
                    chan,
                    seq,
                    payload,
                });
                seq
            }
        }
    }

    /// Snapshot replay before a connection joins live delivery.
    ///
    /// Live-only channels report their current top sequence but no events. This
    /// lets a new subscriber ignore broadcasts queued before it subscribed.
    pub fn replay(&self, chan: Channel, after: Option<u64>) -> (Vec<ReplayEvent>, u64) {
        match chan {
            Channel::State => {
                let (items, latest) = self.state_ring.since(&chan, after);
                (
                    items
                        .into_iter()
                        .map(|item| ReplayEvent {
                            seq: item.seq,
                            payload: item.item,
                        })
                        .collect(),
                    latest,
                )
            }
            Channel::Input | Channel::Text => {
                let latest = self
                    .live_sequences
                    .lock()
                    .expect("live sequence lock poisoned")
                    .current(chan);
                (Vec::new(), latest)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_is_replayed_after_the_requested_floor() {
        let hub = Hub::new(64, 16);
        hub.publish(1, Channel::State, serde_json::json!({"n": 1}));
        hub.publish(1, Channel::State, serde_json::json!({"n": 2}));
        let (events, latest) = hub.replay(Channel::State, Some(1));
        assert_eq!(
            events,
            vec![ReplayEvent {
                seq: 2,
                payload: serde_json::json!({"n": 2})
            }]
        );
        assert_eq!(latest, 2);
    }

    #[test]
    fn live_channels_keep_a_floor_but_no_replay() {
        let hub = Hub::new(64, 16);
        hub.publish(2, Channel::Input, serde_json::json!({"kind": "accept"}));
        hub.publish(2, Channel::Input, serde_json::json!({"kind": "back"}));
        let (events, latest) = hub.replay(Channel::Input, None);
        assert!(events.is_empty());
        assert_eq!(latest, 2);
    }

    #[tokio::test]
    async fn broadcasts_carry_the_source_for_no_echo_filtering() {
        let hub = Hub::new(64, 16);
        let mut receiver = hub.subscribe_live();
        hub.publish(42, Channel::Text, serde_json::json!({"text": "hi"}));
        let event = receiver.recv().await.unwrap();
        assert_eq!(event.source_connection, 42);
        assert_eq!(event.chan, Channel::Text);
        assert_eq!(event.seq, 1);
    }
}
