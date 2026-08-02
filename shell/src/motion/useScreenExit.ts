import { useEffect, useRef, type RefObject } from 'react';
import { useConsoleStore } from '../core/store';
import { playScreenExit } from './transitions';
import { tuning } from './tuning';

/**
 * Animate a room's inner screen on its way OUT.
 *
 * Every room animates the screen that arrives and none of them animated the
 * one that left, so a step deeper read as a hard cut followed by a slide.
 * Supplying the other half needs the outgoing DOM, and React offers no hook
 * that fires while a subtree it is about to replace is still on screen.
 *
 * Zustand does. `subscribe` runs synchronously inside `set()`, before React
 * has been told anything — so at that instant `hostRef` still points at the
 * screen the user is looking at, scrolled where they left it. That is the
 * moment to photograph it (`playScreenExit`), and the copy then drifts off
 * while React mounts the replacement underneath.
 *
 * @param hostRef  The element wrapping the room's swappable screens. It must
 *                 be the stable wrapper, not the keyed child — the wrapper
 *                 has to outlive the swap.
 * @param depthOf  Ranks the current screen. Increasing = going deeper, so
 *                 the outgoing screen drifts left; decreasing = backing out,
 *                 so it drifts right. Equal ranks mean no move worth showing.
 */
export function useScreenExit(
  hostRef: RefObject<HTMLElement | null>,
  depthOf: (state: ReturnType<typeof useConsoleStore.getState>) => number,
): void {
  // The subscription is established once; re-subscribing on every render
  // would leave a gap in which a store update goes unheard. So the ranking
  // function is read through a ref rather than captured in the closure.
  const latestDepthOf = useRef(depthOf);
  useEffect(() => {
    latestDepthOf.current = depthOf;
  });

  useEffect(
    () =>
      useConsoleStore.subscribe((state, previous) => {
        const rank = latestDepthOf.current;
        const next = rank(state);
        const before = rank(previous);
        // NaN means "not this room's business" — leaving the room entirely is
        // the tile-shrink homecoming's job, and it covers the whole screen
        // from the first frame, so an exit underneath it is invisible work.
        if (Number.isNaN(next) || Number.isNaN(before) || next === before) return;

        const host = hostRef.current;
        if (!host) return;

        // Deeper: what you are leaving gets pushed aside to the left.
        // Back: it retreats the way you came.
        const drift = next > before ? -tuning.drillSlidePx : tuning.drillSlidePx;
        playScreenExit(host, drift);
      }),
    [hostRef],
  );
}
