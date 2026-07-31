/**
 * Touch press mechanics — the thing that decides whether this feels like a
 * GamePad or like a web page.
 *
 * Three rules, all lifted from how the physical pad behaves (see the
 * `src/input` contract):
 *   1. Fire on pointer-DOWN, never on click. Latency is feel.
 *   2. Held direction buttons repeat: 350 ms, then every 120 ms.
 *   3. Every press answers back — haptic tap + a visual squash (see PadButton).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** Matches the keyboard/gamepad repeat cadence in `src/input`. */
const REPEAT_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 120;

/**
 * A short tick in the hand. iOS Safari has no Vibration API at all and some
 * browsers throw when vibrating outside a user gesture, hence the guards.
 */
export function haptic(ms = 8): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(ms);
  } catch {
    /* vibration blocked — purely decorative, never worth an exception */
  }
}

export interface PressHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (event: { preventDefault: () => void }) => void;
}

export interface PressOptions {
  /** Hold-to-repeat, for D-pad directions. */
  repeat?: boolean;
  hapticMs?: number;
  disabled?: boolean;
}

/**
 * Wires one touch target. Returns the pressed flag (for the squash animation)
 * plus the handler bundle to spread onto the element.
 */
export function usePressRepeat(
  fire: () => void,
  options: PressOptions = {},
): { pressed: boolean; handlers: PressHandlers } {
  const { repeat = false, hapticMs = 8, disabled = false } = options;
  const [pressed, setPressed] = useState(false);

  // Keep the latest callback without re-creating handlers (and thus without
  // interrupting an in-flight hold) on every render.
  const fireRef = useRef(fire);
  useEffect(() => {
    fireRef.current = fire;
  }, [fire]);

  const delayTimer = useRef<number | null>(null);
  const intervalTimer = useRef<number | null>(null);

  const stopRepeat = useCallback(() => {
    if (delayTimer.current !== null) {
      window.clearTimeout(delayTimer.current);
      delayTimer.current = null;
    }
    if (intervalTimer.current !== null) {
      window.clearInterval(intervalTimer.current);
      intervalTimer.current = null;
    }
  }, []);

  useEffect(() => stopRepeat, [stopRepeat]);

  const release = useCallback(() => {
    stopRepeat();
    setPressed(false);
  }, [stopRepeat]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (disabled) return;
      // Mouse right/middle buttons are not presses; touch reports button 0.
      if (event.button > 0) return;
      // Stops the browser from turning the gesture into a scroll, a text
      // selection, or (on iOS) a delayed synthetic click.
      event.preventDefault();

      // Capture so a finger that slides off the button still ends its press
      // here instead of leaving the button stuck lit.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* capture unsupported — onPointerUp still lands */
      }

      setPressed(true);
      haptic(hapticMs);
      fireRef.current();

      if (!repeat) return;
      stopRepeat();
      delayTimer.current = window.setTimeout(() => {
        intervalTimer.current = window.setInterval(() => {
          haptic(Math.max(4, Math.round(hapticMs / 2)));
          fireRef.current();
        }, REPEAT_INTERVAL_MS);
      }, REPEAT_DELAY_MS);
    },
    [disabled, hapticMs, repeat, stopRepeat],
  );

  return {
    pressed,
    handlers: {
      onPointerDown,
      onPointerUp: release,
      onPointerCancel: release,
      onLostPointerCapture: release,
      onContextMenu: (event) => event.preventDefault(),
    },
  };
}
