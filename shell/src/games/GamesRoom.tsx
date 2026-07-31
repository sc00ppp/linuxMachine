import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  CONSOLES,
  consoleById,
  loadShelf,
  type ConsoleEntry,
  type ShelfGame,
} from '../core/consoles';
import { useConsoleStore } from '../core/store';
import {
  SORT_LABELS,
  cycleSort,
  gameId,
  useUserLibrary,
  type SortMode,
} from '../core/userLibrary';
import { useFocusable } from '../focus';
import { tuning } from '../motion/tuning';
import { sound } from '../sound';
import { BoxArt } from './BoxArt';
import { ConsoleRow } from './ConsoleRow';
import { GameDetail } from './GameDetail';
import { RoomLight } from './RoomLight';
import { cssVars, prefersReducedMotion } from './util';
import './GamesRoom.css';

/**
 * Which machine the room was on last time you were in it.
 *
 * Module-level rather than component state on purpose: the focus engine's
 * per-scope memory survives unmount, so backing out to the wall and coming
 * straight back restores focus to the console tile you left on. If the room
 * reset to the first machine while focus restored to the twelfth, the two
 * would disagree on screen. This keeps them in step — and it is also what
 * `autoFocus` is keyed to, which is what makes walking back out of a library
 * land on the console you just came out of rather than at the head of the
 * shelf (the remembered `game-N` id no longer exists at that point, so the
 * engine falls through to the autoFocus entry).
 */
let lastConsoleId = CONSOLES[0]?.id ?? '';
let lastGameKey: string | null = null;

const titleCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});

function dateRank(value: string | undefined): number {
  if (!value) return 0;
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/.exec(
    value,
  );
  if (!match) return 0;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0),
  );
}

function releaseYear(value: string | undefined): number {
  const match = /^(\d{4})/.exec(value ?? '');
  return match ? Number(match[1]) : 0;
}

/**
 * Sort a decorated copy so equal or missing metadata falls back to import
 * order. The importer already ranks that order thoughtfully, so it is a much
 * better tie-breaker than reshuffling shelves unpredictably.
 */
export function sortShelf(
  shelf: ShelfGame[],
  mode: SortMode,
  consoleId: string,
  favorites: ReadonlySet<string>,
): ShelfGame[] {
  const decorated = shelf.map((entry, index) => ({ entry, index }));
  const alpha = (left: ShelfGame, right: ShelfGame) =>
    titleCollator.compare(left.title, right.title) ||
    titleCollator.compare(left.key, right.key);
  const favorite = (entry: ShelfGame) =>
    favorites.has(gameId(consoleId, entry.key));

  decorated.sort((left, right) => {
    switch (mode) {
      case 'recent':
        return (
          dateRank(right.entry.game?.lastplayed) -
            dateRank(left.entry.game?.lastplayed) ||
          left.index - right.index
        );
      case 'played':
        return (
          (right.entry.game?.playcount ?? 0) -
            (left.entry.game?.playcount ?? 0) ||
          (right.entry.game?.gametime ?? 0) -
            (left.entry.game?.gametime ?? 0) ||
          left.index - right.index
        );
      case 'favorites':
        return (
          Number(favorite(right.entry)) - Number(favorite(left.entry)) ||
          left.index - right.index
        );
      case 'rating':
        // Scraped 0–1 rating, best first. Unrated titles sink rather than
        // scattering through the shelf.
        return (
          (right.entry.game?.rating ?? -1) - (left.entry.game?.rating ?? -1) ||
          alpha(left.entry, right.entry) ||
          left.index - right.index
        );
      case 'alpha':
        return alpha(left.entry, right.entry) || left.index - right.index;
      case 'year':
        return (
          releaseYear(right.entry.game?.releasedate) -
            releaseYear(left.entry.game?.releasedate) ||
          alpha(left.entry, right.entry) ||
          left.index - right.index
        );
      case 'default':
        return left.index - right.index;
    }
  });

  return decorated.map(({ entry }) => entry);
}

/** Contextual Y-button target; App may forward sort input here. */
export function handleGamesSortInput(): void {
  if (useConsoleStore.getState().gamesLevel !== 'grid' || !lastConsoleId) return;
  cycleSort(lastConsoleId);
  sound.play('accept');
}

interface SortControlProps {
  mode: SortMode;
}

function SortControl({ mode }: SortControlProps) {
  const { ref, focused } = useFocusable({
    id: 'games-sort',
    scope: 'games',
    onAccept: handleGamesSortInput,
  });
  const setRef = useCallback(
    (element: HTMLButtonElement | null) => ref(element),
    [ref],
  );

  return (
    <button
      ref={setRef}
      type='button'
      className='games-sort'
      data-focused={focused ? 'true' : undefined}
      aria-label={`Sort: ${SORT_LABELS[mode]}. Select for next sort mode.`}
      onClick={handleGamesSortInput}
    >
      <span className='games-sort-button' aria-hidden='true'>
        Y
      </span>
      <span className='games-sort-caption'>Sort</span>
      <span className='games-sort-value'>{SORT_LABELS[mode]}</span>
    </button>
  );
}

