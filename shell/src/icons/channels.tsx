import type { JSX } from 'react';
import { BACK, IconBase, STROKE, type IconProps } from './Icon';

/**
 * Channel-wall icons (DESIGN.md §3: "a large channel glyph that owns the
 * face"). Each one is a single bold silhouette a sofa can read; see Icon.tsx
 * for the family rules.
 */

/** Continue — the four-point spark the wall has always used, plus a pup. */
export function SparkIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path d="M24 4.5 C25.9 15.6 32.4 22.1 43.5 24 C32.4 25.9 25.9 32.4 24 43.5 C22.1 32.4 15.6 25.9 4.5 24 C15.6 22.1 22.1 15.6 24 4.5 Z" />
      <path
        d="M38.5 6.5 C39.2 10 41 11.8 44.5 12.5 C41 13.2 39.2 15 38.5 18.5 C37.8 15 36 13.2 32.5 12.5 C36 11.8 37.8 10 38.5 6.5 Z"
        opacity={BACK}
      />
    </IconBase>
  );
}

/** Games — a plump two-grip pad; d-pad and diamond punched out of the body. */
export function GamepadIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path
        fillRule="evenodd"
        d={[
          // Body: bridge with two drooping grips.
          'M16 12 H32 C39.8 12 44.6 17.4 45.6 25.6 C46.3 31.2 45.7 35.4 42.6 37.2',
          'C39.8 38.9 36.8 37.7 34.5 34.7 L31 30.2 H17 L13.5 34.7',
          'C11.2 37.7 8.2 38.9 5.4 37.2 C2.3 35.4 1.7 31.2 2.4 25.6 C3.4 17.4 8.2 12 16 12 Z',
          // D-pad cross cutout.
          'M13.8 15.8 h3.4 v4 h4 v3.4 h-4 v4 h-3.4 v-4 h-4 v-3.4 h4 Z',
          // Face-button diamond cutouts.
          'M30.2 16.9 a2.3 2.3 0 1 0 4.6 0 a2.3 2.3 0 1 0 -4.6 0 Z',
          'M34.8 21.5 a2.3 2.3 0 1 0 4.6 0 a2.3 2.3 0 1 0 -4.6 0 Z',
          'M30.2 26.1 a2.3 2.3 0 1 0 4.6 0 a2.3 2.3 0 1 0 -4.6 0 Z',
          'M25.6 21.5 a2.3 2.3 0 1 0 4.6 0 a2.3 2.3 0 1 0 -4.6 0 Z',
        ].join(' ')}
      />
    </IconBase>
  );
}

/** Movies & TV — clapperboard, top slat swung open on its hinge. */
export function ClapperIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      {/* The swung slat: drawn flat, rotated about the hinge corner. */}
      <g transform="rotate(-14 7 22)">
        <path
          fillRule="evenodd"
          d={[
            'M8.5 13 H41 a2.5 2.5 0 0 1 2.5 2.5 v3.5 a2.5 2.5 0 0 1 -2.5 2.5 H8.5 A2.5 2.5 0 0 1 6 19 v-3.5 A2.5 2.5 0 0 1 8.5 13 Z',
            'M15 21.5 l3.2 -8.5 h4.2 l-3.2 8.5 Z',
            'M25 21.5 l3.2 -8.5 h4.2 l-3.2 8.5 Z',
            'M35 21.5 l3.2 -8.5 h4.2 l-3.2 8.5 Z',
          ].join(' ')}
        />
      </g>
      {/* Fixed jaw + board, stripe row punched from the jaw. */}
      <path
        fillRule="evenodd"
        d={[
          'M6 21.5 H42 a2.5 2.5 0 0 1 2.5 2.5 V38.5 A3.5 3.5 0 0 1 41 42 H9.5 A3.5 3.5 0 0 1 6 38.5 Z',
          'M13 29.5 l3.2 -8 h4.2 l-3.2 8 Z',
          'M23 29.5 l3.2 -8 h4.2 l-3.2 8 Z',
          'M33 29.5 l3.2 -8 h4.2 l-3.2 8 Z',
        ].join(' ')}
      />
    </IconBase>
  );
}

/** YouTube — rounded screen, play wedge punched out. */
export function PlayScreenIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path
        fillRule="evenodd"
        d={[
          'M10.5 10 h27 A5.5 5.5 0 0 1 43 15.5 v17 A5.5 5.5 0 0 1 37.5 38 h-27 A5.5 5.5 0 0 1 5 32.5 v-17 A5.5 5.5 0 0 1 10.5 10 Z',
          'M20.2 17.4 a1.5 1.5 0 0 1 2.3 -1.3 l10.9 6.6 a1.55 1.55 0 0 1 0 2.6 l-10.9 6.6 a1.5 1.5 0 0 1 -2.3 -1.3 Z',
        ].join(' ')}
      />
    </IconBase>
  );
}

