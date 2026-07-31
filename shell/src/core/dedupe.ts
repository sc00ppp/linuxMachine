import type { LibraryGame } from './library';

/**
 * Collapse romset duplicates into one shelf entry per actual game.
 *
 * A complete romset carries the same game many times over: regional prints
 * ("(USA)", "(Europe)", "(Japan)"), revisions ("(Rev 1)", "(v1.1)"), dump
 * flags ("[!]", "[b]"), and unreleased builds ("(Beta)", "(Proto)"). Showing
 * all of them turns a 2,255-game NES shelf into mostly noise.
 *
 * We group by a normalized title and elect one representative, keeping the
 * rest as `variants` so a detail page can still offer "3 versions".
 *
 * Multi-disc entries are deliberately grouped too: "(Disc 1)"/"(Disc 2)" are
 * one game, and disc switching belongs to the emulator, not the shelf.
 */

/**
 * Only cartridge-era systems get deduped.
 *
 * Those romsets are exhaustive: the same game appears as USA/Europe/Japan
 * prints, revisions and dumps. Modern systems are deliberately excluded —
 * on Switch/PS3/Wii U a "duplicate-looking" entry is usually DLC, an update
 * pack, or a genuinely different release, and collapsing those would hide
 * real content. Disc systems are left alone for the same reason.
 */
const DEDUPE_SYSTEMS = new Set([
  'nes', 'snes', 'genesis', 'megadrive', 'mastersystem', 'gamegear',
  'gb', 'gbc', 'gba', 'n64', 'n64dd', 'virtualboy', 'pokemini',
  'atari2600', 'atari5200', 'atari7800', 'atarist', 'lynx', 'jaguar',
  'pcengine', 'supergrafx', 'sega32x', 'neogeo', 'colecovision', 'channelf',
]);

export function shouldDedupe(systemId: string): boolean {
  return DEDUPE_SYSTEMS.has(systemId);
}

export interface DedupedGame {
  /** The elected representative. */
  game: LibraryGame;
  /** Every entry in the group, best-first (includes `game`). */
  variants: LibraryGame[];
}

/** Bracketed dump flags: [!], [b1], [a], [o2], [h1C]… */
const DUMP_FLAGS = /\[[^\]]*\]/g;
/** Parenthesised qualifiers we treat as version noise, not identity. */
const PAREN_NOISE =
  /\((usa|europe|japan|world|asia|korea|china|brazil|france|germany|italy|spain|sweden|netherlands|australia|canada|hong kong|taiwan|russia|uk|u|e|j|jp|eu|us|beta\s*\d*|proto\s*\d*|prototype|demo|sample|kiosk|unl|unlicensed|pirate|alt\s*\d*|alternate|rev\s*[\w.]+|v\d[\w.]*|version\s*[\w.]+|disc\s*\d+|disk\s*\d+|cd\s*\d+|side\s*[ab]|track\s*\d+|en|fr|de|es|it|nl|pt|sv|da|no|fi|ja|zh|ko|ru|pl|multi\d*|[a-z]{2}(,[a-z]{2})+)\)/gi;

/** Titles differing only by these are the same game. */
export function normalizeTitle(name: string): string {
  return name
    .replace(DUMP_FLAGS, ' ')
    .replace(PAREN_NOISE, ' ')
    // Leading article shuffling: "Legend of Zelda, The" → "legend of zelda"
    .replace(/,\s*(the|a|an)\b/gi, ' ')
    .replace(/^\s*(the|a|an)\s+/i, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const REGION_RANK: Record<string, number> = {
  usa: 0, us: 0, u: 0, world: 1, w: 1, europe: 2, eu: 2, e: 2, japan: 3, jp: 3, j: 3,
};

function regionScore(g: LibraryGame): number {
  const explicit = g.region?.toLowerCase().trim();
  if (explicit && explicit in REGION_RANK) return REGION_RANK[explicit];
  const fromName = /\((usa|world|europe|japan)\)/i.exec(g.name)?.[1]?.toLowerCase();
  if (fromName && fromName in REGION_RANK) return REGION_RANK[fromName];
  return 4;
}

/** Unreleased/broken builds sink to the bottom of a group. */
function buildPenalty(g: LibraryGame): number {
  return /\((beta|proto|prototype|demo|sample|kiosk|unl|pirate)\b/i.test(g.name) ||
    /\[b\d*\]/i.test(g.name)
    ? 1
    : 0;
}

function revisionScore(g: LibraryGame): number {
  const rev = /\(rev\s*([\w.]+)\)/i.exec(g.name)?.[1];
  if (!rev) return 0;
  const n = Number.parseFloat(rev);
  return Number.isFinite(n) ? n : rev.toLowerCase().charCodeAt(0) - 96;
}

/**
 * Better representative sorts first. The user's own history wins outright:
 * if they've played one print of a game, that's the one they mean.
 */
function compare(a: LibraryGame, b: LibraryGame): number {
  if (a.playcount !== b.playcount) return b.playcount - a.playcount;
  if (a.favorite !== b.favorite) return Number(b.favorite) - Number(a.favorite);

  const penalty = buildPenalty(a) - buildPenalty(b);
  if (penalty !== 0) return penalty;

  const hasArt = Number(Boolean(b.art)) - Number(Boolean(a.art));
  if (hasArt !== 0) return hasArt;

  const region = regionScore(a) - regionScore(b);
  if (region !== 0) return region;

  const rev = revisionScore(b) - revisionScore(a);
  if (rev !== 0) return rev;

  // Finally prefer the plainer title — fewer parenthetical qualifiers.
  const parens = (a.name.match(/\(/g)?.length ?? 0) - (b.name.match(/\(/g)?.length ?? 0);
  if (parens !== 0) return parens;

  return a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });
}

export function dedupeGames(games: LibraryGame[]): DedupedGame[] {
  const groups = new Map<string, LibraryGame[]>();

  for (const game of games) {
    const key = normalizeTitle(game.name) || game.name.toLowerCase();
    const bucket = groups.get(key);
    if (bucket) bucket.push(game);
    else groups.set(key, [game]);
  }

  const out: DedupedGame[] = [];
  for (const bucket of groups.values()) {
    const variants = [...bucket].sort(compare);
    out.push({ game: variants[0], variants });
  }
  return out;
}
