import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties } from 'react';
import { channelById } from '../core/channels';
import {
  hasMedia,
  media,
  type MediaEpisode,
  type MediaMovie,
  type MediaSeason,
  type MediaSeries,
} from '../core/media';
import { useConsoleStore } from '../core/store';
import { useFocusable } from '../focus';
import { tuning } from '../motion/tuning';
import { playLaunch } from '../motion/transitions';
import { sound } from '../sound';
import {
  MOVIE_SORT_LABELS,
  cycleMovieSort,
  useMovieLibrary,
  type MovieSortMode,
} from './movieLibrary';
import { MediaPlayer } from './MediaPlayer';
import {
  episodePlayback,
  moviePlayback,
  type MediaPlaybackItem,
} from './mediaPlayback';
import './MoviesChannel.css';
import { glideIntoView } from '../motion/glide';

type MoviesLevel = 'library' | 'episodes';

interface MoviesStoreBridge {
  moviesLevel?: MoviesLevel;
  setMoviesLevel?: (level: MoviesLevel) => void;
}

type LibraryItem =
  | { kind: 'series'; value: MediaSeries }
  | { kind: 'movie'; value: MediaMovie };

interface MediaRow {
  id: string;
  title: string;
  items: LibraryItem[];
}

const MIN_GENRE_ROW_ITEMS = 3;
const titleCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});

let lastSeriesId = media.series[0]?.id ?? null;
let lastLibraryFocusId: string | null = null;
let lastRowId = 'tv-shows';

const cssVars = (vars: Record<string, string | number>): CSSProperties =>
  vars as CSSProperties;

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const itemKey = (item: LibraryItem): string =>
  `${item.kind}-${item.value.id}`;

const posterFocusId = (rowId: string, item: LibraryItem): string =>
  `media-${rowId}-${itemKey(item)}`;

