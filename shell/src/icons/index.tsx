import type { ComponentType, JSX } from 'react';
import type { IconProps } from './Icon';
import {
  ClapperIcon,
  GamepadIcon,
  GearIcon,
  NewsIcon,
  OrbitIcon,
  PlayScreenIcon,
  SparkIcon,
  TvIcon,
  WeatherIcon,
} from './channels';
import {
  ArcadeIcon,
  CardIcon,
  CartridgeIcon,
  CrossIcon,
  DieIcon,
  DpadIcon,
  JoystickIcon,
  MonitorIcon,
  ShapesIcon,
  VideocartIcon,
} from './makers';
import {
  DrivesIcon,
  MoonIcon,
  PhoneIcon,
  SlidersIcon,
  VolumeIcon,
  WifiIcon,
  WrenchIcon,
} from './ui';

export * from './channels';
export * from './makers';
export * from './ui';
export type { IconProps } from './Icon';

type IconComponent = ComponentType<IconProps>;

/**
 * Every platform id the library can produce, folded to the maker whose mark
 * it wears. Mirrors consoles.ts's grouping without importing it (icons stay
 * dependency-free so any surface can use them).
 */
const MAKER_ICONS: Readonly<Record<string, IconComponent>> = {
  nintendo: DpadIcon,
  sega: CartridgeIcon,
  playstation: ShapesIcon,
  xbox: CrossIcon,
  atari: JoystickIcon,
  nec: CardIcon,
  snk: ArcadeIcon,
  pc: MonitorIcon,
  fairchild: VideocartIcon,
  coleco: DieIcon,
};

const PLATFORM_MAKER: Readonly<Record<string, string>> = {
  nes: 'nintendo', snes: 'nintendo', n64: 'nintendo', n64dd: 'nintendo',
  gamecube: 'nintendo', wii: 'nintendo', wiiu: 'nintendo', switch: 'nintendo',
  gb: 'nintendo', gbc: 'nintendo', gba: 'nintendo', nds: 'nintendo',
  '3ds': 'nintendo', virtualboy: 'nintendo', pokemini: 'nintendo',
  triforce: 'nintendo',
  genesis: 'sega', megadrive: 'sega', saturn: 'sega', dreamcast: 'sega',
  gamegear: 'sega', mastersystem: 'sega', sega32x: 'sega', segacd: 'sega',
  ps1: 'playstation', psx: 'playstation', ps2: 'playstation',
  ps3: 'playstation', psp: 'playstation', psvita: 'playstation',
  xbox360: 'xbox',
  atari2600: 'atari', atari5200: 'atari', atari7800: 'atari',
  atarist: 'atari', jaguar: 'atari', jaguarcd: 'atari', lynx: 'atari',
  pcengine: 'nec', supergrafx: 'nec',
  neogeo: 'snk',
  channelf: 'fairchild',
  colecovision: 'coleco',
  windows: 'pc', ports: 'pc',
};

/** Channel / room / chip icons by semantic id. */
const NAMED_ICONS: Readonly<Record<string, IconComponent>> = {
  // Channel wall (ids from core/channels.ts).
  continue: SparkIcon,
  spark: SparkIcon,
  games: GamepadIcon,
  movies: ClapperIcon,
  youtube: PlayScreenIcon,
  customtv: TvIcon,
  weather: WeatherIcon,
  news: NewsIcon,
  situation: OrbitIcon,
  settings: GearIcon,
  // Shelf quick chips + settings tiles.
  volume: VolumeIcon,
  controllers: GamepadIcon,
  phone: PhoneIcon,
  sleep: MoonIcon,
  storage: DrivesIcon,
  network: WifiIcon,
  system: WrenchIcon,
  controls: SlidersIcon,
};

/** Resolve an icon component for a channel/platform/maker/UI id, if drawn. */
export function iconFor(id: string): IconComponent | undefined {
  const key = id.toLowerCase();
  return (
    NAMED_ICONS[key] ??
    MAKER_ICONS[key] ??
    (PLATFORM_MAKER[key] ? MAKER_ICONS[PLATFORM_MAKER[key]] : undefined)
  );
}

interface GlyphProps extends IconProps {
  /** Channel id, platform id, maker name, or UI icon name. */
  id: string;
  /** Emoji/char from the data files, shown only when no icon is drawn yet. */
  fallback?: string;
}

/**
 * The bridge from `glyph: string` data to drawn icons: renders the hand-drawn
 * SVG when the id is known, otherwise the original emoji so nothing on any
 * surface ever renders blank mid-migration.
 */
export function Glyph({ id, fallback, className }: GlyphProps): JSX.Element | null {
  const Icon = iconFor(id);
  if (Icon) return <Icon className={className} />;
  if (fallback) return <>{fallback}</>;
  return null;
}
