import { cssVars } from './util';
import './FocusGlow.css';

interface FocusGlowProps {
  /** Channel color of the focused tile. */
  accent: string;
  /** Focused tile centre, in px relative to this layer's box. */
  x: number;
  y: number;
  /** False before anything has been focused — the lantern is not lit yet. */
  active: boolean;
}

/**
 * "Carrying a lantern across the grid" (DESIGN.md §1).
 *
 * Two stacked radials in the focused channel's accent, painted *behind* the
 * wall and translated to the focused tile's centre. They use different
 * transition durations so the wide halo trails the tight core — light catching
 * up rather than teleporting (DESIGN.md §6).
 *
 * Translating a pre-sized element beats animating gradient positions: both
 * layers stay on the compositor and never trigger a repaint of the gradient.
 */
export function FocusGlow({ accent, x, y, active }: FocusGlowProps) {
  const style = cssVars({
    '--accent': accent,
    transform: `translate3d(${x}px, ${y}px, 0)`,
  });

  return (
    <div
      className="focus-glow-layer"
      data-collapse="fade"
      data-active={active ? 'true' : 'false'}
      aria-hidden="true"
    >
      <div className="focus-glow focus-glow--halo" style={style} />
      <div className="focus-glow focus-glow--core" style={style} />
    </div>
  );
}
