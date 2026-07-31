import { cssVars } from './util';
import './RoomLight.css';

interface RoomLightProps {
  /** Accent of the console under focus (level 1) or open (level 2). */
  accent: string;
}

/**
 * "The room's lighting takes the console's accent" (DESIGN.md §11).
 *
 * Three stacked washes behind both levels, all painted in that accent: a wide
 * pool across the room, a warmer spill low on the left (as if the machine
 * itself were the lamp in the corner), and a thin bloom under the header.
 * They crossfade at different rates, so moving between consoles reads as one
 * light changing hue rather than three lights swapping — the same trick the
 * wall's focus lantern uses (home/FocusGlow.css).
 *
 * Cozy-dusk rules apply: these sit far below the level where they would read
 * as a "glow effect". The room should feel *lit*, not tinted.
 */
export function RoomLight({ accent }: RoomLightProps) {
  return (
    <div
      className="room-light"
      data-collapse="fade"
      aria-hidden="true"
      style={cssVars({ '--accent': accent })}
    >
      <div className="room-light-pool" />
      <div className="room-light-spill" />
      <div className="room-light-brow" />
    </div>
  );
}
