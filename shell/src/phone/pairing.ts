/**
 * Pairing: PIN → token → localStorage → silent reconnect on every later visit.
 *
 * The daemon keeps phone tokens in memory only (CONTRACTS.md Round 3), so a
 * console reboot invalidates every pairing. That is not an error state to
 * apologise for — the phone just quietly falls back to the PIN screen when the
 * socket reports `authFailed` (see PhoneApp).
 */

import { useCallback, useState } from 'react';
import { PAIRING_KEY, httpBase } from './config';

export interface PairRecord {
  /** `cph_…` bearer token for the `auth` frame. */
  token: string;
  /** Host this token was minted by — a token from another console is useless. */
  host: string;
  savedAt: number;
}

/** Why a pairing attempt failed, in terms the UI can turn into console-voice copy. */
export type PairFailure = 'wrongPin' | 'rateLimited' | 'unreachable' | 'server';

export type PairResult = { ok: true; record: PairRecord } | { ok: false; kind: PairFailure };

export function loadPairing(host: string): PairRecord | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PAIRING_KEY);
  } catch {
    // Private mode / storage disabled: pair every visit rather than crash.
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const rec = parsed as Partial<PairRecord>;
      if (typeof rec.token === 'string' && rec.token !== '') {
        // A token minted by a different console will never authenticate here.
        if (typeof rec.host === 'string' && rec.host !== '' && rec.host !== host) return null;
        return { token: rec.token, host, savedAt: rec.savedAt ?? 0 };
      }
    }
  } catch {
    // Older builds stored the bare token string; still honour it.
    if (raw.startsWith('cph_')) return { token: raw, host, savedAt: 0 };
  }
  return null;
}

export function storePairing(record: PairRecord): void {
  try {
    window.localStorage.setItem(PAIRING_KEY, JSON.stringify(record));
  } catch {
    /* storage unavailable — the session still works, it just won't persist */
  }
}

export function clearPairing(): void {
  try {
    window.localStorage.removeItem(PAIRING_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * `POST /pair {"pin"}` → `{"token":"cph_…"}`.
 * 403 = wrong PIN, 429 = out of attempts for this boot of the daemon.
 */
export async function requestPair(host: string, pin: string): Promise<PairResult> {
  let res: Response;
  try {
    res = await fetch(`${httpBase(host)}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
  } catch {
    // Network-level failure: wrong Wi-Fi, daemon down, or the browser blocking
    // the request outright. Indistinguishable from here, so one message covers it.
    return { ok: false, kind: 'unreachable' };
  }

  if (res.status === 403) return { ok: false, kind: 'wrongPin' };
  if (res.status === 429) return { ok: false, kind: 'rateLimited' };
  if (!res.ok) return { ok: false, kind: 'server' };

  try {
    const body: unknown = await res.json();
    const token =
      typeof body === 'object' && body !== null
        ? (body as { token?: unknown }).token
        : undefined;
    if (typeof token !== 'string' || token === '') return { ok: false, kind: 'server' };
    return { ok: true, record: { token, host, savedAt: Date.now() } };
  } catch {
    return { ok: false, kind: 'server' };
  }
}

/** The pairing record as React state, kept in sync with localStorage. */
export function usePairing(host: string): {
  pairing: PairRecord | null;
  save: (record: PairRecord) => void;
  forget: () => void;
} {
  const [pairing, setPairing] = useState<PairRecord | null>(() => loadPairing(host));

  const save = useCallback((record: PairRecord) => {
    storePairing(record);
    setPairing(record);
  }, []);

  const forget = useCallback(() => {
    clearPairing();
    setPairing(null);
  }, []);

  return { pairing, save, forget };
}