/** Custom TV — a proper CRT: rabbit ears, dial panel, little feet. */
export function TvIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path {...STROKE} d="M21.5 12.5 L15 4 M25.5 12.5 L32.5 4.5" />
      <path
        fillRule="evenodd"
        d={[
          'M9.5 13.5 h29 a4 4 0 0 1 4 4 v18 a4 4 0 0 1 -4 4 h-29 a4 4 0 0 1 -4 -4 v-18 a4 4 0 0 1 4 -4 Z',
          // Screen.
          'M13.5 17.5 h16 a2 2 0 0 1 2 2 v9.5 a2 2 0 0 1 -2 2 h-16 a2 2 0 0 1 -2 -2 v-9.5 a2 2 0 0 1 2 -2 Z',
          // Dials.
          'M35.3 20.8 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 Z',
          'M35.3 27.2 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 Z',
        ].join(' ')}
      />
      <rect x="12.5" y="39.5" width="6" height="3.5" rx="1.5" />
      <rect x="29.5" y="39.5" width="6" height="3.5" rx="1.5" />
    </IconBase>
  );
}

/** Weather — flat-bottomed cloud in front, sun and rays behind. */
export function WeatherIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <g opacity={BACK}>
        <circle cx="33" cy="14.5" r="6.6" />
        <path
          {...STROKE}
          d="M33 5.7 V2.6 M39.2 8.3 L41.4 6.1 M41.8 14.5 h3.1 M39.2 20.7 l2.2 2.2 M26.8 8.3 L24.6 6.1"
        />
      </g>
      {/* Cloud: circle lobes over a flat-bottomed slab; same fill merges. */}
      <rect x="10.5" y="31.5" width="27" height="8.5" rx="4.25" />
      <circle cx="17.5" cy="27" r="7" />
      <circle cx="28" cy="24.5" r="8.5" />
    </IconBase>
  );
}

/** News — front page with headline block, second sheet tucked behind. */
export function NewsIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path
        d="M33 12 h4.5 a4.5 4.5 0 0 1 4.5 4.5 V35 a5 5 0 0 1 -5 5 H30 Z"
        opacity={BACK}
      />
      <path
        fillRule="evenodd"
        d={[
          'M9.5 8 H32 a3 3 0 0 1 3 3 v26 a3 3 0 0 1 -3 3 H9.5 a3 3 0 0 1 -3 -3 V11 a3 3 0 0 1 3 -3 Z',
          // Headline block + column lines.
          'M11 13.5 h19.5 a1.2 1.2 0 0 1 1.2 1.2 v3.6 a1.2 1.2 0 0 1 -1.2 1.2 H11 a1.2 1.2 0 0 1 -1.2 -1.2 v-3.6 a1.2 1.2 0 0 1 1.2 -1.2 Z',
          'M11 23 h19.5 a1.3 1.3 0 0 1 0 2.6 H11 a1.3 1.3 0 0 1 0 -2.6 Z',
          'M11 28.2 h19.5 a1.3 1.3 0 0 1 0 2.6 H11 a1.3 1.3 0 0 1 0 -2.6 Z',
          'M11 33.4 h11.5 a1.3 1.3 0 0 1 0 2.6 H11 a1.3 1.3 0 0 1 0 -2.6 Z',
        ].join(' ')}
      />
    </IconBase>
  );
}

/** Situation — a watched world: planet, orbit ring, moonlet, far stars. */
export function OrbitIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <circle cx="24" cy="24" r="10" />
      <g transform="rotate(-20 24 24)">
        <ellipse cx="24" cy="24" rx="19" ry="6.6" {...STROKE} />
        <circle cx="43" cy="24" r="2.8" />
      </g>
      <circle cx="9" cy="7.5" r="1.7" opacity={BACK} />
      <circle cx="41" cy="41" r="1.4" opacity={BACK} />
    </IconBase>
  );
}

/** Settings — eight-tooth gear, hub punched out. */
export function GearIcon({ className }: IconProps): JSX.Element {
  const teeth = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <IconBase className={className}>
      {teeth.map((deg) => (
        <rect
          key={deg}
          x="21.4"
          y="1.8"
          width="5.2"
          height="9"
          rx="2.5"
          transform={`rotate(${deg} 24 24)`}
        />
      ))}
      <path
        fillRule="evenodd"
        d={[
          'M8.5 24 a15.5 15.5 0 1 0 31 0 a15.5 15.5 0 1 0 -31 0 Z',
          'M17.2 24 a6.8 6.8 0 1 0 13.6 0 a6.8 6.8 0 1 0 -13.6 0 Z',
        ].join(' ')}
      />
    </IconBase>
  );
}
