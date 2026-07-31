/**
 * Idle-cursor mechanism.
 *
 * A living-room console has no visible mouse pointer, but yanking it away the
 * instant it appears makes the shell feel broken when someone *is* using a
 * mouse. So: show the cursor while the mouse moves, hide it again after a few
 * seconds of stillness.
 *
 * The hiding itself is pure CSS (`html.cursor-idle *` in global.css). This
 * module only owns the class toggle, so there is exactly one moving part and
 * no inline <script> anywhere.
 *
 * Usage (App-level, once):
 *
 *   useEffect(() => startCursorIdle(), []);
 */

/** Class applied to <html> while the pointer is considered idle. */
export const CURSOR_IDLE_CLASS = 'cursor-idle';

/** Default stillness before the cursor disappears (ms). */
export const CURSOR_IDLE_DELAY_MS = 3000;

/**
 * Starts watching for pointer activity. Returns a stop function that clears
 * the timer, removes the listeners, and restores the cursor — safe to hand
 * straight back from a React effect.
 *
 * Idempotent-ish: calling it twice just means two watchers racing on the same
 * class, which is harmless, but prefer one call at the App level.
 */
export function startCursorIdle(delayMs: number = CURSOR_IDLE_DELAY_MS): () => void {
  // Guard for non-DOM environments (tests, SSR) so importing this module is
  // always safe.
  if (typeof document === 'undefined') return () => {};

  const root = document.documentElement;
  let timer = 0;
  let idle = false;

  const setIdle = (next: boolean): void => {
    // Track state ourselves: pointermove fires at monitor refresh rate and we
    // do not want to touch classList (and risk a style recalc) 120×/second.
    if (idle === next) return;
    idle = next;
    root.classList.toggle(CURSOR_IDLE_CLASS, next);
  };

  const arm = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => setIdle(true), delayMs);
  };

  const onActivity = (event: Event): void => {
    // Touch and pen input should not summon a mouse cursor — only real mouse
    // movement counts as "someone is using a pointer".
    if (event instanceof PointerEvent && event.pointerType !== 'mouse') return;
    setIdle(false);
    arm();
  };

  const opts: AddEventListenerOptions = { passive: true };
  window.addEventListener('pointermove', onActivity, opts);
  window.addEventListener('pointerdown', onActivity, opts);
  window.addEventListener('wheel', onActivity, opts);

  // Start armed: boot straight into a cursor-free console if nobody touches
  // the mouse after load.
  arm();

  return () => {
    window.clearTimeout(timer);
    window.removeEventListener('pointermove', onActivity);
    window.removeEventListener('pointerdown', onActivity);
    window.removeEventListener('wheel', onActivity);
    setIdle(false);
  };
}
