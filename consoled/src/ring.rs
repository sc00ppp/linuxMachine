//! Bounded replay history with monotonic per-key sequence numbers.
//!
//! Adapted from o3code's generic history ring. Sequence numbers are retained
//! separately from buffered entries, so eviction never reuses an old number.

use std::collections::{HashMap, VecDeque};
use std::hash::Hash;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sequenced<T> {
    pub seq: u64,
    pub item: T,
}

struct RingBuf<T> {
    last_seq: u64,
    entries: VecDeque<(u64, T)>,
}

impl<T> RingBuf<T> {
    fn empty() -> Self {
        Self {
            last_seq: 0,
            entries: VecDeque::new(),
        }
    }
}

/// A thread-safe, bounded replay ring for each key.
pub struct HistoryRing<K: Eq + Hash + Clone, T: Clone> {
    inner: RwLock<HashMap<K, RingBuf<T>>>,
    cap_per_key: usize,
}

impl<K: Eq + Hash + Clone, T: Clone> HistoryRing<K, T> {
    pub fn new(cap_per_key: usize) -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
            cap_per_key,
        }
    }

    /// Append an item and return its strictly increasing sequence number.
    pub fn append(&self, key: K, item: T) -> u64 {
        let mut map = self.inner.write().expect("history ring lock poisoned");
        let ring = map.entry(key).or_insert_with(RingBuf::empty);
        ring.last_seq = ring
            .last_seq
            .checked_add(1)
            .expect("history sequence exhausted");
        let seq = ring.last_seq;
        ring.entries.push_back((seq, item));

        while ring.entries.len() > self.cap_per_key {
            ring.entries.pop_front();
        }
        seq
    }

    /// Return buffered items with `seq > after`, plus the current top sequence.
    pub fn since(&self, key: &K, after: Option<u64>) -> (Vec<Sequenced<T>>, u64) {
        let map = self.inner.read().expect("history ring lock poisoned");
        let Some(ring) = map.get(key) else {
            return (Vec::new(), 0);
        };
        let floor = after.unwrap_or(0);
        let replay = ring
            .entries
            .iter()
            .filter(|(seq, _)| *seq > floor)
            .map(|(seq, item)| Sequenced {
                seq: *seq,
                item: item.clone(),
            })
            .collect();
        (replay, ring.last_seq)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seq_is_monotonic_per_key() {
        let ring = HistoryRing::new(8);
        assert_eq!(ring.append("state", 10), 1);
        assert_eq!(ring.append("state", 20), 2);
        assert_eq!(ring.append("other", 30), 1);
    }

    #[test]
    fn replay_is_strictly_after_floor() {
        let ring = HistoryRing::new(8);
        for value in 1..=4 {
            ring.append("state", value);
        }
        let (items, latest) = ring.since(&"state", Some(2));
        assert_eq!(
            items,
            vec![Sequenced { seq: 3, item: 3 }, Sequenced { seq: 4, item: 4 }]
        );
        assert_eq!(latest, 4);
    }

    #[test]
    fn eviction_keeps_latest_sequence_and_newest_entries() {
        let ring = HistoryRing::new(2);
        for value in 1..=4 {
            ring.append("state", value);
        }
        let (items, latest) = ring.since(&"state", None);
        assert_eq!(
            items,
            vec![Sequenced { seq: 3, item: 3 }, Sequenced { seq: 4, item: 4 }]
        );
        assert_eq!(latest, 4);
    }

    #[test]
    fn unknown_key_has_empty_replay_at_zero() {
        let ring: HistoryRing<&str, i32> = HistoryRing::new(2);
        assert_eq!(ring.since(&"missing", None), (Vec::new(), 0));
    }
}
