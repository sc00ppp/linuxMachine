import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ConsoleEntry, ShelfGame } from '../core/consoles';
import type { GameMod } from '../core/library';
import {
  explainLaunchProblem,
  gameLaunchStatus,
  launchGame,
  stopGame,
  type GameLaunchStatus,
  type LaunchProblem,
} from '../core/launch';
import {
  gameId,
  toggleFavorite,
  togglePin,
  useUserLibrary,
} from '../core/userLibrary';
import { useConsoleStore } from '../core/store';
import { useFocusable } from '../focus';
import {
  Glyph,
  PinIcon,
  PlayIcon,
  SlidersIcon,
  StarIcon,
  StopIcon,
} from '../icons';
import { playLaunch } from '../motion/transitions';
import { sound } from '../sound';
import './GameDetail.css';

interface GameDetailProps {
  console: ConsoleEntry;
  entry: ShelfGame;
}

interface DetailActionProps {
  id: string;
  label: string;
  icon: ReactNode;
  onAccept: () => void;
  autoFocus?: boolean;
  primary?: boolean;
  pressed?: boolean;
}

interface Fact {
  label: string;
  value: string;
  stars?: boolean;
}

type LaunchPhase = 'starting' | 'running' | 'stopping' | 'ended' | 'error';

interface ActiveLaunch {
  phase: LaunchPhase;
  title: string;
  systemId: string;
  romPath: string;
  status?: GameLaunchStatus;
  problem?: LaunchProblem;
}

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * A spatial-focus button with the same crisp, accent-lit cursor as tiles.
 * Keeping this tiny component separate lets the detail page conditionally
 * render controls without conditionally calling hooks.
 */
function DetailAction({
  id,
  label,
  icon,
  onAccept,
  autoFocus = false,
  primary = false,
  pressed,
}: DetailActionProps) {
  const { ref, focused } = useFocusable({
    id,
    scope: 'games',
    onAccept,
    autoFocus,
  });
  const setRef = useCallback(
    (element: HTMLButtonElement | null) => ref(element),
    [ref],
  );

  return (
    <button
      ref={setRef}
      className="game-detail-action"
      data-primary={primary ? 'true' : undefined}
      data-focused={focused ? 'true' : undefined}
      type="button"
      aria-pressed={pressed}
      onClick={onAccept}
    >
      <span className="game-detail-action-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

function parseLibraryDate(value: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/.exec(
    value.trim(),
  );
  if (!match) return null;

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function releaseYear(value: string): string {
  const match = /^(\d{4})/.exec(value.trim());
  return match?.[1] ?? '';
}

function formatRelative(value: string): string {
  const date = parseLibraryDate(value);
  if (!date) return '';

  const seconds = Math.round((date.getTime() - Date.now()) / 1_000);
  const absolute = Math.abs(seconds);
  if (absolute < 60) return 'just now';

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const [unit, size] =
    units.find(([, unitSize]) => absolute >= unitSize) ??
    (['minute', 60] as const);
  return relativeTime.format(Math.round(seconds / size), unit);
}

function formatPlaytime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

function ratingStars(rating: number | null): string {
  if (rating === null || !Number.isFinite(rating) || rating <= 0) return '';
  // EmulationStation stores ratings as 0..1. Accept a 0..5 value as well so
  // the view remains useful if a future importer normalizes differently.
  const outOfFive = rating <= 1 ? rating * 5 : rating;
  const filled = Math.max(0, Math.min(5, Math.round(outOfFive)));
  return `${'★'.repeat(filled)}${'☆'.repeat(5 - filled)}`;
}

/**
 * The star string above, drawn with the icon set. The ★/☆ text stays the
 * source of truth (and the aria-label), this just renders it.
 */
function StarRow({ value }: { value: string }) {
  const filled = (value.match(/★/g) ?? []).length;
  return (
    <span className="game-detail-stars" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <StarIcon key={i} filled={i < filled} />
      ))}
    </span>
  );
}