/**
 * The Console Room (DESIGN.md §11) — the full-screen in-shell room that
 * replaces the channel wall while `view === 'games'`.
 *
 * Three levels, all living in the single focus scope 'games' that App
 * activates for this view:
 *
 *   1. `gamesLevel === 'consoles'` — a scrolling row of console tiles,
 *      speaking the channel wall's interaction language exactly.
 *   2. `gamesLevel === 'grid'`     — that console's library as a big dense
 *      box-art grid ("Wii U mode"), the room lit in its accent.
 *
 * Accept walks *down* a level (console → library → launch); B walks back up,
 * and that is App's job (`setGamesLevel('consoles')`, then `closeView()`) —
 * this room never handles back itself.
 */
export function GamesRoom() {
  const level = useConsoleStore((s) => s.gamesLevel);
  const selectedGameKey = useConsoleStore((s) => s.selectedGameKey);
  const userLibrary = useUserLibrary();
  const [activeId, setActiveId] = useState<string>(lastConsoleId);
  const platform: ConsoleEntry = consoleById(activeId) ?? CONSOLES[0];
  const [loadedShelf, setLoadedShelf] = useState<{
    consoleId: string;
    shelf: ShelfGame[];
  } | null>(null);
  // Real library entries (with scraped art) when this system's chunk arrives.
  const shelf =
    loadedShelf?.consoleId === platform.id ? loadedShelf.shelf : [];
  const shelfPending = loadedShelf?.consoleId !== platform.id;
  const sortMode = userLibrary.sort[platform.id] ?? 'default';
  const favorites = new Set(userLibrary.favorites);
  const sortedShelf = sortShelf(shelf, sortMode, platform.id, favorites);
  const detailEntry =
    shelf.find((entry) => entry.key === selectedGameKey) ?? null;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const levelRef = useRef<HTMLDivElement | null>(null);

  // --- entrance ------------------------------------------------------------

  // Drill-in from the wall: the room arrives from the right and settles
  // leftward (tuning.drillInMs). Layout effect so the first painted frame is
  // already the animation's first keyframe — a plain effect lets one frame of
  // the settled room flash first.
  useLayoutEffect(() => {
    animateDrill(rootRef.current, 'deeper', tuning.drillInMs);
  }, []);

  useEffect(() => {
    if (level === 'consoles') return;

    let current = true;
    void loadShelf(platform.id).then(
      (nextShelf) => {
        if (current) {
          setLoadedShelf({ consoleId: platform.id, shelf: nextShelf });
        }
      },
      () => {
        if (current) {
          setLoadedShelf({ consoleId: platform.id, shelf: [] });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [level, platform.id]);

  // A settled console focus quietly warms its chunk. Fast passes across the
  // row do no work, and opening never waits for this best-effort prefetch.
  useEffect(() => {
    if (level !== 'consoles') return;

    const timeout = window.setTimeout(() => {
      void loadShelf(platform.id).catch(() => undefined);
    }, 140);
    return () => window.clearTimeout(timeout);
  }, [level, platform.id]);

  // Level changes speak the same direction language: deeper (console →
  // library) arrives from the right, backing out arrives from the left. The
  // first pass is skipped — the room drill above already covers it.
  const prevLevel = useRef<string | null>(null);
  useLayoutEffect(() => {
    const from = prevLevel.current;
    prevLevel.current = level;
    if (from === null || from === level) return;

    const depth = { consoles: 0, grid: 1, detail: 2 } as const;
    const deeper = depth[level] > depth[from as keyof typeof depth];
    animateDrill(
      levelRef.current,
      deeper ? 'deeper' : 'shallower',
      deeper ? tuning.drillInMs : tuning.drillMs,
    );
  }, [level]);

  // --- level 1: the console shelf ------------------------------------------

  const handleFocusConsole = useCallback((platformId: string) => {
    lastConsoleId = platformId;
    setActiveId(platformId);
  }, []);

  const handleOpenConsole = useCallback((platformId: string) => {
    lastConsoleId = platformId;
    lastGameKey = null;
    setActiveId(platformId);
    sound.play('accept');
    useConsoleStore.getState().setGamesLevel('grid');
  }, []);

  // --- level 2: shelf -------------------------------------------------------

  const handleOpenGame = useCallback((key: string) => {
    lastGameKey = key;
    sound.play('accept');
    useConsoleStore.getState().openGameDetail(key);
  }, []);

  const inGrid = level === 'grid';
  const inDetail = level === 'detail';

  return (
    <div
      className="games"
      ref={rootRef}
      data-level={level}
      style={cssVars({
        // The room's light. Every accent-derived surface reads this.
        '--accent': platform.accent,
        // Motion constants live in tuning.ts; CSS micro-interactions read them
        // from here so they stay in step with the choreography.
        '--focus-ms': `${tuning.focusMoveMs}ms`,
        '--focus-ease': tuning.focusEase,
        '--tint-ms': `${Math.round(tuning.focusMoveMs * 2.4)}ms`,
        // Per-system packaging shape: SNES boxes are near-square, DS/GBA
        // cases are tall, Atari boxes are wide. One ratio letterboxes half
        // the shelf, so the grid takes the console's own aspect.
        '--box-aspect': String(platform.boxAspect),
        // Columns follow the shape: wide N64/PS1 wraps get rows of 3, square
        // SNES/Game Boy boxes 5, tall DS/Switch covers 6. A fixed column
        // count made wide shelves tiny and tall shelves gigantic.
        '--box-cols': String(
          platform.boxAspect >= 1.9
            ? 3
            : platform.boxAspect >= 1.25
              ? 4
              : platform.boxAspect >= 0.85
                ? 5
                : 6,
        ),
      })}
    >
      <RoomLight accent={platform.accent} />

      {!inDetail && (
      <header className="games-header" data-collapse="y">
        <h1 className="games-heading">Games</h1>
        {inGrid && !inDetail ? (
          <>
            <span className="games-crumb" aria-hidden="true">
              ›
            </span>
            <span className="games-console">
              <span className="games-console-glyph" aria-hidden="true">
                {platform.glyph}
              </span>
              {platform.name}
            </span>
            <span className="games-tally">
              {platform.gameCount.toLocaleString()}{' '}
              {platform.gameCount === 1 ? 'game' : 'games'}
              {!shelfPending &&
                platform.gameCount > shelf.length &&
                ` · showing ${shelf.length}`}
            </span>
            <SortControl mode={sortMode} />
          </>
        ) : (
          <span className="games-subhead">Choose a console</span>
        )}
      </header>
      )}

      {/* Keyed on the level so the outgoing screen's scroll position and focus
          registrations are torn down cleanly before the next one mounts. */}
      <div className="games-level" key={level} ref={levelRef}>
        {inDetail && shelfPending ? (
          <div className='games-shelf'>
            <div className='games-grid' aria-hidden='true' />
          </div>
        ) : inDetail && detailEntry ? (
          <GameDetail console={platform} entry={detailEntry} />
        ) : inDetail ? (
          <div className='games-missing-detail glass'>
            <h1>That game moved</h1>
            <p>Press B to return to the library.</p>
          </div>
        ) : inGrid ? (
          <div className="games-shelf">
            {shelfPending ? (
              <div className='games-grid' aria-hidden='true' />
            ) : sortedShelf.length > 0 ? (
              // Cells use the console's own packaging ratio (--box-aspect);
              // artwork is fitted inside, never stretched or cropped.
              <div className="games-grid">
                {sortedShelf.map((entry, i) => (
                  <BoxArt
                    key={entry.key}
                    id={`game-${entry.key}`}
                    title={entry.title}
                    art={entry.art}
                    favorite={favorites.has(gameId(platform.id, entry.key))}
                    // Sorting by rating is meaningless if you can't see the
                    // ratings — show them on the art while that sort is on.
                    rating={sortMode === 'rating' ? (entry.game?.rating ?? null) : null}
                    platform={platform}
                    onAccept={() => handleOpenGame(entry.key)}
                    // Backing out of detail lands on the game that opened it;
                    // a fresh console still starts at the first box.
                    autoFocus={lastGameKey ? entry.key === lastGameKey : i === 0}
                  />
                ))}
              </div>
            ) : (
              <p className="games-empty">No games installed for {platform.name} yet.</p>
            )}
          </div>
        ) : (
          <ConsoleRow
            activeId={activeId}
            onFocusConsole={handleFocusConsole}
            onOpenConsole={handleOpenConsole}
          />
        )}
      </div>

      {!inDetail && (
      <footer className="games-hints" data-collapse="y">
        <span className="games-hint">
          <span className="games-hint-badge" aria-hidden="true">
            A
          </span>
          <span className="games-hint-label">{inGrid ? 'Play' : 'Open'}</span>
        </span>
        <span className="games-hint">
          <span className="games-hint-badge" aria-hidden="true">
            B
          </span>
          <span className="games-hint-label">{inGrid ? 'Consoles' : 'Back'}</span>
        </span>
      </footer>
      )}
    </div>
  );
}

/**
 * The drill: a screen arriving from the direction you came from. Deeper
 * (wall → room, console → library) enters from the right and settles
 * leftward; backing out enters from the left. Purely cosmetic, so every
 * failure path is swallowed — a room that appears without its drill is still
 * a room.
 */
function animateDrill(
  el: HTMLElement | null,
  direction: 'deeper' | 'shallower',
  duration: number,
): void {
  if (!el) return;

  const reduced = prefersReducedMotion();
  const dx = direction === 'deeper' ? tuning.drillSlidePx : -tuning.drillSlidePx;
  const frames: Keyframe[] = reduced
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
        { opacity: 0, transform: `translate3d(${dx}px, 0, 0)` },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
      ];

  try {
    el.animate(frames, {
      duration: reduced ? 90 : duration,
      easing: tuning.drillInEase,
    });
  } catch {
    /* cosmetic only */
  }
}
