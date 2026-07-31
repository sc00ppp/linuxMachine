import type { JSX } from 'react';
import { BACK, IconBase, STROKE, type IconProps } from './Icon';

/**
 * Small utility icons: detail-page actions, shelf quick chips, settings
 * tiles, player transport marks. Same family rules as the channel set.
 */

export function PlayIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path d="M16 11 v26 a3 3 0 0 0 4.6 2.5 L41 26.5 a3 3 0 0 0 0 -5 L20.6 8.5 A3 3 0 0 0 16 11 Z" />
    </IconBase>
  );
}

export function PauseIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <rect x="12.5" y="9" width="8.5" height="30" rx="3.8" />
      <rect x="27" y="9" width="8.5" height="30" rx="3.8" />
    </IconBase>
  );
}

export function StopIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <rect x="10.5" y="10.5" width="27" height="27" rx="5.5" />
    </IconBase>
  );
}

const STAR_PATH =
  'M24 5.2 l5.5 12 13.2 1.5 -9.8 9 2.7 13 L24 34.2 12.4 40.7 l2.7 -13 -9.8 -9 13.2 -1.5 Z';

/** Favorite. `filled` is the toggled-on state; outline otherwise. */
export function StarIcon({ className, filled = true }: IconProps & { filled?: boolean }): JSX.Element {
  return (
    <IconBase className={className}>
      {filled ? <path d={STAR_PATH} /> : <path {...STROKE} d={STAR_PATH} />}
    </IconBase>
  );
}

const PIN_PATH = [
  'M18 4.5 h12 a2.5 2.5 0 0 1 2.5 2.5 v0.6 A2.5 2.5 0 0 1 30 10.1 h-0.9 l1.1 7.4 h5.3',
  'a2.6 2.6 0 0 1 2.6 2.6 v0.6 a2.6 2.6 0 0 1 -2.6 2.6 h-9.7 l-0.5 16.6 c-0.05 1.7 -2.55 1.7 -2.6 0',
  'l-0.5 -16.6 H12.5 a2.6 2.6 0 0 1 -2.6 -2.6 v-0.6 a2.6 2.6 0 0 1 2.6 -2.6 h5.3 l1.1 -7.4 H18',
  'a2.5 2.5 0 0 1 -2.5 -2.5 v-0.6 A2.5 2.5 0 0 1 18 4.5 Z',
].join(' ');

/** Pin to Home — a thumbtack. `filled` is the pinned state. */
export function PinIcon({ className, filled = true }: IconProps & { filled?: boolean }): JSX.Element {
  return (
    <IconBase className={className}>
      {filled ? <path d={PIN_PATH} /> : <path {...STROKE} strokeWidth={2.6} d={PIN_PATH} />}
    </IconBase>
  );
}

/** Controls / remap — two sliders with donut knobs. */
export function SlidersIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path {...STROKE} d="M7 16.5 H41 M7 31.5 H41" />
      <path
        fillRule="evenodd"
        d={[
          'M13.3 16.5 a5.2 5.2 0 1 0 10.4 0 a5.2 5.2 0 1 0 -10.4 0 Z',
          'M16.5 16.5 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 Z',
          'M24.3 31.5 a5.2 5.2 0 1 0 10.4 0 a5.2 5.2 0 1 0 -10.4 0 Z',
          'M27.5 31.5 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 Z',
        ].join(' ')}
      />
    </IconBase>
  );
}

export function VolumeIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path d="M8.2 18.6 h5.9 l8.3 -6.9 c1.9 -1.6 4.4 -0.5 4.4 1.9 v20.8 c0 2.4 -2.5 3.5 -4.4 1.9 l-8.3 -6.9 H8.2 A2.7 2.7 0 0 1 5.5 26.7 v-5.4 a2.7 2.7 0 0 1 2.7 -2.7 Z" />
      <path {...STROKE} d="M31.5 17.5 a8.6 8.6 0 0 1 0 13 M36.5 13 a15.2 15.2 0 0 1 0 22" />
    </IconBase>
  );
}

