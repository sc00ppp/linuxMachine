import { useSyncExternalStore } from 'react';

export interface CustomTvCategory {
  id: string;
  display_name: string;
  video_count: number;
}

export interface CustomTvVideo {
  id: string;
  category: string;
  title: string;
  filename: string;
  /** Original YouTube/Reddit/X source URL from the bot database. */
  url: string;
  /** Root-relative path served by the local Custom TV mediaserve instance. */
  media_url: string;
  thumbnail: string | null;
  thumbnail_source: 'source' | 'extracted' | null;
  size_bytes: number;
  extension: string;
  duration_seconds: number | null;
  downloaded_at: string | null;
}

export interface CustomTvCatalog {
  generated_at: string | null;
  categories: CustomTvCategory[];
  videos: CustomTvVideo[];
  mismatches: {
    completed_rows_missing_files: number;
    disk_videos_without_completed_row: number;
  };
}

/* Keep a fresh clone buildable before its owner runs the personal importer. */
const generatedModules = import.meta.glob<unknown>(
  '/src/core/customtv.generated.json',
  { eager: true, import: 'default' },
);
const generated = Object.values(generatedModules)[0];

function isCatalog(value: unknown): value is CustomTvCatalog {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CustomTvCatalog>;
  return Array.isArray(candidate.categories) && Array.isArray(candidate.videos);
}

const emptyCatalog: CustomTvCatalog = {
  generated_at: null,
  categories: [],
  videos: [],
  mismatches: {
    completed_rows_missing_files: 0,
    disk_videos_without_completed_row: 0,
  },
};

/**
 * The catalog is bundled at build time AND refreshed at runtime.
 *
 * The bundled copy is what makes the room work instantly and offline. But the
 * Discord bot keeps downloading after the console was built, and a build-time
 * catalog means those videos sit on disk invisible until someone rebuilds and
 * redeploys the whole shell. So the importer also writes `catalog.json` beside
 * the media, and the room fetches it on open: new videos appear on the next
 * visit, no rebuild.
 *
 * `let`, not `const`, deliberately — every consumer reads this at render time
 * rather than capturing it at module init, so swapping the binding and nudging
 * subscribers is enough to bring the whole room up to date.
 */
export let customTvCatalog: Readonly<CustomTvCatalog> = isCatalog(generated)
  ? generated
  : emptyCatalog;

let catalogVersion = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Pull a fresh catalog from the media server. Failure is silent and harmless:
 * the bundled copy is already on screen, and a console that cannot reach the
 * server has bigger problems to report than a stale video list.
 */
export async function refreshCustomTvCatalog(
  fetchUrl: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetch(fetchUrl, { signal, cache: 'no-store' });
    if (!response.ok) return false;
    const value: unknown = await response.json();
    if (!isCatalog(value)) return false;
    if (value.generated_at === customTvCatalog.generated_at) return false;

    customTvCatalog = value;
    catalogVersion += 1;
    for (const listener of listeners) listener();
    return true;
  } catch {
    return false;
  }
}

/** Re-renders the caller whenever a refresh actually replaced the catalog. */
export function useCustomTvCatalogVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => catalogVersion,
    () => catalogVersion,
  );
}
