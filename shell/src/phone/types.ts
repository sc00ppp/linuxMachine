/**
 * Wire types for the phone surface (CONTRACTS.md Round 3 — wire protocol).
 *
 * These mirror what the TV publishes on the `state` channel. They are declared
 * here rather than imported from `core/store.ts` on purpose: the phone talks to
 * the console over a socket, so the snapshot is *data off the wire*, not shared
 * memory. Anything arriving from the network is parsed defensively — a phone
 * that white-screens because the TV shipped a new field is a bad phone.
 */

import type { ConsoleInput } from '../core/types';

export type { ConsoleInput };

/** One channel as mirrored on the phone (a subset of core `Channel`). */
export interface MirroredChannel {
  id: string;
  title: string;
  /** Channel accent color (hex) — drives the tile face and the pad's tint. */
  accent: string;
  glyph: string;
}

/** TV → phone UI snapshot, published on the `state` channel. */
export interface StateSnapshot {
  mode: 'home' | 'app';
  view: 'wall' | 'games';
  gamesLevel: 'consoles' | 'grid';
  /** Id of the element the TV's focus engine currently holds, if any. */
  focusedId: string | null;
  runningChannel: string | null;
  runningTitle: string | null;
  shelfOpen: boolean;
  channels: MirroredChannel[];
}

/** Payload published by the phone on the `text` channel. */
export interface TextPayload {
  text: string;
  commit: boolean;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Parse a `state` event payload. Returns null only when the payload is not an
 * object at all; every individual field falls back to a sane default so a
 * partial snapshot still renders something useful.
 */
export function asSnapshot(payload: unknown): StateSnapshot | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const raw = payload as Record<string, unknown>;

  const channels: MirroredChannel[] = Array.isArray(raw.channels)
    ? raw.channels
        .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
        .map((c) => ({
          id: str(c.id),
          title: str(c.title, '—'),
          // Empty means "the TV didn't say" — consumers then leave --accent
          // alone and inherit the token default (a sane warm gold).
          accent: str(c.accent),
          glyph: str(c.glyph, '•'),
        }))
        .filter((c) => c.id !== '')
    : [];

  return {
    mode: oneOf(raw.mode, ['home', 'app'] as const, 'home'),
    view: oneOf(raw.view, ['wall', 'games'] as const, 'wall'),
    gamesLevel: oneOf(raw.gamesLevel, ['consoles', 'grid'] as const, 'consoles'),
    focusedId: strOrNull(raw.focusedId),
    runningChannel: strOrNull(raw.runningChannel),
    runningTitle: strOrNull(raw.runningTitle),
    shelfOpen: raw.shelfOpen === true,
    channels,
  };
}
