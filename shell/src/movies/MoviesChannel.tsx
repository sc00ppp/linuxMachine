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
import './MoviesChannel.css';

type MoviesLevel = 'library' | 'episodes';

/*
 * The integrator owns Back and may add these fields to the store when the
 * route lands. Until then the room still works: accepting a series uses local
 * level state, and Back leaves the channel through App's existing closeView.
 * Once wired, App can change moviesLevel and the component follows it without
 * any input listener of its own.
 */
interface MoviesStoreBridge {
  moviesLevel?: MoviesLevel;
  setMoviesLevel?: (level: MoviesLevel) => void;
}

type LibraryItem =
  | { kind: 'series'; value: MediaSeries }
  | { kind: 'movie'; value: MediaMovie };

let lastSeriesId = media.series[0]?.id ?? null;

const cssVars = (vars: Record<string, string | number>): CSSProperties =>
  vars as CSSProperties;

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function MoviesChannel() {
  const wiredLevel = useConsoleStore(
    (state) => (state as unknown as MoviesStoreBridge).moviesLevel,
  );
  const setWiredLevel = useConsoleStore(
    (state) => (state as unknown as MoviesStoreBridge).setMoviesLevel,
  );
  const [localLevel, setLocalLevel] = useState<MoviesLevel>('library');
  const level = wiredLevel ?? localLevel;

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

  const libraryItems = useMemo<LibraryItem[]>(
    () => [
      ...media.series.map((value) => ({ kind: 'series' as const, value })),
      ...media.movies.map((value) => ({ kind: 'movie' as const, value })),
    ],
    [],
  );
  const [highlightedItem, setHighlightedItem] = useState<LibraryItem | null>(
    libraryItems[0] ?? null,
  );

  const rootRef = useRef<HTMLDivElement | null>(null);
  const levelRef = useRef<HTMLDivElement | null>(null);
  const busy = useRef(false);

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

  const launchTitle = useCallback(async (title: string, element: HTMLElement) => {
    if (busy.current) return;
    busy.current = true;
    sound.play('launch');
    sound.duck(true);
    try {
      await playLaunch(element, channelById('movies')?.accent ?? 'var(--accent)');
    } finally {
      // This is intentionally the app simulator for now. Actual file playback
      // needs the daemon to resolve and launch the remote library path.
      useConsoleStore.getState().launchApp('movies', title);
    }
  }, []);

  const launchEpisode = useCallback(
    (episode: MediaEpisode, element: HTMLElement) => {
      const title = selectedSeries
        ? `${selectedSeries.title} · ${episode.title}`
        : episode.title;
      void launchTitle(title, element);
    },
    [launchTitle, selectedSeries],
  );

  const accent = channelById('movies')?.accent ?? 'var(--accent)';
  const isEpisodes = level === 'episodes' && selectedSeries !== null;
  const headerTitle = isEpisodes
    ? selectedSeries.title
    : highlightedItem?.value.title ?? 'Movies & TV';
  const headerMeta = isEpisodes
    ? `${selectedSeries.episodeCount} episodes · ${formatBytes(selectedSeries.totalBytes)}`
    : librarySummary();

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
      <div className="movies-light" aria-hidden="true" />

      <header className="movies-header" data-collapse="y">
        <div className="movies-titleline">
          <h1 className="movies-heading">Movies &amp; TV</h1>
          {isEpisodes && <span className="movies-crumb">›</span>}
          <span className="movies-current">{headerTitle}</span>
        </div>
        <span className="movies-tally">{headerMeta}</span>
      </header>

      <div className="movies-level" key={isEpisodes ? 'episodes' : 'library'} ref={levelRef}>
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
          <div className="movies-row-scroller">
            <div className="movies-row">
              {libraryItems.map((item, index) => (
                <MediaPoster
                  key={`${item.kind}-${item.value.id}`}
                  item={item}
                  autoFocus={
                    item.kind === 'series'
                      ? item.value.id === (lastSeriesId ?? media.series[0]?.id)
                      : index === 0 && media.series.length === 0
                  }
                  onFocus={setHighlightedItem}
                  onAccept={(element) => {
                    if (item.kind === 'series') {
                      openSeries(item.value);
                    } else {
                      void launchTitle(item.value.title, element);
                    }
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <footer className="movies-hints" data-collapse="y">
        {hasMedia && (
          <Hint badge="A" label={isEpisodes ? 'Watch' : 'Open'} />
        )}
        <Hint
          badge="B"
          label={
            isEpisodes && setWiredLevel ? 'Library' : 'Back'
          }
        />
      </footer>
    </main>
  );
}

function MediaPoster({
  item,
  autoFocus,
  onFocus,
  onAccept,
}: {
  item: LibraryItem;
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
    id: `media-${item.kind}-${item.value.id}`,
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
    elementRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      inline: 'nearest',
      block: 'nearest',
    });
  }, [focused, item, onFocus]);

  const poster = item.value.poster;
  const details =
    item.kind === 'series'
      ? `${item.value.episodeCount} episodes`
      : item.value.year?.toString() ?? formatBytes(item.value.sizeBytes);

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
              <span className="media-poster-fallback-title">{item.value.title}</span>
            </div>
          )}
          <span className="media-poster-kind">
            {item.kind === 'series' ? 'Series' : 'Movie'}
          </span>
          <div className="media-poster-sheen" />
          <div className="media-poster-rim" />
        </div>
      </div>
      <div className={`media-poster-label${focused ? ' is-focused' : ''}`}>
        <span>{item.value.title}</span>
        <small>{details}</small>
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
    elementRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      inline: 'nearest',
      block: 'nearest',
    });
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
    elementRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      inline: 'nearest',
      block: 'nearest',
    });
  }, [focused]);

  const number =
    episode.episodeNumber === null
      ? 'Episode'
      : seasonNumber === 0
        ? `Special ${episode.episodeNumber}`
        : `S${seasonNumber} · E${episode.episodeNumber}`;

  return (
    <div
      className="episode-card"
      ref={setRef}
      data-focused={focused ? 'true' : undefined}
      role="button"
      aria-label={`${seriesTitle}, ${number}, ${episode.title}`}
    >
      <div className="episode-card-art">
        <span className="episode-film-hole episode-film-hole--top" />
        <span className="episode-film-hole episode-film-hole--bottom" />
        <span className="episode-number">{number}</span>
        <span className="episode-play" aria-hidden="true">
          ▶
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
      <p>Import the Kodi collection when you’re ready to fill this room.</p>
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

function librarySummary(): string {
  const parts = [];
  if (media.series.length > 0) {
    parts.push(
      `${media.series.length} ${media.series.length === 1 ? 'series' : 'series'}`,
    );
  }
  if (media.movies.length > 0) {
    parts.push(
      `${media.movies.length} ${media.movies.length === 1 ? 'movie' : 'movies'}`,
    );
  }
  return parts.join(' · ') || 'Library';
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
  const offset =
    direction === 'deeper' ? tuning.drillSlidePx : -tuning.drillSlidePx;
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
    // Cosmetic only; the room remains fully usable without WAAPI.
  }
}