function genreId(genre: string): string {
  return genre
    .toLocaleLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildMediaRows(): MediaRow[] {
  const shows: LibraryItem[] = media.series.map((value) => ({
    kind: 'series',
    value,
  }));
  const movies: LibraryItem[] = media.movies.map((value) => ({
    kind: 'movie',
    value,
  }));
  const all = [...shows, ...movies];
  const rows: MediaRow[] = [];
  const continuing = all.filter((item) => item.value.resume);

  if (continuing.length > 0) {
    rows.push({ id: 'continue', title: 'Continue watching', items: continuing });
  }
  if (shows.length > 0) {
    rows.push({ id: 'tv-shows', title: 'TV Shows', items: shows });
  }
  if (movies.length > 0) {
    rows.push({ id: 'movies', title: 'Movies', items: movies });
  }

  const byGenre = new Map<string, LibraryItem[]>();
  for (const item of all) {
    for (const genre of item.value.genres ?? []) {
      const items = byGenre.get(genre) ?? [];
      if (!items.some((candidate) => itemKey(candidate) === itemKey(item))) {
        items.push(item);
      }
      byGenre.set(genre, items);
    }
  }

  const genreRows = [...byGenre.entries()]
    .filter(([, items]) => items.length >= MIN_GENRE_ROW_ITEMS)
    .sort(([left], [right]) => titleCollator.compare(left, right))
    .map(([title, items]) => ({
      id: `genre-${genreId(title)}`,
      title,
      items,
    }));

  return [...rows, ...genreRows];
}

function dateRank(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortMediaItems(
  items: LibraryItem[],
  mode: MovieSortMode,
): LibraryItem[] {
  const decorated = items.map((item, index) => ({ item, index }));
  const alpha = (left: LibraryItem, right: LibraryItem) =>
    titleCollator.compare(left.value.title, right.value.title) ||
    titleCollator.compare(itemKey(left), itemKey(right));

  decorated.sort((left, right) => {
    switch (mode) {
      case 'recent':
        return (
          dateRank(right.item.value.addedAt) -
            dateRank(left.item.value.addedAt) ||
          alpha(left.item, right.item) ||
          left.index - right.index
        );
      case 'year':
        return (
          (right.item.value.year ?? -1) - (left.item.value.year ?? -1) ||
          alpha(left.item, right.item) ||
          left.index - right.index
        );
      case 'rating':
        return (
          (right.item.value.rating ?? -1) -
            (left.item.value.rating ?? -1) ||
          alpha(left.item, right.item) ||
          left.index - right.index
        );
      case 'alpha':
        return alpha(left.item, right.item) || left.index - right.index;
    }
  });

  return decorated.map(({ item }) => item);
}

export function handleMoviesSortInput(): void {
  if (!lastRowId) return;
  cycleMovieSort(lastRowId);
  sound.play('accept');
}

export function MoviesChannel() {
  const wiredLevel = useConsoleStore(
    (state) => (state as unknown as MoviesStoreBridge).moviesLevel,
  );
  const setWiredLevel = useConsoleStore(
    (state) => (state as unknown as MoviesStoreBridge).setMoviesLevel,
  );
  const [localLevel, setLocalLevel] = useState<MoviesLevel>('library');
  const level = wiredLevel ?? localLevel;
  const preferences = useMovieLibrary();
  const rows = useMemo(buildMediaRows, []);

  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(
    lastSeriesId,
  );
  const selectedSeries =
    media.series.find((series) => series.id === selectedSeriesId) ??
    media.series[0] ??
    null;
  const [activeSeasonNumber, setActiveSeasonNumber] = useState<number>(
    selectedSeries?.seasons[0]?.number ?? 1,
  );
  const activeSeason =
    selectedSeries?.seasons.find(
      (season) => season.number === activeSeasonNumber,
    ) ??
    selectedSeries?.seasons[0] ??
    null;

  const firstItem = rows[0]?.items[0] ?? null;
  const [highlightedItem, setHighlightedItem] = useState<LibraryItem | null>(
    firstItem,
  );
  const [playback, setPlayback] = useState<MediaPlaybackItem | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const levelRef = useRef<HTMLDivElement | null>(null);
  const busy = useRef(false);

  useEffect(() => () => sound.duck(false), []);

  useLayoutEffect(() => {
    animateDrill(rootRef.current, 'deeper', tuning.drillInMs);
  }, []);

  const previousLevel = useRef<MoviesLevel | null>(null);
  useLayoutEffect(() => {
    const previous = previousLevel.current;
    previousLevel.current = level;
    if (previous === null || previous === level) return;

    animateDrill(
      levelRef.current,
      level === 'episodes' ? 'deeper' : 'shallower',
      level === 'episodes' ? tuning.drillInMs : tuning.drillMs,
    );
  }, [level]);

  const openSeries = useCallback(
    (series: MediaSeries) => {
      lastSeriesId = series.id;
      setSelectedSeriesId(series.id);
      setActiveSeasonNumber(series.seasons[0]?.number ?? 1);
      setLocalLevel('episodes');
      setWiredLevel?.('episodes');
      sound.play('accept');
    },
    [setWiredLevel],
  );

  const launchMedia = useCallback(async (
    item: MediaPlaybackItem,
    element: HTMLElement,
  ) => {
    if (busy.current) return;
    busy.current = true;
    sound.play('launch');
    sound.duck(true);
    try {
      await playLaunch(element, channelById('movies')?.accent ?? '#e89a3c');
    } catch {
      // Playback is functional even if the decorative handoff cannot animate.
    }
    setPlayback(item);
  }, []);

  const launchEpisode = useCallback(
    (episode: MediaEpisode, element: HTMLElement) => {
      if (!selectedSeries || !activeSeason) return;
      void launchMedia(
        episodePlayback(selectedSeries, activeSeason.number, episode),
        element,
      );
    },
    [activeSeason, launchMedia, selectedSeries],
  );

  const accent = channelById('movies')?.accent ?? '#e89a3c';
  const isEpisodes = level === 'episodes' && selectedSeries !== null;
  const headerTitle = isEpisodes
    ? selectedSeries.title
    : highlightedItem?.value.title ?? 'Movies & TV';
  const headerMeta = isEpisodes
    ? `${selectedSeries.episodeCount} episodes / ${formatBytes(selectedSeries.totalBytes)}`
    : highlightedItem
      ? itemSummary(highlightedItem)
      : librarySummary();
  const backdrop = isEpisodes
    ? selectedSeries.fanart
    : highlightedItem?.kind === 'series'
      ? highlightedItem.value.fanart
      : null;

  if (playback) {
    return (
      <main
        className="movies"
        data-level="playback"
        style={cssVars({
          '--accent': accent,
          '--focus-ms': `${tuning.focusMoveMs}ms`,
          '--focus-ease': tuning.focusEase,
        })}
      >
        <MediaPlayer
          item={playback}
          onBack={() => {
            busy.current = false;
            sound.duck(false);
            setPlayback(null);
          }}
        />
      </main>
    );
  }

  return (
    <main
      className="movies"
      ref={rootRef}
      data-level={isEpisodes ? 'episodes' : 'library'}
      style={cssVars({
        '--accent': accent,
        '--focus-ms': `${tuning.focusMoveMs}ms`,
        '--focus-ease': tuning.focusEase,
      })}
    >
      {backdrop && (
        <div className="movies-backdrop" aria-hidden="true">
          <img src={backdrop} alt="" />
        </div>
      )}
      <div className="movies-light" aria-hidden="true" />

      <header className="movies-header" data-collapse="y">
        <div className="movies-titleline">
          <h1 className="movies-heading">Movies &amp; TV</h1>
          {isEpisodes && <span className="movies-crumb">&rsaquo;</span>}
          <span className="movies-current">{headerTitle}</span>
        </div>
        <span className="movies-tally">{headerMeta}</span>
      </header>

      <div
        className="movies-level"
        key={isEpisodes ? 'episodes' : 'library'}
        ref={levelRef}
      >
        {!hasMedia ? (
          <EmptyLibrary />
        ) : isEpisodes ? (
          <SeriesLibrary
            series={selectedSeries}
            activeSeason={activeSeason}
            onSeasonFocus={setActiveSeasonNumber}
            onEpisodeAccept={launchEpisode}
          />
        ) : (
          <MediaRows
            rows={rows}
            sortByRow={preferences.sort}
            highlightedFocusId={lastLibraryFocusId}
            onFocusItem={setHighlightedItem}
            onOpenSeries={openSeries}
            onLaunchMovie={(movie, element) => {
              void launchMedia(moviePlayback(movie), element);
            }}
          />
        )}
      </div>

      <footer className="movies-hints" data-collapse="y">
        {hasMedia && <Hint badge="A" label={isEpisodes ? 'Watch' : 'Open'} />}
        {!isEpisodes && hasMedia && <Hint badge="Y" label="Sort row" />}
        <Hint badge="B" label={isEpisodes && setWiredLevel ? 'Library' : 'Back'} />
      </footer>
    </main>
  );
}

function MediaRows({
  rows,
  sortByRow,
  highlightedFocusId,
  onFocusItem,
  onOpenSeries,
  onLaunchMovie,
}: {
  rows: MediaRow[];
  sortByRow: Record<string, MovieSortMode>;
  highlightedFocusId: string | null;
  onFocusItem: (item: LibraryItem) => void;
  onOpenSeries: (series: MediaSeries) => void;
  onLaunchMovie: (movie: MediaMovie, element: HTMLElement) => void;
}) {
  const fallbackFocusId = rows[0]?.items[0]
    ? posterFocusId(rows[0].id, rows[0].items[0])
    : null;

  return (
    <div className="media-rows-scroll">
      <div className="media-rows-stack">
        {rows.map((row) => {
          const mode = sortByRow[row.id] ?? 'alpha';
          const sorted = sortMediaItems(row.items, mode);
          return (
            <section className="media-shelf" key={row.id}>
              <h2 className="media-shelf-heading">
                <span>{row.title}</span>
                <small>{row.items.length}</small>
              </h2>
              <div className="media-shelf-scroller">
                <div className="media-shelf-row">
                  <MovieSortControl rowId={row.id} mode={mode} />
                  {sorted.map((item) => {
                    const focusId = posterFocusId(row.id, item);
                    return (
                      <MediaPoster
                        key={itemKey(item)}
                        rowId={row.id}
                        item={item}
                        sortMode={mode}
                        autoFocus={
                          focusId === (highlightedFocusId ?? fallbackFocusId)
                        }
                        onFocus={(focusedItem) => {
                          lastRowId = row.id;
                          lastLibraryFocusId = focusId;
                          onFocusItem(focusedItem);
                        }}
                        onAccept={(element) => {
                          if (item.kind === 'series') {
                            onOpenSeries(item.value);
                          } else {
                            onLaunchMovie(item.value, element);
                          }
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function MovieSortControl({
  rowId,
  mode,
}: {
  rowId: string;
  mode: MovieSortMode;
}) {
  const elementRef = useRef<HTMLButtonElement | null>(null);
  const cycle = useCallback(() => {
    lastRowId = rowId;
    cycleMovieSort(rowId);
    sound.play('accept');
  }, [rowId]);
  const { ref: focusRef, focused } = useFocusable({
    id: `movies-sort-${rowId}`,
    scope: 'movies',
    onAccept: cycle,
  });
  const setRef = useCallback(
    (element: HTMLButtonElement | null) => {
      elementRef.current = element;
      focusRef(element);
    },
    [focusRef],
  );

  useEffect(() => {
    if (!focused) return;
    lastRowId = rowId;
    glideIntoView(elementRef.current, { block: 'nearest', inline: 'nearest' });
  }, [focused, rowId]);

  return (
    <button
      ref={setRef}
      type="button"
      className="movies-sort"
      data-focused={focused ? 'true' : undefined}
      aria-label={`Sort ${rowId}: ${MOVIE_SORT_LABELS[mode]}. Select for next mode.`}
      onClick={cycle}
    >
      <span className="movies-sort-button" aria-hidden="true">Y</span>
      <span className="movies-sort-caption">Sort</span>
      <strong>{MOVIE_SORT_LABELS[mode]}</strong>
    </button>
  );
}

function MediaPoster({
  rowId,
  item,
  sortMode,
  autoFocus,
  onFocus,
  onAccept,
}: {
  rowId: string;
  item: LibraryItem;
  sortMode: MovieSortMode;
  autoFocus: boolean;
  onFocus: (item: LibraryItem) => void;
  onAccept: (element: HTMLElement) => void;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ item, onAccept });
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    latest.current = { item, onAccept };
  });

  const accept = useCallback(() => {
    if (elementRef.current) latest.current.onAccept(elementRef.current);
  }, []);
  const { ref: focusRef, focused } = useFocusable({
    id: posterFocusId(rowId, item),
    scope: 'movies',
    onAccept: accept,
    autoFocus,
  });
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      elementRef.current = element;
      focusRef(element);
    },
    [focusRef],
  );

  useEffect(() => {
    if (!focused) return;
    onFocus(item);
    glideIntoView(elementRef.current, { block: 'nearest', inline: 'nearest' });
  }, [focused, item, onFocus]);

  const poster = item.value.poster;
  const details =
    item.kind === 'series'
      ? `${item.value.year ?? 'TV'} / ${item.value.episodeCount} episodes`
      : item.value.year?.toString() ?? formatBytes(item.value.sizeBytes);
  const progress = item.value.resume
    ? Math.max(
        0,
        Math.min(
          100,
          (item.value.resume.positionSeconds /
            item.value.resume.totalSeconds) *
            100,
        ),
      )
    : null;

  return (
    <article className="media-poster-slot">
      <div
        className="media-poster"
        ref={setRef}
        data-focused={focused ? 'true' : undefined}
        role="button"
        aria-label={`${item.value.title}, ${details}`}
      >
        <div className="media-poster-face">
          {poster && !imageFailed ? (
            <img
              className="media-poster-image"
              src={poster}
              alt=""
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="media-poster-fallback">
              <span className="media-poster-mark" aria-hidden="true">
                {item.kind === 'series' ? 'TV' : 'FILM'}
              </span>
              <span className="media-poster-fallback-title">
                {item.value.title}
              </span>
            </div>
          )}
          {sortMode === 'rating' && item.value.rating !== null && (
            <span className="media-poster-rating">
              {'\u2605'} {item.value.rating.toFixed(1)}
            </span>
          )}
          <span className="media-poster-kind">
            {item.kind === 'series' ? 'Series' : 'Movie'}
          </span>
          {progress !== null && (
            <span className="media-poster-progress" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </span>
          )}
          <div className="media-poster-sheen" />
          <div className="media-poster-rim" />
        </div>
      </div>
      <div className={`media-poster-label${focused ? ' is-focused' : ''}`}>
        <span>{item.value.title}</span>
        <small>
          {progress !== null ? `${Math.round(progress)}% watched` : details}
        </small>
      </div>
    </article>
  );
}

function SeriesLibrary({
  series,
  activeSeason,
  onSeasonFocus,
  onEpisodeAccept,
}: {
  series: MediaSeries;
  activeSeason: MediaSeason | null;
  onSeasonFocus: (seasonNumber: number) => void;
  onEpisodeAccept: (episode: MediaEpisode, element: HTMLElement) => void;
}) {
  if (series.seasons.length === 0) {
    return (
      <div className="movies-series-empty">
        <span className="movies-empty-orbit" aria-hidden="true" />
        <p>This series folder is quiet right now.</p>
        <small>No episode files were found.</small>
      </div>
    );
  }

  return (
    <div className="series-library">
      <div className="season-scroller">
        <div className="season-row">
          {series.seasons.map((season, index) => (
            <SeasonChip
              key={season.number}
              seriesId={series.id}
              season={season}
              active={season.number === activeSeason?.number}
              autoFocus={index === 0}
              onFocus={onSeasonFocus}
            />
          ))}
        </div>
      </div>

      <div className="episode-scroller">
        {activeSeason && activeSeason.episodes.length > 0 ? (
          <div className="episode-grid" key={activeSeason.number}>
            {activeSeason.episodes.map((episode) => (
              <EpisodeCard
                key={episode.id}
                seriesTitle={series.title}
                seasonNumber={activeSeason.number}
                episode={episode}
                onAccept={onEpisodeAccept}
              />
            ))}
          </div>
        ) : (
          <p className="episodes-empty">No episodes found in this season.</p>
        )}
      </div>
    </div>
  );
}

function SeasonChip({
  seriesId,
  season,
  active,
  autoFocus,
  onFocus,
}: {
  seriesId: string;
  season: MediaSeason;
  active: boolean;
  autoFocus: boolean;
  onFocus: (seasonNumber: number) => void;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const { ref, focused } = useFocusable({
    id: `season-${seriesId}-${season.number}`,
    scope: 'movies',
    onAccept: () => {
      onFocus(season.number);
      sound.play('accept');
    },
    autoFocus,
  });
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      elementRef.current = element;
      ref(element);
    },
    [ref],
  );

  useEffect(() => {
    if (!focused) return;
    onFocus(season.number);
    glideIntoView(elementRef.current, { block: 'nearest', inline: 'nearest' });
  }, [focused, onFocus, season.number]);

  return (
    <div
      className="season-chip"
      ref={setRef}
      data-active={active ? 'true' : undefined}
      data-focused={focused ? 'true' : undefined}
      role="button"
      aria-label={`${season.title}, ${season.episodeCount} episodes`}
    >
      <span>{season.title}</span>
      <small>{season.episodeCount}</small>
    </div>
  );
}

function EpisodeCard({
  seriesTitle,
  seasonNumber,
  episode,
  onAccept,
}: {
  seriesTitle: string;
  seasonNumber: number;
  episode: MediaEpisode;
  onAccept: (episode: MediaEpisode, element: HTMLElement) => void;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ episode, onAccept });
  useEffect(() => {
    latest.current = { episode, onAccept };
  });
  const accept = useCallback(() => {
    if (elementRef.current) {
      latest.current.onAccept(latest.current.episode, elementRef.current);
    }
  }, []);
  const { ref: focusRef, focused } = useFocusable({
    id: `episode-${episode.id}`,
    scope: 'movies',
    onAccept: accept,
  });
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      elementRef.current = element;
      focusRef(element);
    },
    [focusRef],
  );

  useEffect(() => {
    if (!focused) return;
    glideIntoView(elementRef.current, { block: 'nearest', inline: 'nearest' });
  }, [focused]);

  const number =
    episode.episodeNumber === null
      ? 'Episode'
      : seasonNumber === 0
        ? `Special ${episode.episodeNumber}`
        : `S${seasonNumber} / E${episode.episodeNumber}`;
  const thumbnail = (
    episode as MediaEpisode & { thumbnail?: string | null }
  ).thumbnail;

  return (
    <div
      className="episode-card"
      ref={setRef}
      data-focused={focused ? 'true' : undefined}
      role="button"
      aria-label={`${seriesTitle}, ${number}, ${episode.title}`}
    >
      <div className="episode-card-art">
        {thumbnail && (
          <img
            className="episode-card-thumbnail"
            src={thumbnail}
            alt=""
            loading="lazy"
          />
        )}
        <span className="episode-film-hole episode-film-hole--top" />
        <span className="episode-film-hole episode-film-hole--bottom" />
        <span className="episode-number">{number}</span>
        <span className="episode-play" aria-hidden="true">
          {'\u25b6'}
        </span>
      </div>
      <div className="episode-card-copy">
        <strong>{episode.title}</strong>
        <small>{formatBytes(episode.sizeBytes)}</small>
      </div>
    </div>
  );
}

function EmptyLibrary() {
  return (
    <div className="movies-empty">
      <span className="movies-empty-orbit" aria-hidden="true" />
      <h2>Your library is resting.</h2>
      <p>Import the Kodi collection when you are ready to fill this room.</p>
    </div>
  );
}

function Hint({ badge, label }: { badge: string; label: string }) {
  return (
    <span className="movies-hint">
      <span className="movies-hint-badge" aria-hidden="true">
        {badge}
      </span>
      <span className="movies-hint-label">{label}</span>
    </span>
  );
}

function itemSummary(item: LibraryItem): string {
  const parts: string[] = [];
  if (item.value.year) parts.push(String(item.value.year));
  if (item.value.genres?.[0]) parts.push(item.value.genres[0]);
  if (item.value.rating !== null) {
    parts.push(`${item.value.rating.toFixed(1)} rating`);
  }
  return parts.join(' / ') || librarySummary();
}

function librarySummary(): string {
  const parts = [];
  if (media.series.length > 0) parts.push(`${media.series.length} series`);
  if (media.movies.length > 0) parts.push(`${media.movies.length} movies`);
  return parts.join(' / ') || 'Library';
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function animateDrill(
  element: HTMLElement | null,
  direction: 'deeper' | 'shallower',
  duration: number,
): void {
  if (!element) return;
  const reduced = prefersReducedMotion();
  const offset = direction === 'deeper' ? tuning.drillSlidePx : -tuning.drillSlidePx;
  const frames: Keyframe[] = reduced
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
        { opacity: 0, transform: `translate3d(${offset}px, 0, 0)` },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
      ];
  try {
    element.animate(frames, {
      duration: reduced ? 90 : duration,
      easing: tuning.drillInEase,
    });
  } catch {
    // Cosmetic only; the room remains usable without WAAPI.
  }
}
