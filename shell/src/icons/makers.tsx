import type { JSX } from 'react';
import { BACK, IconBase, STROKE, type IconProps } from './Icon';

/**
 * Console-maker icons — the small marks that stand in for a platform in rail
 * headers, box-art placeholders and pinned tiles. Each evokes the maker's
 * hardware without tracing a trademark: Nintendo gets the cross pad, Sega a
 * cartridge, PlayStation its four table-manner shapes, and so on.
 */

/** Nintendo — the cross d-pad, divot and all. */
export function DpadIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path
        fillRule="evenodd"
        d={[
          'M21.5 5.5 h5 a3 3 0 0 1 3 3 v10 h10 a3 3 0 0 1 3 3 v5 a3 3 0 0 1 -3 3 h-10 v10 a3 3 0 0 1 -3 3 h-5 a3 3 0 0 1 -3 -3 v-10 h-10 a3 3 0 0 1 -3 -3 v-5 a3 3 0 0 1 3 -3 h10 v-10 a3 3 0 0 1 3 -3 Z',
          'M21.7 24 a2.3 2.3 0 1 0 4.6 0 a2.3 2.3 0 1 0 -4.6 0 Z',
        ].join(' ')}
      />
    </IconBase>
  );
}

/** Sega — a chunky cartridge: label window, grip lines, edge connector. */
export function CartridgeIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path
        fillRule="evenodd"
        d={[
          'M14 6 h20 a3 3 0 0 1 3 3 v29 H11 V9 a3 3 0 0 1 3 -3 Z',
          'M18 11 h12 a1.5 1.5 0 0 1 1.5 1.5 v10 a1.5 1.5 0 0 1 -1.5 1.5 H18 a1.5 1.5 0 0 1 -1.5 -1.5 v-10 A1.5 1.5 0 0 1 18 11 Z',
          'M17.7 28 h12.6 a1.2 1.2 0 0 1 0 2.4 H17.7 a1.2 1.2 0 0 1 0 -2.4 Z',
          'M17.7 32.5 h12.6 a1.2 1.2 0 0 1 0 2.4 H17.7 a1.2 1.2 0 0 1 0 -2.4 Z',
        ].join(' ')}
      />
      <path d="M17 38 h14 v3 a1.5 1.5 0 0 1 -1.5 1.5 h-11 A1.5 1.5 0 0 1 17 41 Z" opacity={BACK} />
    </IconBase>
  );
}

/** PlayStation — the four face shapes, laid out like the controller. */
export function ShapesIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <g {...STROKE}>
        <path d="M24 4.9 L29.3 14 H18.7 Z" />
        <circle cx="38.2" cy="24" r="5" />
        <path d="M20.2 34.2 l7.6 7.6 M27.8 34.2 l-7.6 7.6" />
        <rect x="5.2" y="19.4" width="9.2" height="9.2" rx="1.4" />
      </g>
    </IconBase>
  );
}

/** Xbox — two crossing rounded bars; unapologetically an X. */
export function CrossIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <rect x="19.4" y="3" width="9.2" height="42" rx="4.6" transform="rotate(45 24 24)" />
      <rect x="19.4" y="3" width="9.2" height="42" rx="4.6" transform="rotate(-45 24 24)" />
    </IconBase>
  );
}

/** Atari — ball-top joystick on a fat base, fire button punched out. */
export function JoystickIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <circle cx="24" cy="10" r="5.6" />
      <rect x="21.3" y="12" width="5.4" height="20" />
      <rect x="18.5" y="26.5" width="11" height="4.5" rx="2.25" />
      <path
        fillRule="evenodd"
        d={[
          'M8.5 30 h31 a3.5 3.5 0 0 1 3.5 3.5 v5 a3.5 3.5 0 0 1 -3.5 3.5 h-31 A3.5 3.5 0 0 1 5 38.5 v-5 A3.5 3.5 0 0 1 8.5 30 Z',
          'M10.8 36 a2.7 2.7 0 1 0 5.4 0 a2.7 2.7 0 1 0 -5.4 0 Z',
        ].join(' ')}
      />
    </IconBase>
  );
}

/** NEC — the HuCard: notched corner, label, contact stripes. */
export function CardIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path
        fillRule="evenodd"
        d={[
          'M16.25 4.5 H28 l6.75 6.75 V40.5 a3 3 0 0 1 -3 3 H16.25 a3 3 0 0 1 -3 -3 V7.5 a3 3 0 0 1 3 -3 Z',
          'M18.5 15 h11 a1.5 1.5 0 0 1 1.5 1.5 v10 a1.5 1.5 0 0 1 -1.5 1.5 h-11 a1.5 1.5 0 0 1 -1.5 -1.5 v-10 a1.5 1.5 0 0 1 1.5 -1.5 Z',
          'M17.4 34.5 h2 v5.5 h-2 Z',
          'M21.6 34.5 h2 v5.5 h-2 Z',
          'M25.8 34.5 h2 v5.5 h-2 Z',
          'M30 34.5 h2 v5.5 h-2 Z',
        ].join(' ')}
      />
    </IconBase>
  );
}

