import { PLATFORMS, type Platform } from './platforms';
import { allSystems, getGames, hasLibrary, type LibraryGame } from './library';

/**
 * The console shelf, resolved from the REAL imported library when one exists
 * and falling back to the hand-written sample platforms when it doesn't.
 *
 * `platforms.ts` stays the source of presentation metadata (display name,
 * accent, glyph, maker grouping); the generated library supplies which
 * systems actually exist and what's in them. Systems present on disk but
 * absent from `platforms.ts` still show up — they get a derived name and a
 * hashed accent rather than being silently dropped.
 */

export interface ConsoleEntry {
  id: string;
  name: string;
  maker: string;
  accent: string;
  glyph: string;
  /** True library size (not the capped subset we ship art for). */
  gameCount: number;
}

/** Display names for systems the sample platform list never modelled. */
const EXTRA_NAMES: Readonly<Record<string, string>> = {
  '3ds': 'Nintendo 3DS',
  atari2600: 'Atari 2600',
  atari5200: 'Atari 5200',
  atari7800: 'Atari 7800',
  atarist: 'Atari ST',
  channelf: 'Fairchild Channel F',
  colecovision: 'ColecoVision',
  gamegear: 'Game Gear',
  gba: 'Game Boy Advance',
  gbc: 'Game Boy Color',
  jaguar: 'Atari Jaguar',
  jaguarcd: 'Jaguar CD',
  lynx: 'Atari Lynx',
  mastersystem: 'Master System',
  n64dd: 'Nintendo 64DD',
  nds: 'Nintendo DS',
  neogeo: 'Neo Geo',
  pcengine: 'PC Engine',
  pokemini: 'Pokémon Mini',
  ports: 'Ports',
  ps3: 'PlayStation 3',
  sega32x: 'Sega 32X',
  segacd: 'Sega CD',
  supergrafx: 'SuperGrafx',
  switch: 'Nintendo Switch',
  triforce: 'Triforce',
  virtualboy: 'Virtual Boy',
  wiiu: 'Wii U',
  windows: 'Windows',
  xbox: 'Xbox',
  xbox360: 'Xbox 360',
};

const MAKER_BY_ID: Readonly<Record<string, string>> = {
  '3ds': 'Nintendo', gba: 'Nintendo', gbc: 'Nintendo', nds: 'Nintendo',
  n64dd: 'Nintendo', switch: 'Nintendo', wiiu: 'Nintendo', virtualboy: 'Nintendo',
  pokemini: 'Nintendo', triforce: 'Nintendo',
  gamegear: 'Sega', mastersystem: 'Sega', sega32x: 'Sega', segacd: 'Sega',
  ps3: 'PlayStation',
  xbox: 'Xbox', xbox360: 'Xbox',
  atari2600: 'Atari', atari5200: 'Atari', atari7800: 'Atari', atarist: 'Atari',
  jaguar: 'Atari', jaguarcd: 'Atari', lynx: 'Atari',
  pcengine: 'NEC', supergrafx: 'NEC',
  neogeo: 'SNK',
  channelf: 'Fairchild', colecovision: 'Coleco',
  windows: 'PC', ports: 'PC',
};

const GLYPH_BY_MAKER: Readonly<Record<string, string>> = {
  Nintendo: '🎮', Sega: '💿', PlayStation: '⬜', Xbox: '🎯', Atari: '🕹',
  NEC: '📀', SNK: '👾', PC: '🖥', Fairchild: '📼', Coleco: '🎲',
};

/** Stable pleasant accent for systems without hand-picked colors. */
function derivedAccent(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 42% 52%)`;
}

function titleize(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

const platformById = new Map<string, Platform>(PLATFORMS.map((p) => [p.id, p]));

function buildFromLibrary(): ConsoleEntry[] {
  return allSystems()
    .filter((s) => s.games.length > 0)
    .map((s) => {
      const p = platformById.get(s.id);
      const maker = p?.maker ?? MAKER_BY_ID[s.id] ?? 'Other';
      return {
        id: s.id,
        name: p?.name ?? EXTRA_NAMES[s.id] ?? titleize(s.id),
        maker,
        accent: p?.accent ?? derivedAccent(s.id),
        glyph: p?.glyph ?? GLYPH_BY_MAKER[maker] ?? '🕹',
        gameCount: s.gameCount,
      };
    })
    .sort((a, b) => b.gameCount - a.gameCount);
}

function buildFromSamples(): ConsoleEntry[] {
  return PLATFORMS.map((p) => ({
    id: p.id,
    name: p.name,
    maker: p.maker,
    accent: p.accent,
    glyph: p.glyph,
    gameCount: p.games.length,
  }));
}

export const CONSOLES: ConsoleEntry[] = hasLibrary
  ? buildFromLibrary()
  : buildFromSamples();

export const consoleById = (id: string): ConsoleEntry | undefined =>
  CONSOLES.find((c) => c.id === id);

export interface ShelfGame {
  key: string;
  title: string;
  /** Public art path from the importer, when the scrape had an image. */
  art: string | null;
  game: LibraryGame | null;
}

/** The playable shelf for a console: real library entries, or sample titles. */
export function shelfFor(id: string): ShelfGame[] {
  if (hasLibrary) {
    return getGames(id).map((g) => ({
      key: g.path || g.name,
      title: g.name,
      art: g.art,
      game: g,
    }));
  }
  const p = platformById.get(id);
  return (p?.games ?? []).map((title) => ({
    key: title,
    title,
    art: null,
    game: null,
  }));
}
