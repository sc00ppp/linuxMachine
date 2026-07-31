import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CONSOLES, consoleById, shelfFor, type ConsoleEntry } from '../core/consoles';
import { useConsoleStore } from '../core/store';
import { playLaunch } from '../motion/transitions';
import { tuning } from '../motion/tuning';
import { sound } from '../sound';
import { BoxArt } from './BoxArt';
import { ConsoleRow } from './ConsoleRow';
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

/**
 * The Console Room (DESIGN.md §11) — the full-screen in-shell room that
 * replaces the channel wall while `view === 'games'`.
 *
 * Two levels, both living in the single focus scope 'games' that App
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
  const [activeId, setActiveId] = useState<string>(lastConsoleId);
  const platform: ConsoleEntry = consoleById(activeId) ?? CONSOLES[0];
  // Real library entries (with scraped art) when the import has run.
  const shelf = shelfFor(platform.id);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const levelRef = useRef<HTMLDivElement | null>(null);
  /** Blocks a second accept while a launch transition is in flight. */
  const busy = useRef(false);
  /** Current platform for the stable, engine-held accept callbacks. */
  const platformRef = useRef(platform);
  useEffect(() => {
    platformRef.current = platform;
  });

  // --- entrance ------------------------------------------------------------

  // Drill-in from the wall: the room arrives from the right and settles
  // leftward (tuning.drillInMs). Layout effect so the first painted frame is
  // already the animation's first keyframe — a plain effect lets one frame of
  // the settled room flash first.
  useLayoutEffect(() => {
    animateDrill(rootRef.current, 'deeper', tuning.drillInMs);
  }, []);

  // Level changes speak the same direction language: deeper (console →
  // library) arrives from the right, backing out arrives from the left. The
  // first pass is skipped — the room drill above already covers it.
  const prevLevel = useRef<string | null>(null);
  useLayoutEffect(() => {
    const from = prevLevel.current;
    prevLevel.current = level;
    if (from === null || from === level) return;

    const deeper = level === 'grid';
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
    setActiveId(platformId);
    sound.play('accept');
    useConsoleStore.getState().setGamesLevel('grid');
  }, []);

  // --- level 2: launch ------------------------------------------------------

  const handlePlay = useCallback(async (title: string, el: HTMLElement) => {
    if (busy.current) return;
    busy.current = true;

    const accent = platformRef.current.accent;
    sound.play('launch');
    // Stay ducked past the transition; the return flow un-ducks on the wall.
    sound.duck(true);
    try {
      await playLaunch(el, accent);
    } finally {
      // Even if the choreography fails, never strand the user in a
      // half-collapsed room.
      useConsoleStore.getState().launchApp('games', title);
    }
  }, []);

  const inGrid = level === 'grid';

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
      })}
    >
      <RoomLight accent={platform.accent} />

      <header className="games-header" data-collapse="y">
        <h1 className="games-heading">Games</h1>
        {inGrid ? (
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
              {platform.gameCount > shelf.length && ` · showing ${shelf.length}`}
            </span>
          </>
        ) : (
          <span className="games-subhead">Choose a console</span>
        )}
      </header>

      {/* Keyed on the level so the outgoing screen's scroll position and focus
          registrations are torn down cleanly before the next one mounts. */}
      <div className="games-level" key={level} ref={levelRef}>
        {inGrid ? (
          <div className="games-shelf">
            {shelf.length > 0 ? (
              <div className="games-grid">
                {shelf.map((entry, i) => (
                  <BoxArt
                    key={entry.key}
                    id={`game-${i}`}
                    title={entry.title}
                    art={entry.art}
                    platform={platform}
                    onAccept={handlePlay}
                    // Drilling into a library always lands on the first box.
                    autoFocus={i === 0}
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