/** Sleep — crescent moon with a companion spark. */
export function MoonIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path d="M31 7.8 A19 19 0 1 0 40.9 31.5 A14.6 14.6 0 0 1 31 7.8 Z" />
      <path
        d="M39 5.5 c0.6 3 2.2 4.6 5.2 5.2 c-3 0.6 -4.6 2.2 -5.2 5.2 c-0.6 -3 -2.2 -4.6 -5.2 -5.2 c3 -0.6 4.6 -2.2 5.2 -5.2 Z"
        opacity={BACK}
      />
    </IconBase>
  );
}

export function PhoneIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path
        fillRule="evenodd"
        d={[
          'M19 4 h10 a4.5 4.5 0 0 1 4.5 4.5 v31 A4.5 4.5 0 0 1 29 44 H19 a4.5 4.5 0 0 1 -4.5 -4.5 v-31 A4.5 4.5 0 0 1 19 4 Z',
          'M19.5 9.5 h9 a1.5 1.5 0 0 1 1.5 1.5 v22.5 a1.5 1.5 0 0 1 -1.5 1.5 h-9 A1.5 1.5 0 0 1 18 33.5 V11 a1.5 1.5 0 0 1 1.5 -1.5 Z',
          'M22.1 39.4 a1.9 1.9 0 1 0 3.8 0 a1.9 1.9 0 1 0 -3.8 0 Z',
          'M21.8 6 h4.4 a0.85 0.85 0 0 1 0 1.7 h-4.4 a0.85 0.85 0 0 1 0 -1.7 Z',
        ].join(' ')}
      />
    </IconBase>
  );
}

/** Storage — two stacked drive sleds, LED and vent slit punched out. */
export function DrivesIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path
        fillRule="evenodd"
        d={[
          'M10 9.5 h28 a3 3 0 0 1 3 3 v7 a3 3 0 0 1 -3 3 H10 a3 3 0 0 1 -3 -3 v-7 a3 3 0 0 1 3 -3 Z',
          'M11.4 16 a1.8 1.8 0 1 0 3.6 0 a1.8 1.8 0 1 0 -3.6 0 Z',
          'M25.5 14.7 h8.2 a1.3 1.3 0 0 1 0 2.6 h-8.2 a1.3 1.3 0 0 1 0 -2.6 Z',
          'M10 25.5 h28 a3 3 0 0 1 3 3 v7 a3 3 0 0 1 -3 3 H10 a3 3 0 0 1 -3 -3 v-7 a3 3 0 0 1 3 -3 Z',
          'M11.4 32 a1.8 1.8 0 1 0 3.6 0 a1.8 1.8 0 1 0 -3.6 0 Z',
          'M25.5 30.7 h8.2 a1.3 1.3 0 0 1 0 2.6 h-8.2 a1.3 1.3 0 0 1 0 -2.6 Z',
        ].join(' ')}
      />
    </IconBase>
  );
}

export function WifiIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <circle cx="24" cy="38.5" r="3.6" />
      <path
        {...STROKE}
        strokeWidth={3.2}
        d="M17.2 31.4 a9.6 9.6 0 0 1 13.6 0 M11.8 25.4 a17.3 17.3 0 0 1 24.4 0 M6.4 19.4 a25 25 0 0 1 35.2 0"
      />
    </IconBase>
  );
}

/** SSD / quick things — a lightning bolt. */
export function BoltIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path
        strokeLinejoin="round"
        stroke="currentColor"
        strokeWidth="2.5"
        d="M27.5 5 L11 27.5 h9.5 L18.5 43 37 20.5 h-10 Z"
      />
    </IconBase>
  );
}

/** System — a wrench, jaw to the top-right. */
export function WrenchIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path d="M41.9 12.6 c1.9 5.1 0.8 11 -3.4 15.2 c-3.6 3.6 -8.5 4.9 -13 3.9 L15 42.2 a5.3 5.3 0 0 1 -7.5 -7.5 L18 24.2 c-1 -4.5 0.3 -9.4 3.9 -13 c4.2 -4.2 10.1 -5.3 15.2 -3.4 l-8 8 l1.2 5.6 l5.6 1.2 Z" />
    </IconBase>
  );
}
