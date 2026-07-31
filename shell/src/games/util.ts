import type { CSSProperties } from 'react';

/**
 * React's `CSSProperties` has no index signature, so custom properties
 * (`--accent`, `--cover-angle`, …) don't type-check in an inline `style`
 * object. This is the sanctioned escape hatch — kept in one place per module
 * so the cast never spreads through the components.
 */
export const cssVars = (vars: Record<string, string | number>): CSSProperties =>
  vars as unknown as CSSProperties;

/**
 * Read the accessibility preference at call time rather than caching it:
 * users flip this in OS settings while the app is running, and a TV shell is
 * long-lived.
 */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
