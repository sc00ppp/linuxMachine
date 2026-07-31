import { CONSOLES, type ConsoleEntry } from '../core/consoles';
import { ConsoleTile } from './ConsoleTile';
import './ConsoleRow.css';

interface ConsoleRowProps {
  /** Console the room is currently lit by — the focused one. */
  activeId: string;
  onFocusConsole: (platformId: string) => void;
  onOpenConsole: (platformId: string) => void;
}

/** Fixed leaders, then earned shelves, an "Other" catch-all, PC last. */
const PRIORITY_MAKERS = ['Nintendo', 'PlayStation', 'Sega', 'Xbox'] as const;
const priorityMakerSet = new Set<string>(PRIORITY_MAKERS);
const presentMakers = new Set(CONSOLES.map((console) => console.maker));

/**
 * A maker earns its own shelf at 3+ machines (DESIGN.md §11). The four majors
 * always keep theirs however few they hold; everyone else — Coleco with one
 * machine, Fairchild with one — shares a single "Other" shelf, because a
 * full-width row holding one tile reads as a layout bug, not a category.
 */
const OTHER = 'Other';
const MIN_FOR_OWN_ROW = 3;

const countFor = (maker: string) =>
  CONSOLES.reduce((n, c) => (c.maker === maker ? n + 1 : n), 0);

const earnedMakers = [...presentMakers]
  .filter(
    (maker) =>
      !priorityMakerSet.has(maker) &&
      maker !== 'PC' &&
      countFor(maker) >= MIN_FOR_OWN_ROW,
  )
  .sort((a, b) => a.localeCompare(b));

const earnedSet = new Set(earnedMakers);

const hasOther = CONSOLES.some(
  (c) => !priorityMakerSet.has(c.maker) && c.maker !== 'PC' && !earnedSet.has(c.maker),
);

const MAKERS: string[] = [
  ...PRIORITY_MAKERS.filter((maker) => presentMakers.has(maker)),
  ...earnedMakers,
  ...(hasOther ? [OTHER] : []),
  // PC remains a shelf even while it holds one library (or none): Steam is
  // one source among GOG, Epic and standalone installs that can fill it later.
  'PC',
];

/** Consoles on a shelf, chronological (CONSOLES is already year-ordered). */
const byMaker = (maker: string): ConsoleEntry[] =>
  maker === OTHER
    ? CONSOLES.filter(
        (p) => !priorityMakerSet.has(p.maker) && p.maker !== 'PC' && !earnedSet.has(p.maker),
      )
    : CONSOLES.filter((p) => p.maker === maker);

/**
 * Level 1 — the console picker (DESIGN.md §11).
 *
 * A vertical stack with one independently scrolling shelf per maker. Tiles
 * stay fixed-width and every shelf uses the channel wall's edge scrolling:
 * `scroll-padding-inline` here + `scrollIntoView` in ConsoleTile.
 *
 * The focus engine's geometry keeps left/right within a shelf and sends
 * up/down between makers. That same tile scroll call moves the outer stack
 * vertically when the next maker is beyond the viewport.
 */
export function ConsoleRow({ activeId, onFocusConsole, onOpenConsole }: ConsoleRowProps) {
  return (
    <div className="crow">
      <div className="crow-stack">
        {MAKERS.map((maker) => {
          const platforms = byMaker(maker);
          const machineLabel = `${platforms.length} ${
            platforms.length === 1 ? 'machine' : 'machines'
          }`;

          return (
            <section className="crow-group" key={maker}>
              <h2 className="crow-maker">
                <span className="crow-maker-name">{maker}</span>
                <span className="crow-maker-count">{machineLabel}</span>
              </h2>
              <div className="crow-scroller">
                <div className="crow-tiles">
                  {platforms.map((platform) => (
                    <ConsoleTile
                      key={platform.id}
                      platform={platform}
                      onFocus={onFocusConsole}
                      onOpen={onOpenConsole}
                      // The machine you were last on takes focus when the
                      // scope activates without usable memory — that is what
                      // makes backing out of a library land you where you
                      // left, not at the start of the room.
                      autoFocus={platform.id === activeId}
                    />
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
