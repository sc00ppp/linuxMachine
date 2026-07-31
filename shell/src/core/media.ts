export interface MediaEpisode {
  id: string;
  title: string;
  fileName: string;
  episodeNumber: number | null;
  sizeBytes: number;
}

export interface MediaSeason {
  number: number;
  title: string;
  episodeCount: number;
  totalBytes: number;
  episodes: MediaEpisode[];
}

export interface MediaSeries {
  id: string;
  title: string;
  seasons: MediaSeason[];
  episodeCount: number;
  totalBytes: number;
  poster: string | null;
}

export interface MediaMovie {
  id: string;
  title: string;
  year: number | null;
  fileName: string;
  sizeBytes: number;
  poster: string | null;
}

export interface MediaLibrary {
  generatedAt: string | null;
  series: MediaSeries[];
  movies: MediaMovie[];
}

/*
 * A glob keeps the generated file optional at build time. A fresh checkout
 * can render the channel's calm empty state before the importer has ever run;
 * once present, Vite eagerly folds the JSON into this module.
 */
const generatedModules = import.meta.glob<unknown>('./media.generated.json', {
  eager: true,
  import: 'default',
});

const generated = Object.values(generatedModules)[0];

function isMediaLibrary(value: unknown): value is MediaLibrary {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MediaLibrary>;
  return Array.isArray(candidate.series) && Array.isArray(candidate.movies);
}

const emptyLibrary: MediaLibrary = {
  generatedAt: null,
  series: [],
  movies: [],
};

/** Typed, read-only snapshot produced by tools/import-media.mjs. */
export const media: Readonly<MediaLibrary> = isMediaLibrary(generated)
  ? generated
  : emptyLibrary;

/** True when at least one playable-looking library item was imported. */
export const hasMedia = media.series.length > 0 || media.movies.length > 0;
