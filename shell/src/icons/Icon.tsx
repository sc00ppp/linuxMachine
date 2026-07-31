import type { JSX, ReactNode } from 'react';
import './icons.css';

/**
 * Shared frame for every hand-drawn shell icon.
 *
 * One drawing language across the set (this is what makes ~30 icons read as a
 * family rather than a pile of clip art):
 *
 * - 48×48 viewBox, sized by CSS (`1em` square, like the emoji they replace).
 * - Solid `currentColor` silhouettes with details PUNCHED OUT (fillRule
 *   "evenodd"), so the tile gradient shows through the cutouts the way it
 *   does through an emoji's gaps. Bold shapes survive 10 feet of couch.
 * - Secondary elements sit at ~50% fill-opacity — a consistent "back layer"
 *   tone (the sun behind the weather cloud, a newspaper's second sheet).
 * - When something is stroked (signal arcs, the PlayStation shapes), it is
 *   always 3 units wide with round caps/joins. Never thinner — hairlines
 *   shimmer on a TV.
 */
export interface IconProps {
  className?: string;
}

/** The one stroke recipe used anywhere an icon draws lines. */
export const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 3,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Fill opacity for an icon's secondary, behind-the-subject layer. */
export const BACK = 0.5;

interface IconBaseProps extends IconProps {
  children: ReactNode;
}

export function IconBase({ className, children }: IconBaseProps): JSX.Element {
  return (
    <svg
      className={className ? `ui-icon ${className}` : 'ui-icon'}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      {children}
    </svg>
  );
}
