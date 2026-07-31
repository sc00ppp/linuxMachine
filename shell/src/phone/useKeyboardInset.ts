/**
 * Publishes the software keyboard's height as `--kb-inset` on <html>.
 *
 * Why this exists: iOS Safari does NOT resize the layout viewport when the
 * keyboard opens — it only shrinks `visualViewport` and then scrolls the page
 * under the keyboard. A `position: fixed` GamePad therefore ends up half-buried
 * with no CSS-only way to notice. Measuring the overlap ourselves and padding
 * the pad by it keeps the text field (and the buttons above it) on screen.
 *
 * Android/Chrome usually resizes the layout viewport instead, in which case the
 * measured overlap is ~0 and this is a no-op. Both paths land in the same place.
 */

import { useEffect } from 'react';

export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;

    const apply = (): void => {
      // Distance between the bottom of the layout viewport and the bottom of
      // the visible one = whatever the keyboard (or an accessory bar) covers.
      const overlap = window.innerHeight - (vv.height + vv.offsetTop);
      const inset = Math.max(0, Math.round(overlap));
      root.style.setProperty('--kb-inset', `${inset}px`);
    };

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      root.style.removeProperty('--kb-inset');
    };
  }, []);
}
