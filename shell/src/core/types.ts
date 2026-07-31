/** Shared domain types. Owned by the integrator — workers import, never edit. */

export type Dir = 'up' | 'down' | 'left' | 'right';

/** Semantic input events. The input layer translates gamepad + keyboard into these. */
export type ConsoleInput =
  | { type: 'nav'; dir: Dir }
  | { type: 'accept' }
  | { type: 'back' }
  | { type: 'home' }
  /** X button / `x` key — summons the Controllers overlay (DESIGN.md §12). */
  | { type: 'menu' }
  /** Y button / `y` key — contextual: cycles library sort (DESIGN.md §11c). */
  | { type: 'sort' };

export interface Channel {
  id: string;
  title: string;
  /**
   * In-shell screen this channel opens instead of launching an external app.
   * Matches HomeView in core/store.ts.
   */
  view?:
    | 'games'
    | 'movies'
    | 'youtube'
    | 'customtv'
    | 'settings'
    | 'weather'
    | 'news'
    | 'situation';
  /** Channel accent color (hex). Drives tile gradient, glow, badges. */
  accent: string;
  /** Placeholder glyph (emoji/char) until real art exists. */
  glyph: string;
  /** Cover art, when the tile stands for something with real artwork (a pin). */
  art?: string | null;
  /** Grid slot, 0-based, row-major in a 4x2 page. */
  slot: number;
  /** Continue tile renders differently when there is nothing to resume. */
  emptyHint?: string;
}

/** `home` = grid visible; `app` = simulated application fullscreen. */
export type ConsoleMode = 'home' | 'app';