/**
 * The preview clip, already an absolute URL.
 *
 * This used to reconstruct a local `/game-video/<system>/<slug>.mp4` path from
 * the art filename, back when the importer copied media into `public/`. Media
 * is served off the media PC over the LAN now and `library.ts` resolves
 * `video` through `mediaHost`, so rebuilding a path here only invented one
 * that does not exist.
 */
function previewVideo(entry: ShelfGame): string | null {
  return entry.game?.video ?? null;
}

function fact(label: string, value: string, stars = false): Fact | null {
  const clean = value.trim();
  return clean ? { label, value: clean, stars } : null;
}

function compactFacts(facts: Array<Fact | null>): Fact[] {
  return facts.filter((item): item is Fact => item !== null);
}

/**
 * One romhack, launchable from the page of the game it modifies.
 *
 * Mods carry no art of their own — nobody scrapes box art for a hack — so the
 * card is typographic rather than a box with a hole in it.
 */
function ModCard({
  mod,
  index,
  onPlay,
}: {
  mod: GameMod;
  index: number;
  onPlay: (mod: GameMod) => void;
}) {
  const latestPlay = useRef(onPlay);
  latestPlay.current = onPlay;
  const { ref, focused } = useFocusable({
    id: `detail-mod-${index}`,
    scope: 'games',
    onAccept: () => latestPlay.current(mod),
  });
  const setRef = useCallback(
    (element: HTMLButtonElement | null) => ref(element),
    [ref],
  );

  return (
    <button
      ref={setRef}
      className="game-detail-mod"
      type="button"
      tabIndex={-1}
      data-focused={focused ? 'true' : undefined}
      aria-label={`Play mod: ${mod.name}`}
      onClick={() => onPlay(mod)}
    >
      <span className="game-detail-mod-glyph" aria-hidden="true">
        ⎇
      </span>
      <span className="game-detail-mod-name">{mod.name}</span>
    </button>
  );
}

