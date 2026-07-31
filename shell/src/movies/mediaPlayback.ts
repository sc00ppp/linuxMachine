import type { MediaEpisode, MediaMovie, MediaSeries } from '../core/media';
import { mediaHost } from '../core/mediaHost';

export interface MediaPlaybackItem {
  key: string;
  title: string;
  context: string;
  poster: string | null;
  sourceCandidates: string[];
}

function servedUrl(...segments: string[]): string {
  const path = segments.map((segment) => encodeURIComponent(segment)).join('/');
  return `${mediaHost}/${path}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Movies were measured directly under S:\Kodi\Collection\Movies. */
export function moviePlayback(movie: MediaMovie): MediaPlaybackItem {
  return {
    key: `movie:${movie.id}`,
    title: movie.title,
    context: movie.year ? `Movie / ${movie.year}` : 'Movie',
    poster: movie.poster,
    sourceCandidates: unique([
      servedUrl('Kodi', 'Collection', 'Movies', movie.fileName),
      // One legacy file was measured at Collection's root. Keeping this
      // fallback costs nothing and makes such an import playable honestly.
      servedUrl('Kodi', 'Collection', movie.fileName),
    ]),
  };
}

/**
 * The real TV collection mixes root episodes, `Season 1`, and `S1` folders.
 * A video element tries these measured conventions in order; no CORS fetch is
 * needed, which matters because the range server intentionally has no API
 * surface beyond serving files.
 */
export function episodePlayback(
  series: MediaSeries,
  seasonNumber: number,
  episode: MediaEpisode,
): MediaPlaybackItem {
  const base = ['Kodi', 'Collection', 'TV Shows', series.title];
  const padded = String(seasonNumber).padStart(2, '0');
  const directories: string[][] = [
    [],
    [`Season ${seasonNumber}`],
    [`S${seasonNumber}`],
    [`Season ${padded}`],
    [`S${padded}`],
  ];
  if (seasonNumber === 0) directories.push(['Specials']);

  const number = episode.episodeNumber === null
    ? `Season ${seasonNumber}`
    : `S${padded}E${String(episode.episodeNumber).padStart(2, '0')}`;
  return {
    key: `episode:${series.id}:${seasonNumber}:${episode.id}`,
    title: episode.title,
    context: `${series.title} / ${number}`,
    poster: series.fanart ?? series.poster,
    sourceCandidates: unique(
      directories.map((directory) =>
        servedUrl(...base, ...directory, episode.fileName)),
    ),
  };
}
