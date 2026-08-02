/**
 * Motion timing/easing constants, in one place. Base numbers are lifted from
 * vAMP's hand-tuned fullscreen choreography ("FLOATY enter + WII U exit":
 * enter drifts in — long soft retract, dreamy bloom; exit is the cushioned
 * suck-back — accelerates away instantly, lands on a pillow).
 *
 * Console mapping: "enter" ≙ launching an app from its tile,
 * "exit" ≙ returning Home into the same tile.
 */
export const tuning = {
  /** Focus hop between tiles. React on button-down; motion stays short. */
  focusMoveMs: 240,
  /**
   * Focused-tile scale/glow ease.
   *
   * This is the iOS system curve. Its distinguishing feature is that it
   * leaves the start almost linearly and then decays over a long tail —
   * where an ease-out-expo (the old curve) snaps off the line and coasts.
   * Against a d-pad, the snap is what made every hop feel like a twitch.
   */
  focusEase: 'cubic-bezier(0.32, 0.72, 0, 1)',

  /**
   * Focus arrival (see motion/focusArrival.ts). The swing is longer than the
   * focus hop itself on purpose: the highlight should land immediately and
   * the object should still be settling, which is what makes it read as
   * weight rather than as a second animation.
   */
  focusSwingMs: 420,
  focusSwingEase: 'cubic-bezier(0.18, 0.9, 0.28, 1)',
  focusSweepMs: 620,

  /**
   * Spring scrolling (see motion/glide.ts). `navGlideMs` is the response
   * time — roughly how long an uninterrupted hop takes to arrive — and the
   * damping ratio sits just under 1 so it settles firmly without ever
   * overshooting a shelf edge (overshoot on a TV reads as a bug, not bounce).
   */
  navGlideMs: 420,
  navGlideDamping: 0.92,

  /** Grid page glide (L/R paging). */
  pageGlideMs: 350,

  /** Tile → fullscreen zoom (launch). */
  launchZoomMs: 640,
  launchZoomEase: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** Home chrome retract during launch — soft drift. */
  chromeAwayMs: 460,
  chromeAwayEase: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** Delay before the tile bloom starts, after chrome retract begins. */
  bloomDelayMs: 120,

  /** Fullscreen → tile shrink (return home) — accelerate, then pillow. */
  returnShrinkMs: 300,
  returnShrinkEase: 'cubic-bezier(0.5, 0, 0.15, 1)',
  /** Chrome return duration/delay on the way home. */
  chromeBackMs: 260,
  chromeBackEase: 'cubic-bezier(0.22, 1, 0.36, 1)',
  chromeBackDelayMs: 90,

  /** Drill transition (grid → channel screen), per vAMP drillOut. */
  drillMs: 240,
  /**
   * The outgoing screen's curve. Faster off the mark than the incoming one:
   * what you are leaving should clear the way, not compete for attention
   * with what you are arriving at.
   */
  drillOutEase: 'cubic-bezier(0.4, 0, 0.9, 0.6)',
  drillSlidePx: 32,
  drillInMs: 260,
  drillInEase: 'cubic-bezier(0.22, 0.9, 0.32, 1)',

  /** Shelf overlay (Home button over an app). */
  shelfOpenMs: 320,
  shelfCloseMs: 220,
  shelfEase: 'cubic-bezier(0.22, 1, 0.36, 1)',

  /** Playful overshoot for pops (toggles, chips). */
  popEase: 'cubic-bezier(0.34, 1.56, 0.64, 1)',

  /** Text/label settles after motion lands. */
  settleFadeMs: 900,
  settleFadeDelayMs: 150,
} as const;
