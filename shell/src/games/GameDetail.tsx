import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ConsoleEntry, ShelfGame } from '../core/consoles';
import {
  gameId,
  toggleFavorite,
  togglePin,
  useUserLibrary,
} from '../core/userLibrary';
import { useConsoleStore } from '../core/store';
import { useFocusable } from '../focus';
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
  icon: string;
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

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'game';
}

/**
 * Art and preview files share the importer's assigned slug. Reading it back
 * from the public art path also preserves collision hashes, which cannot be
 * reconstructed from the title alone.
 */
function previewVideo(entry: ShelfGame): string | null {
  const game = entry.game;
  if (!game?.video) return null;

  const artMatch = /^\/art\/([^/]+)\/([^/?#]+)\.[^/?#]+/.exec(entry.art ?? '');
  const system = artMatch?.[1] ?? game.systemId;
  const slug = artMatch?.[2] ?? slugify(game.name);
  return `/game-video/${encodeURIComponent(system)}/${encodeURIComponent(slug)}.mp4`;
}

function fact(label: string, value: string, stars = false): Fact | null {
  const clean = value.trim();
  return clean ? { label, value: clean, stars } : null;
}

function compactFacts(facts: Array<Fact | null>): Fact[] {
  return facts.filter((item): item is Fact => item !== null);
}

/** The metadata-rich console game page from DESIGN.md §11b. */
export function GameDetail({ console: consoleEntry, entry }: GameDetailProps) {
  const library = useUserLibrary();
  const heroRef = useRef<HTMLDivElement | null>(null);
  const launching = useRef(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const videoSrc = useMemo(() => previewVideo(entry), [entry]);
  const id = gameId(consoleEntry.id, entry.key);
  const favorite = library.favorites.includes(id);
  const pinned = library.pins.some((pin) => pin.id === id);
  const game = entry.game;

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

  const play = useCallback(async () => {
    const hero = heroRef.current;
    if (!hero || launching.current) return;
    launching.current = true;

    sound.play('launch');
    sound.duck(true);
    try {
      await playLaunch(hero, consoleEntry.accent);
    } finally {
      useConsoleStore.getState().launchApp('games', entry.title);
    }
  }, [consoleEntry.accent, entry.title]);

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
    });
    sound.play('accept');
  }, [consoleEntry.id, entry.art, entry.key, entry.title]);

  const showVideo = Boolean(videoSrc) && !videoFailed;

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
              <span aria-hidden="true">{consoleEntry.glyph}</span>
              <strong>{entry.title}</strong>
            </div>
          )}

          <span
            className="game-detail-launch-glyph tile-glyph"
            aria-hidden="true"
          >
            {consoleEntry.glyph}
          </span>
          {showVideo && (
            <span className="game-detail-preview-label">Preview</span>
          )}
        </div>
      </div>

      <div className="game-detail-copy" data-collapse="fade">
        <header className="game-detail-heading">
          <p className="game-detail-eyebrow">
            {consoleEntry.glyph} {consoleEntry.name}
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
                      {item.value}
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
            icon="▶"
            onAccept={play}
            autoFocus
            primary
          />
          <DetailAction
            id="detail-favorite"
            label={favorite ? 'Favorited' : 'Favorite'}
            icon={favorite ? '★' : '☆'}
            onAccept={favoriteGame}
            pressed={favorite}
          />
          <DetailAction
            id="detail-controls"
            label="Controls"
            icon="⌁"
            onAccept={openControls}
          />
          <DetailAction
            id="detail-pin"
            label={pinned ? 'Pinned to Home' : 'Pin to Home'}
            icon={pinned ? '◆' : '◇'}
            onAccept={pinGame}
            pressed={pinned}
          />
        </div>

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
