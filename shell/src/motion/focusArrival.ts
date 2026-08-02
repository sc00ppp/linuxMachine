/**
 * What a tile does when the cursor lands on it.
 *
 * The Apple TV home screen's signature is that its icons feel like physical
 * objects under your thumb: they lean, and a highlight slides across the
 * gloss as they move. That is doing two jobs at once — it says "this one is
 * selected", and it says "you moved". A highlight that merely appears says
 * only the first, which is why a d-pad wall can feel like a slideshow no
 * matter how good the ring looks.
 *
 * We cannot copy it literally. Apple's version tracks a trackpad continuously;
 * a d-pad gives discrete presses and nothing in between. So the lean is
 * derived from the direction the cursor was travelling (focus/index.tsx
 * records it) and played as a single settle: the tile starts leaning away
 * from where focus came from, as though it had just been pushed, and rights
 * itself. Same information, and it survives the input device we actually have.
 *
 * Everything here is one-shot WAAPI on the tile that just gained focus, on
 * `rotate` and `translate` — properties that are independent of `transform`,
 * which the focus scale and the launch zoom already own. Nothing to
 * coordinate, nothing to reset.
 */
import type { Dir } from '../core/types';
import { tuning } from './tuning';

/** How far the tile leans, in degrees. Past ~8 it reads as a wobble. */
const SWING_DEGREES = 5.5;
/** How far it is carried along the direction of travel, in px. */
const SWING_SHIFT = 5;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/** The lean a tile starts at, given the direction the cursor arrived from. */
function swingFor(dir: Dir): { rotate: string; translate: string } {
  switch (dir) {
    // Travelling right: the tile is caught from its left edge, so its left
    // side lifts toward the viewer and it is dragged a little to the right.
    case 'right':
      return { rotate: `0 1 0 ${SWING_DEGREES}deg`, translate: `${SWING_SHIFT}px 0` };
    case 'left':
      return { rotate: `0 1 0 ${-SWING_DEGREES}deg`, translate: `${-SWING_SHIFT}px 0` };
    case 'down':
      return { rotate: `1 0 0 ${-SWING_DEGREES}deg`, translate: `0 ${SWING_SHIFT}px` };
    case 'up':
    default:
      return { rotate: `1 0 0 ${SWING_DEGREES}deg`, translate: `0 ${-SWING_SHIFT}px` };
  }
}

/**
 * Play the arrival on a tile that has just taken focus.
 *
 * @param el     The tile face. Needs a perspective on an ancestor for the
 *               lean to read as depth rather than as a squash.
 * @param dir    Direction the cursor was travelling, or null when focus
 *               arrived without one (a restore) — in which case only the
 *               highlight plays, since there is no movement to express.
 * @param sheen  The specular layer, if the tile has one.
 */
export function playFocusArrival(
  el: HTMLElement | null,
  dir: Dir | null,
  sheen?: HTMLElement | null,
): void {
  if (!el || prefersReducedMotion()) return;

  try {
    if (dir) {
      const from = swingFor(dir);
      el.animate(
        [
          { rotate: from.rotate, translate: from.translate },
          { rotate: '0 0 1 0deg', translate: '0 0' },
        ],
        {
          duration: tuning.focusSwingMs,
          easing: tuning.focusSwingEase,
          // Not `forwards`: the resting state is the element's own, and
          // holding the last frame would fight the next arrival.
          fill: 'none',
        },
      );
    }

    // The highlight slides across the face in the direction of travel and
    // settles into the idle drift the tile already runs.
    if (sheen) {
      const across = dir === 'left' ? 1 : -1;
      sheen.animate(
        [
          { transform: `translate3d(${across * 22}%, 0, 0)`, opacity: 0.15 },
          { transform: 'translate3d(0, 0, 0)', opacity: 0.85, offset: 0.55 },
          { transform: `translate3d(${across * -6}%, 0, 0)`, opacity: 0.8 },
        ],
        {
          duration: tuning.focusSweepMs,
          easing: tuning.focusEase,
          fill: 'none',
        },
      );
    }
  } catch {
    // Arrival motion is decorative; focus itself has already moved.
  }
}
