import { useSyncExternalStore } from 'react';

/** Durable Movies & TV preferences, kept separate from mirrored UI state. */
export type MovieSortMode = 'alpha' | 'recent' | 'year' | 'rating';

export const MOVIE_SORT_MODES: readonly MovieSortMode[] = [
  'alpha',
  'recent',
  'year',
  'rating',
];

export const MOVIE_SORT_LABELS: Record<MovieSortMode, string> = {
  alpha: 'A-Z',
  recent: 'Recently added',
  year: 'Year',
  rating: 'Rating',
};

interface MovieLibraryPreferences {
  /** Row id -> sort mode, mirroring Games' per-console preference map. */
  sort: Record<string, MovieSortMode>;
}

const STORAGE_KEY = 'console-movie-library';
const EMPTY: MovieLibraryPreferences = { sort: {} };

function isSortMode(value: unknown): value is MovieSortMode {
  return MOVIE_SORT_MODES.includes(value as MovieSortMode);
}

function read(): MovieLibraryPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<MovieLibraryPreferences>;
    if (!parsed.sort || typeof parsed.sort !== 'object') return EMPTY;

    const sort = Object.fromEntries(
      Object.entries(parsed.sort).filter((entry): entry is [string, MovieSortMode] =>
        isSortMode(entry[1]),
      ),
    );
    return { sort };
  } catch {
    return EMPTY;
  }
}

let state = read();
const listeners = new Set<() => void>();

function commit(next: MovieLibraryPreferences): void {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or quota pressure should not make the room unusable.
  }
  for (const listener of listeners) listener();
}

export function getMovieSort(rowId: string): MovieSortMode {
  return state.sort[rowId] ?? 'alpha';
}

export function cycleMovieSort(rowId: string): MovieSortMode {
  const current = getMovieSort(rowId);
  const next =
    MOVIE_SORT_MODES[
      (MOVIE_SORT_MODES.indexOf(current) + 1) % MOVIE_SORT_MODES.length
    ];
  commit({ ...state, sort: { ...state.sort, [rowId]: next } });
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMovieLibrary(): MovieLibraryPreferences {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}