/** SNK — a little arcade cabinet: marquee, screen, buttons, coin slot. */
export function ArcadeIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <rect x="10.5" y="4" width="27" height="7.5" rx="2" />
      <path
        fillRule="evenodd"
        d={[
          'M12.5 13 h23 V40 a3 3 0 0 1 -3 3 h-17 a3 3 0 0 1 -3 -3 Z',
          'M16.5 16.5 h15 a1.5 1.5 0 0 1 1.5 1.5 v8 a1.5 1.5 0 0 1 -1.5 1.5 h-15 A1.5 1.5 0 0 1 15 26 v-8 a1.5 1.5 0 0 1 1.5 -1.5 Z',
          'M17.7 32.5 a1.8 1.8 0 1 0 3.6 0 a1.8 1.8 0 1 0 -3.6 0 Z',
          'M22.7 32.5 a1.8 1.8 0 1 0 3.6 0 a1.8 1.8 0 1 0 -3.6 0 Z',
          'M27.7 32.5 a1.8 1.8 0 1 0 3.6 0 a1.8 1.8 0 1 0 -3.6 0 Z',
          'M22.9 37 h2.2 a1 1 0 0 1 1 1 v2.4 a1 1 0 0 1 -1 1 h-2.2 a1 1 0 0 1 -1 -1 V38 a1 1 0 0 1 1 -1 Z',
        ].join(' ')}
      />
    </IconBase>
  );
}

/** PC — monitor with a prompt on screen, keyboard slab below. */
export function MonitorIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path
        fillRule="evenodd"
        d={[
          'M10.5 6.5 h27 a3 3 0 0 1 3 3 v17 a3 3 0 0 1 -3 3 h-27 a3 3 0 0 1 -3 -3 v-17 a3 3 0 0 1 3 -3 Z',
          'M13 10.5 h22 a1.5 1.5 0 0 1 1.5 1.5 v12 a1.5 1.5 0 0 1 -1.5 1.5 H13 a1.5 1.5 0 0 1 -1.5 -1.5 V12 a1.5 1.5 0 0 1 1.5 -1.5 Z',
        ].join(' ')}
      />
      {/* Blinking-cursor prompt inside the punched screen. */}
      <path {...STROKE} d="M15.5 14.5 l4.5 3.5 -4.5 3.5" />
      <rect x="23" y="20.2" width="6" height="2.6" rx="1.3" />
      <rect x="21" y="29.5" width="6" height="4" />
      <rect x="15.5" y="33.5" width="17" height="3.2" rx="1.6" />
      <rect x="9" y="39" width="30" height="4.6" rx="2.3" opacity={BACK} />
    </IconBase>
  );
}

/** Fairchild — the Videocart, drawn as its cassette-like shell. */
export function VideocartIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path
        fillRule="evenodd"
        d={[
          'M9 12.5 h30 a3 3 0 0 1 3 3 v17.5 a3 3 0 0 1 -3 3 H9 a3 3 0 0 1 -3 -3 V15.5 a3 3 0 0 1 3 -3 Z',
          'M12.2 24.2 a4.6 4.6 0 1 0 9.2 0 a4.6 4.6 0 1 0 -9.2 0 Z',
          'M26.6 24.2 a4.6 4.6 0 1 0 9.2 0 a4.6 4.6 0 1 0 -9.2 0 Z',
          'M14 15.5 h20 a1.3 1.3 0 0 1 0 2.6 H14 a1.3 1.3 0 0 1 0 -2.6 Z',
        ].join(' ')}
      />
      <circle cx="16.8" cy="24.2" r="1.7" />
      <circle cx="31.2" cy="24.2" r="1.7" />
    </IconBase>
  );
}

/** Coleco — a five-pip die. Games night incarnate. */
export function DieIcon({ className }: IconProps): JSX.Element {
  return (
    <IconBase className={className}>
      <path
        fillRule="evenodd"
        d={[
          'M15.5 8 h17 A7.5 7.5 0 0 1 40 15.5 v17 A7.5 7.5 0 0 1 32.5 40 h-17 A7.5 7.5 0 0 1 8 32.5 v-17 A7.5 7.5 0 0 1 15.5 8 Z',
          'M13.3 16 a2.7 2.7 0 1 0 5.4 0 a2.7 2.7 0 1 0 -5.4 0 Z',
          'M29.3 16 a2.7 2.7 0 1 0 5.4 0 a2.7 2.7 0 1 0 -5.4 0 Z',
          'M21.3 24 a2.7 2.7 0 1 0 5.4 0 a2.7 2.7 0 1 0 -5.4 0 Z',
          'M13.3 32 a2.7 2.7 0 1 0 5.4 0 a2.7 2.7 0 1 0 -5.4 0 Z',
          'M29.3 32 a2.7 2.7 0 1 0 5.4 0 a2.7 2.7 0 1 0 -5.4 0 Z',
        ].join(' ')}
      />
    </IconBase>
  );
}