function GameNowPlaying({
  launch,
  consoleEntry,
  art,
  onStop,
  onDismiss,
  onRetry,
}: {
  launch: ActiveLaunch;
  consoleEntry: ConsoleEntry;
  art: string | null;
  onStop: () => void;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const isBusy = launch.phase === 'starting' || launch.phase === 'stopping';
  const mayStillBeRunning = launch.phase === 'error' && launch.status?.running;
  const headline = launch.phase === 'starting'
    ? 'Starting emulator…'
    : launch.phase === 'running'
      ? 'Now playing'
      : launch.phase === 'stopping'
        ? 'Returning to the console…'
        : launch.phase === 'ended'
          ? 'Session ended'
          : launch.problem?.title ?? 'Game did not start';
  const detail = launch.phase === 'running'
    ? [launch.status?.emulator, launch.status?.core]
        .filter(Boolean)
        .join(' / ') || `${consoleEntry.name} is running`
    : launch.phase === 'ended'
      ? 'The emulator has closed. The rest of your library is still here.'
      : launch.problem?.detail ?? 'Waiting for the emulator to report a running process.';

  return (
    <article
      className="game-now-playing"
      aria-label={`${headline}: ${launch.title}`}
      style={{ '--accent': consoleEntry.accent } as CSSProperties}
    >
      {art && <img className="game-now-playing-art" src={art} alt="" />}
      <div className="game-now-playing-shade" />
      <section className="game-now-playing-card glass glass--strong" role="status">
        <span className="game-now-playing-glyph" aria-hidden="true">
          {launch.phase === 'error' ? (
            '!'
          ) : (
            <Glyph id={consoleEntry.id} fallback={consoleEntry.glyph} />
          )}
        </span>
        <p>{headline}</p>
        <h1>{launch.title}</h1>
        <span className="game-now-playing-detail">{detail}</span>
        {isBusy && <span className="game-now-playing-pulse" aria-hidden="true" />}

        <div className="game-now-playing-actions">
          {(launch.phase === 'running' || mayStillBeRunning) && (
            <DetailAction
              id="detail-stop-game"
              label="Stop and return"
              icon={<StopIcon />}
              onAccept={onStop}
              autoFocus
              primary
            />
          )}
          {launch.phase === 'error' && !mayStillBeRunning && (
            <DetailAction
              id="detail-retry-game"
              label="Try again"
              icon="↻"
              onAccept={onRetry}
              autoFocus
              primary
            />
          )}
          {((launch.phase === 'error' && !mayStillBeRunning) ||
            launch.phase === 'ended') && (
            <DetailAction
              id="detail-dismiss-launch"
              label="Back to game"
              icon="←"
              onAccept={onDismiss}
              autoFocus={launch.phase === 'ended'}
            />
          )}
        </div>
      </section>
      <footer className="game-now-playing-hint">
        B always stops the session and returns to the shelf
      </footer>
    </article>
  );
}

/** The metadata-rich console game page from DESIGN.md §11b. */
export function GameDetail({ console: consoleEntry, entry }: GameDetailProps) {
  const library = useUserLibrary();
  const heroRef = useRef<HTMLDivElement | null>(null);
  const launching = useRef(false);
  const mounted = useRef(true);
  const running = useRef(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [activeLaunch, setActiveLaunch] = useState<ActiveLaunch | null>(null);
  const videoSrc = useMemo(() => previewVideo(entry), [entry]);
  const id = gameId(consoleEntry.id, entry.key);
  const favorite = library.favorites.includes(id);
  const pinned = library.pins.some((pin) => pin.id === id);
  const game = entry.game;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sound.duck(false);
      if (running.current) {
        running.current = false;
        void stopGame();
      }
    };
  }, [entry.key]);

  useEffect(() => {
    setVideoFailed(false);
  }, [videoSrc]);

  const metadata = useMemo(
    () =>
      compactFacts([
        fact('Developer', game?.developer ?? ''),
        fact('Publisher', game?.publisher ?? ''),
        fact('Year', releaseYear(game?.releasedate ?? '')),
        fact('Genre', game?.genre ?? ''),
        fact('Players', game?.players ?? ''),
        fact('Rating', ratingStars(game?.rating ?? null), true),
      ]),
    [game],
  );

  const history = useMemo(
    () =>
      compactFacts([
        fact('Last played', formatRelative(game?.lastplayed ?? '')),
        fact('Play time', formatPlaytime(game?.gametime ?? 0)),
        fact(
          'Played',
          game && game.playcount > 0
            ? `${game.playcount.toLocaleString()} ${
                game.playcount === 1 ? 'time' : 'times'
              }`
            : '',
        ),
      ]),
    [game],
  );

  /**
   * Launch this game, or one of its mods. A mod boots the same emulator with a
   * different ROM, so it is the same choreography with a different title —
   * there is no reason for it to feel like a lesser way to start playing.
   */
  const beginDaemonLaunch = useCallback(
    async (target: ActiveLaunch) => {
      setActiveLaunch({ ...target, phase: 'starting' });
      try {
        const status = await launchGame(target.systemId, target.romPath);
        if (!mounted.current) {
          void stopGame();
          return;
        }
        running.current = status.running;
        setActiveLaunch({ ...target, phase: 'running', status });
      } catch (error) {
        if (!mounted.current) return;
        running.current = false;
        launching.current = false;
        sound.duck(false);
        setActiveLaunch({
          ...target,
          phase: 'error',
          problem: explainLaunchProblem(error, target.systemId),
        });
      }
    },
    [],
  );

  const launch = useCallback(
    async (title: string, romPath: string | null) => {
      const hero = heroRef.current;
      if (!hero || launching.current) return;
      const systemId = game?.systemId ?? consoleEntry.id;
      if (!romPath) {
        setActiveLaunch({
          phase: 'error',
          title,
          systemId,
          romPath: '',
          problem: {
            title: 'ROM path missing',
            detail: 'This library entry has no source ROM path, so no emulator was started.',
          },
        });
        return;
      }
      launching.current = true;

      sound.play('launch');
      sound.duck(true);
      try {
        await playLaunch(hero, consoleEntry.accent);
      } catch {
        // The choreography is cosmetic; a failed animation must not strand Play.
      }
      await beginDaemonLaunch({
        phase: 'starting',
        title,
        systemId,
        romPath,
      });
    },
    [beginDaemonLaunch, consoleEntry.accent, consoleEntry.id, game?.systemId],
  );

  const play = useCallback(
    () => launch(entry.title, game?.path ?? null),
    [entry.title, game?.path, launch],
  );
  const playMod = useCallback(
    (mod: GameMod) => void launch(mod.name, mod.path),
    [launch],
  );

  useEffect(() => {
    if (activeLaunch?.phase !== 'running') return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const status = await gameLaunchStatus();
        if (cancelled) return;
        if (!status.running) {
          running.current = false;
          launching.current = false;
          sound.duck(false);
          setActiveLaunch((current) => current
            ? { ...current, phase: 'ended', status }
            : current);
          return;
        }
        setActiveLaunch((current) => current
          ? { ...current, status }
          : current);
      } catch (error) {
        if (cancelled) return;
        setActiveLaunch((current) => current
          ? {
              ...current,
              phase: 'error',
              problem: explainLaunchProblem(error, current.systemId),
            }
          : current);
        return;
      }
      timer = window.setTimeout(poll, 1_500);
    };
    timer = window.setTimeout(poll, 1_500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeLaunch?.phase]);

  const stopRunningGame = useCallback(async () => {
    setActiveLaunch((current) => current
      ? { ...current, phase: 'stopping' }
      : current);
    try {
      const status = await stopGame();
      running.current = false;
      launching.current = false;
      sound.duck(false);
      setActiveLaunch((current) => current
        ? { ...current, phase: 'ended', status }
        : current);
    } catch (error) {
      setActiveLaunch((current) => current
        ? {
            ...current,
            phase: 'error',
            problem: explainLaunchProblem(error, current.systemId),
          }
        : current);
    }
  }, []);

  const dismissLaunch = useCallback(() => {
    if (running.current) return;
    launching.current = false;
    sound.duck(false);
    setActiveLaunch(null);
  }, []);

  const retryLaunch = useCallback(() => {
    if (!activeLaunch || running.current) return;
    launching.current = true;
    sound.duck(true);
    void beginDaemonLaunch(activeLaunch);
  }, [activeLaunch, beginDaemonLaunch]);

  const favoriteGame = useCallback(() => {
    toggleFavorite(consoleEntry.id, entry.key);
    sound.play('accept');
  }, [consoleEntry.id, entry.key]);

  const openControls = useCallback(() => {
    sound.play('accept');
    useConsoleStore.getState().openRemap(consoleEntry.id);
  }, [consoleEntry.id]);

  const pinGame = useCallback(() => {
    togglePin({
      consoleId: consoleEntry.id,
      gameKey: entry.key,
      title: entry.title,
      art: entry.art,
      accent: consoleEntry.accent,
      glyph: consoleEntry.glyph,
    });
    sound.play('accept');
  }, [
    consoleEntry.accent,
    consoleEntry.glyph,
    consoleEntry.id,
    entry.art,
    entry.key,
    entry.title,
  ]);

  const showVideo = Boolean(videoSrc) && !videoFailed;

  if (activeLaunch) {
    return (
      <GameNowPlaying
        launch={activeLaunch}
        consoleEntry={consoleEntry}
        art={entry.art}
        onStop={() => void stopRunningGame()}
        onDismiss={dismissLaunch}
        onRetry={retryLaunch}
      />
    );
  }

  return (
    <article className="game-detail" aria-labelledby="game-detail-title">
      <div className="game-detail-visual">
        <div
          className="game-detail-hero glass glass--strong"
          ref={heroRef}
          aria-label={`${entry.title} preview`}
        >
          {entry.art && (
            <img
              className="game-detail-backdrop"
              src={entry.art}
              alt=""
              aria-hidden="true"
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          )}
          {showVideo && (
            <video
              key={videoSrc}
              className="game-detail-video"
              src={videoSrc ?? undefined}
              poster={entry.art ?? undefined}
              muted
              loop
              autoPlay
              playsInline
              preload="metadata"
              onError={() => setVideoFailed(true)}
            />
          )}
          <div className="game-detail-hero-shade" />

          {entry.art ? (
            <img
              className="game-detail-cover"
              src={entry.art}
              alt=""
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          ) : (
            <div className="game-detail-cover-fallback">
              <span aria-hidden="true">
                <Glyph id={consoleEntry.id} fallback={consoleEntry.glyph} />
              </span>
              <strong>{entry.title}</strong>
            </div>
          )}

          <span
            className="game-detail-launch-glyph tile-glyph"
            aria-hidden="true"
          >
            <Glyph id={consoleEntry.id} fallback={consoleEntry.glyph} />
          </span>
        </div>
      </div>

      <div className="game-detail-copy" data-collapse="fade">
        <header className="game-detail-heading">
          <p className="game-detail-eyebrow">
            <Glyph id={consoleEntry.id} fallback={consoleEntry.glyph} />{' '}
            {consoleEntry.name}
          </p>
          <h1 id="game-detail-title">{entry.title}</h1>
        </header>

        {(metadata.length > 0 || history.length > 0) && (
          <div className="game-detail-facts glass">
            {metadata.length > 0 && (
              <dl className="game-detail-fact-group">
                {metadata.map((item) => (
                  <div className="game-detail-fact" key={item.label}>
                    <dt>{item.label}</dt>
                    <dd
                      className={
                        item.stars ? 'game-detail-rating' : undefined
                      }
                      aria-label={
                        item.stars ? `${item.value} rating` : undefined
                      }
                    >
                      {item.stars ? <StarRow value={item.value} /> : item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {history.length > 0 && (
              <section className="game-detail-history">
                <h2>Your history</h2>
                <dl className="game-detail-fact-group">
                  {history.map((item) => (
                    <div className="game-detail-fact" key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </div>
        )}

        {game?.desc.trim() && (
          <section className="game-detail-description">
            <h2>About</h2>
            <p>{game.desc.trim()}</p>
          </section>
        )}

        <div className="game-detail-actions">
          <DetailAction
            id="detail-play"
            label="Play"
            icon={<PlayIcon />}
            onAccept={play}
            autoFocus
            primary
          />
          <DetailAction
            id="detail-favorite"
            label={favorite ? 'Favorited' : 'Favorite'}
            icon={<StarIcon filled={favorite} />}
            onAccept={favoriteGame}
            pressed={favorite}
          />
          <DetailAction
            id="detail-controls"
            label="Controls"
            icon={<SlidersIcon />}
            onAccept={openControls}
          />
          <DetailAction
            id="detail-pin"
            label={pinned ? 'Pinned to Home' : 'Pin to Home'}
            icon={<PinIcon filled={pinned} />}
            onAccept={pinGame}
            pressed={pinned}
          />
        </div>

        {game?.mods && game.mods.length > 0 && (
          <section className="game-detail-mods">
            <h2>
              Mods
              <span className="game-detail-mods-count">
                {game.mods.length}
              </span>
            </h2>
            <div className="game-detail-mod-row">
              {game.mods.map((mod, index) => (
                <ModCard
                  key={mod.path || mod.name}
                  mod={mod}
                  index={index}
                  onPlay={playMod}
                />
              ))}
            </div>
          </section>
        )}

        <footer className="game-detail-hint">
          <span className="game-detail-hint-badge" aria-hidden="true">
            B
          </span>
          <span>Back to games</span>
        </footer>
      </div>
    </article>
  );
}
