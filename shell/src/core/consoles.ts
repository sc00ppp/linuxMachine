import { PLATFORMS, type Platform } from './platforms';
import { allSystems, getGames, hasLibrary, type LibraryGame } from './library';
import { dedupeGames, shouldDedupe } from './dedupe';

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
  /** Hardware release year — shelves are ordered by this. */
  year: number;
  /** Box art aspect ratio (width / height) for this system's packaging. */
  boxAspect: number;
}

/**
 * Console launch years. Shelves read chronologically, which is how anyone
 * who lived through them thinks about consoles.
 */
const YEARS: Readonly<Record<string, number>> = {
  channelf: 1976, atari2600: 1977, atari5200: 1982, colecovision: 1982,
  nes: 1983, atarist: 1985, mastersystem: 1985, atari7800: 1986,
  pcengine: 1987, gb: 1989, megadrive: 1989, genesis: 1989, lynx: 1989,
  gamegear: 1990, snes: 1990, neogeo: 1990, supergrafx: 1989,
  sega32x: 1994, saturn: 1994, ps1: 1994, psx: 1994, jaguar: 1993,
  jaguarcd: 1995, virtualboy: 1995, segacd: 1991, n64: 1996, gbc: 1998,
  n64dd: 1999, dreamcast: 1998, pokemini: 2001, ps2: 2000, gba: 2001,
  gamecube: 2001, xbox: 2001, nds: 2004, psp: 2004, triforce: 2002,
  xbox360: 2005, wii: 2006, ps3: 2006, '3ds': 2011, psvita: 2011,
  wiiu: 2012, switch: 2017, pc: 1990, windows: 1990, ports: 2000,
};

/**
 * Measured box-art ratios, generated from the real covers on disk by
 * `tools/measure-box-aspects.mjs` (median width/height per system).
 *
 * This exists because hand-guessing was wrong in both directions: N64 boxes
 * are wide landscape (1.37), Game Boy nearly square (1.11), while DS and
 * Switch really are tall (0.67, 0.62). Some systems were scraped as full
 * box wraps rather than front covers (PS1/GameCube ≈ 2.0, Xbox ≈ 2.85), and
 * matching the shelf to what the artwork actually IS beats matching it to
 * what the packaging was.
 */
const measuredModules = import.meta.glob<Record<string, number>>(
  './boxAspects.generated.json',
  { eager: true, import: 'default' },
);
const MEASURED_ASPECTS: Record<string, number> =
  measuredModules['./boxAspects.generated.json'] ?? {};

/**
 * Fallback ratios for systems with no scraped art yet. Only consulted when
 * the measured table has nothing to say.
 */
const BOX_ASPECTS: Readonly<Record<string, number>> = {
  // Handhelds: Game Boy and Game Boy Color boxes are nearly square; GBA and
  // DS cases are only slightly taller than wide. These were far too tall
  // before, which letterboxed every cover on those shelves.
  gb: 0.95, gbc: 0.95, gba: 0.88, nds: 0.9, '3ds': 0.88, psvita: 0.8,
  // Jewel / DVD cases
  psx: 0.7, ps1: 0.7, ps2: 0.7, ps3: 0.7, psp: 0.68, saturn: 0.7,
  dreamcast: 0.7, segacd: 0.72, gamecube: 0.7, wii: 0.71, wiiu: 0.71,
  switch: 0.75, xbox: 0.72, xbox360: 0.72, windows: 0.72, pc: 0.72,
  // Cardboard boxes
  snes: 1.16, nes: 0.72, megadrive: 0.78, genesis: 0.78, mastersystem: 0.72,
  gamegear: 0.9, n64: 0.78, atari2600: 1.28, atari5200: 1.28,
  atari7800: 1.28, neogeo: 1.05, pcengine: 0.9, virtualboy: 1.1,
  lynx: 1.1, jaguar: 0.78, colecovision: 1.28, channelf: 1.28,
  sega32x: 0.78, n64dd: 0.78, pokemini: 0.9, supergrafx: 0.9,
};

const DEFAULT_ASPECT = 0.75;

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
        year: YEARS[s.id] ?? 9999,
        boxAspect: MEASURED_ASPECTS[s.id] ?? BOX_ASPECTS[s.id] ?? DEFAULT_ASPECT,
      };
    })
    .sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));
}

function buildFromSamples(): ConsoleEntry[] {
  return PLATFORMS.map((p) => ({
    id: p.id,
    name: p.name,
    maker: p.maker,
    accent: p.accent,
    glyph: p.glyph,
    gameCount: p.games.length,
    year: YEARS[p.id] ?? 9999,
    boxAspect: MEASURED_ASPECTS[p.id] ?? BOX_ASPECTS[p.id] ?? DEFAULT_ASPECT,
  })).sort((a, b) => a.year - b.year);
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
  /** Other prints of the same game (regions/revisions), best-first. */
  variants?: LibraryGame[];
}

/** The playable shelf for a console: real library entries, or sample titles. */
export function shelfFor(id: string): ShelfGame[] {
  if (hasLibrary) {
    const games = getGames(id);

    // Cartridge-era romsets collapse their regional/revision duplicates;
    // modern systems are left exactly as imported (see dedupe.ts).
    if (shouldDedupe(id)) {
      return dedupeGames(games).map(({ game, variants }) => ({
        key: game.path || game.name,
        title: game.name,
        art: game.art,
        game,
        variants: variants.length > 1 ? variants : undefined,
      }));
    }

    return games.map((g) => ({
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
