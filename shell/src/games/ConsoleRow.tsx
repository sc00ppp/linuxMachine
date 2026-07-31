import { CONSOLES, type ConsoleEntry } from '../core/consoles';
import { ConsoleTile } from './ConsoleTile';
import './ConsoleRow.css';

interface ConsoleRowProps {
  /** Console the room is currently lit by — the focused one. */
  activeId: string;
  onFocusConsole: (platformId: string) => void;
  onOpenConsole: (platformId: string) => void;
}

/** Makers in shelf order, derived from whatever the library actually holds. */
const MAKER_ORDER = ['Nintendo', 'Sega', 'PlayStation', 'Xbox', 'NEC', 'SNK', 'Atari', 'PC'];
const MAKERS: string[] = [
  ...MAKER_ORDER.filter((m) => CONSOLES.some((c) => c.maker === m)),
  ...[...new Set(CONSOLES.map((c) => c.maker))].filter((m) => !MAKER_ORDER.includes(m)),
];

/** Consoles belonging to a maker, largest library first. */
const byMaker = (maker: string): ConsoleEntry[] =>
  CONSOLES.filter((p) => p.maker === maker);

/**
 * Level 1 — the console picker (DESIGN.md §11).
 *
 * One horizontal row that simply extends past the screen edge, exactly like
 * the channel wall: fixed-width tiles that never shrink to fit, a partially
 * visible tile at the edge as the scroll affordance, and edge scrolling via
 * `scroll-padding-inline` + `scrollIntoView` from the tiles themselves.
 *
 * Maker grouping is deliberately quiet — a faint caption and a hairline
 * divider — because the row is a shelf of machines, not a categorised list.
 * Nintendo → Sega → PlayStation → PC, with PC (a Steam library) sitting in
 * the row as just another console.
 */
export function ConsoleRow({ activeId, onFocusConsole, onOpenConsole }: ConsoleRowProps) {
  return (
    <div className="crow">
      <div className="crow-scroller">
        <div className="crow-track">
          {MAKERS.map((maker) => {
            const platforms = byMaker(maker);
            if (platforms.length === 0) return null;
            return (
              <section className="crow-group" key={maker}>
                <h2 className="crow-maker">{maker}</h2>
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
                      // left, not at the start of the shelf.
                      autoFocus={platform.id === activeId}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
