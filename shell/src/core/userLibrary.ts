import { useSyncExternalStore } from 'react';

/**
 * Per-user library preferences: favorites, pinned games, and per-console
 * sort mode. Persisted in localStorage for now; when the daemon and real
 * profiles land this moves behind it, keyed by user id (ARCHITECTURE.md).
 *
 * Kept deliberately outside the zustand console store: that store is
 * session/UI state the phone mirrors, whereas this is durable user data.
 */

export type SortMode =
  | 'default'
  | 'rating'
  | 'recent'
  | 'played'
  | 'favorites'
  | 'alpha'
  | 'year';

export const SORT_MODES: SortMode[] = [
  'default',
  'rating',
  'recent',
  'played',
  'favorites',
  'alpha',
  'year',
];

export const SORT_LABELS: Record<SortMode, string> = {
  default: 'Suggested',
  rating: 'Rating',
  recent: 'Recently played',
  played: 'Most played',
  favorites: 'Favorites',
  alpha: 'A–Z',
  year: 'Year',
};

/**
 * Sort modes whose ranking value is worth showing on the box art itself.
 * Sorting by rating is meaningless if you can't see the ratings.
 */
export const SORT_SHOWS_RATING = (mode: SortMode): boolean => mode === 'rating';

export interface PinnedGame {
  /** `${consoleId}:${gameKey}` — stable across reloads. */
  id: string;
  consoleId: string;
  gameKey: string;
  title: string;
  art: string | null;
}

interface UserLibrary {
  /** `${consoleId}:${gameKey}` entries the user starred. */
  favorites: string[];
  pins: PinnedGame[];
  /** consoleId → sort mode. */
  sort: Record<string, SortMode>;
}

const KEY = 'console-user-library';

const EMPTY: UserLibrary = { favorites: [], pins: [], sort: {} };

function read(): UserLibrary {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<UserLibrary>;
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      pins: Array.isArray(parsed.pins) ? parsed.pins : [],
      sort: typeof parsed.sort === 'object' && parsed.sort ? parsed.sort : {},
    };
  } catch {
    return EMPTY;
  }
}

let state: UserLibrary = read();
const listeners = new Set<() => void>();

function commit(next: UserLibrary): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota or private mode — preferences simply don't persist */
  }
  for (const l of listeners) l();
}

export const gameId = (consoleId: string, gameKey: string) => `${consoleId}:${gameKey}`;

export function isFavorite(consoleId: string, gameKey: string): boolean {
  return state.favorites.includes(gameId(consoleId, gameKey));
}

export function toggleFavorite(consoleId: string, gameKey: string): void {
  const id = gameId(consoleId, gameKey);
  const has = state.favorites.includes(id);
  commit({
    ...state,
    favorites: has
      ? state.favorites.filter((f) => f !== id)
      : [...state.favorites, id],
  });
}

export function isPinned(consoleId: string, gameKey: string): boolean {
  return state.pins.some((p) => p.id === gameId(consoleId, gameKey));
}

export function togglePin(pin: Omit<PinnedGame, 'id'>): void {
  const id = gameId(pin.consoleId, pin.gameKey);
  const has = state.pins.some((p) => p.id === id);
  commit({
    ...state,
    pins: has ? state.pins.filter((p) => p.id !== id) : [...state.pins, { ...pin, id }],
  });
}

export function getSort(consoleId: string): SortMode {
  return state.sort[consoleId] ?? 'default';
}

export function cycleSort(consoleId: string): SortMode {
  const current = getSort(consoleId);
  const next = SORT_MODES[(SORT_MODES.indexOf(current) + 1) % SORT_MODES.length];
  commit({ ...state, sort: { ...state.sort, [consoleId]: next } });
  return next;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Re-renders on any change to favorites/pins/sort. */
export function useUserLibrary(): UserLibrary {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}
