//! In-memory phone pairing and token authentication.
//!
//! This is adapted from o3code's Tauri-free remote auth module: secrets come
//! from the OS CSPRNG, comparisons are constant-time, and a pairing code is
//! redeemable once. Console TV sockets do not use tokens; their trust boundary
//! is the loopback peer check in the server.

use std::fmt::Write as _;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use rand::{rngs::OsRng, Rng, RngCore};
use subtle::ConstantTimeEq;

const PHONE_PREFIX: &str = "cph_";
const MAX_PAIR_ATTEMPTS: usize = 5;

/// Constant-time equality for authentication material.
///
/// Length is not secret and may be observed; equal-length inputs are compared
/// without a data-dependent early exit.
pub fn verify(presented: &str, expected: &str) -> bool {
    presented.as_bytes().ct_eq(expected.as_bytes()).into()
}

/// Mint a role-prefixed 256-bit phone token.
pub fn generate_phone_token() -> String {
    let mut random = [0_u8; 32];
    OsRng.fill_bytes(&mut random);

    let mut token = String::with_capacity(PHONE_PREFIX.len() + random.len() * 2);
    token.push_str(PHONE_PREFIX);
    for byte in random {
        // Writing into a String cannot fail.
        write!(&mut token, "{byte:02x}").expect("write to String");
    }
    token
}

#[derive(Debug)]
struct PairingEntry {
    code: String,
    redeemed: bool,
}

/// The boot pairing PIN, retained for display but redeemable exactly once.
pub struct PairingBook {
    entry: Mutex<Option<PairingEntry>>,
}

impl PairingBook {
    pub fn new() -> Self {
        Self {
            entry: Mutex::new(None),
        }
    }

    /// Issue a uniformly random six-digit code, including leading zeroes.
    pub fn issue(&self) -> String {
        let mut rng = OsRng;
        let code = format!("{:06}", rng.gen_range(0_u32..1_000_000));
        *self.entry.lock().expect("pairing book lock poisoned") = Some(PairingEntry {
            code: code.clone(),
            redeemed: false,
        });
        code
    }

    /// Redeem a matching PIN once. The entry remains readable for `/pair-info`.
    pub fn redeem(&self, presented: &str) -> bool {
        let mut entry = self.entry.lock().expect("pairing book lock poisoned");
        let Some(entry) = entry.as_mut() else {
            return false;
        };

        let matches = verify(presented, &entry.code);
        if matches && !entry.redeemed {
            entry.redeemed = true;
            true
        } else {
            false
        }
    }

    pub fn current(&self) -> Option<String> {
        self.entry
            .lock()
            .expect("pairing book lock poisoned")
            .as_ref()
            .map(|entry| entry.code.clone())
    }
}

impl Default for PairingBook {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum PairResult {
    Token(String),
    Forbidden,
    RateLimited,
}

/// Owns all per-boot pairing state and all phone tokens issued this boot.
pub struct PairingService {
    book: PairingBook,
    attempts: AtomicUsize,
    tokens: Mutex<Vec<String>>,
}

impl PairingService {
    pub fn new() -> Self {
        let book = PairingBook::new();
        book.issue();
        Self {
            book,
            attempts: AtomicUsize::new(0),
            tokens: Mutex::new(Vec::new()),
        }
    }

    pub fn pin(&self) -> String {
        self.book
            .current()
            .expect("PairingService always has a boot PIN")
    }

    /// Try to exchange the boot PIN for a phone token.
    ///
    /// Attempts one through five are evaluated. Every later request is rejected
    /// with the rate-limit verdict for the remainder of this process boot.
    pub fn pair(&self, presented: &str) -> PairResult {
        if self
            .attempts
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |attempts| {
                (attempts < MAX_PAIR_ATTEMPTS).then_some(attempts + 1)
            })
            .is_err()
        {
            return PairResult::RateLimited;
        }

        if !self.book.redeem(presented) {
            return PairResult::Forbidden;
        }

        let token = generate_phone_token();
        self.tokens
            .lock()
            .expect("token store lock poisoned")
            .push(token.clone());
        PairResult::Token(token)
    }

    /// Verify a phone token against every in-memory token issued this boot.
    pub fn verify_phone_token(&self, presented: &str) -> bool {
        if !presented.starts_with(PHONE_PREFIX) {
            return false;
        }

        // Compare every entry even after a match so token position is not
        // exposed through an early return.
        self.tokens
            .lock()
            .expect("token store lock poisoned")
            .iter()
            .fold(false, |matched, expected| {
                verify(presented, expected) | matched
            })
    }
}

impl Default for PairingService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_token_has_phone_prefix_and_round_trips() {
        let token = generate_phone_token();
        assert!(token.starts_with("cph_"));
        assert_eq!(token.len(), 4 + 64);
        assert!(verify(&token, &token));
        assert!(!verify(&token, &generate_phone_token()));
    }

    #[test]
    fn pairing_pin_is_six_digits_and_redeems_once() {
        let book = PairingBook::new();
        let pin = book.issue();
        assert_eq!(pin.len(), 6);
        assert!(pin.bytes().all(|byte| byte.is_ascii_digit()));
        assert!(book.redeem(&pin));
        assert!(!book.redeem(&pin));
        assert_eq!(book.current().as_deref(), Some(pin.as_str()));
    }

    #[test]
    fn pairing_service_issues_and_verifies_a_token() {
        let service = PairingService::new();
        let token = match service.pair(&service.pin()) {
            PairResult::Token(token) => token,
            other => panic!("expected token, got {other:?}"),
        };
        assert!(service.verify_phone_token(&token));
        assert!(!service.verify_phone_token("cph_not-the-token"));
        assert!(!service.verify_phone_token("wrong-prefix"));
    }

    #[test]
    fn sixth_pair_attempt_is_rate_limited() {
        let service = PairingService::new();
        for _ in 0..5 {
            assert_eq!(service.pair("wrong"), PairResult::Forbidden);
        }
        assert_eq!(service.pair("wrong"), PairResult::RateLimited);
        assert_eq!(service.pair(&service.pin()), PairResult::RateLimited);
    }
}
