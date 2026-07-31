/**
 * Collapse romset duplicates into one entry per actual game.
 *
 * This runs at IMPORT time, over the complete per-system romset, before any
 * ranking or capping. It used to run in the shell against the already-capped
 * subset, which meant a 2,255-game NES set was cut to 150 and *then* deduped —
 * so the shelf showed ~60 titles and the other 2,100 games were simply never
 * imported. Deduping the whole set first is the only order that produces a
 * shelf of distinct games rather than a shelf of arbitrary survivors.
 *
 * A complete romset carries the same game many times over: regional prints
 * ("(USA)", "(Europe)", "(Japan)"), revisions ("(Rev 1)", "(v1.1)"), dump
 * flags ("[!]", "[b]"), and unreleased builds ("(Beta)", "(Proto)"). We group
 * by a normalized title and elect one representative, recording how many
 * prints it stood in for.
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
 * real content. Disc systems are left alone for the same reason: PlayStation
 * multi-disc sets would swallow whole games.
 */
const DEDUPE_SYSTEMS = new Set([
  'nes', 'snes', 'genesis', 'megadrive', 'mastersystem', 'gamegear',
  'gb', 'gbc', 'gba', 'n64', 'n64dd', 'virtualboy', 'pokemini',
  'atari2600', 'atari5200', 'atari7800', 'atarist', 'lynx', 'jaguar',
  'pcengine', 'supergrafx', 'sega32x', 'neogeo', 'colecovision', 'channelf',
]);

export function shouldDedupe(systemId) {
  return DEDUPE_SYSTEMS.has(systemId);
}

/** Bracketed dump flags: [!], [b1], [a], [o2], [h1C]… */
const DUMP_FLAGS = /\[[^\]]*\]/g;
/** Parenthesised qualifiers we treat as version noise, not identity. */
const PAREN_NOISE =
  /\((usa|europe|japan|world|asia|korea|china|brazil|france|germany|italy|spain|sweden|netherlands|australia|canada|hong kong|taiwan|russia|uk|u|e|j|jp|eu|us|beta\s*\d*|proto\s*\d*|prototype|demo|sample|kiosk|unl|unlicensed|pirate|alt\s*\d*|alternate|rev\s*[\w.]+|v\d[\w.]*|version\s*[\w.]+|disc\s*\d+|disk\s*\d+|cd\s*\d+|side\s*[ab]|track\s*\d+|en|fr|de|es|it|nl|pt|sv|da|no|fi|ja|zh|ko|ru|pl|multi\d*|[a-z]{2}(,[a-z]{2})+)\)/gi;

/** Titles differing only by these are the same game. */
export function normalizeTitle(name) {
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

const REGION_RANK = {
  usa: 0, us: 0, u: 0, world: 1, w: 1, europe: 2, eu: 2, e: 2, japan: 3, jp: 3, j: 3,
};

function regionScore(game) {
  const explicit = game.region?.toLowerCase().trim();
  if (explicit && explicit in REGION_RANK) return REGION_RANK[explicit];
  const fromName = /\((usa|world|europe|japan)\)/i
    .exec(game.name)?.[1]
    ?.toLowerCase();
  if (fromName && fromName in REGION_RANK) return REGION_RANK[fromName];
  return 4;
}

/** Unreleased/broken builds sink to the bottom of a group. */
function buildPenalty(game) {
  return /\((beta|proto|prototype|demo|sample|kiosk|unl|pirate)\b/i.test(game.name) ||
    /\[b\d*\]/i.test(game.name)
    ? 1
    : 0;
}

function revisionScore(game) {
  const revision = /\(rev\s*([\w.]+)\)/i.exec(game.name)?.[1];
  if (!revision) return 0;
  const numeric = Number.parseFloat(revision);
  return Number.isFinite(numeric)
    ? numeric
    : revision.toLowerCase().charCodeAt(0) - 96;
}

/**
 * Better representative sorts first. The user's own history wins outright:
 * if they've played one print of a game, that's the one they mean.
 *
 * Art is NOT a tie-breaker here the way it was in the shell version: at import
 * time no game has resolved art yet (media is attached afterwards), so scoring
 * on it would silently do nothing.
 */
function compare(left, right) {
  if (left.playcount !== right.playcount) return right.playcount - left.playcount;
  if (left.favorite !== right.favorite) {
    return Number(right.favorite) - Number(left.favorite);
  }

  const penalty = buildPenalty(left) - buildPenalty(right);
  if (penalty !== 0) return penalty;

  // A scraped entry carries a description and artwork filenames; an unscraped
  // one is a bare filename. Prefer the print the scraper actually knew.
  const scraped =
    Number(Boolean(right.image || right.thumbnail)) -
    Number(Boolean(left.image || left.thumbnail));
  if (scraped !== 0) return scraped;

  const region = regionScore(left) - regionScore(right);
  if (region !== 0) return region;

  const revision = revisionScore(right) - revisionScore(left);
  if (revision !== 0) return revision;

  // Finally prefer the plainer title — fewer parenthetical qualifiers.
  const parens =
    (left.name.match(/\(/g)?.length ?? 0) - (right.name.match(/\(/g)?.length ?? 0);
  if (parens !== 0) return parens;

  return left.name.localeCompare(right.name, 'en', {
    numeric: true,
    sensitivity: 'base',
  });
}

/**
 * Collapse `games` to one entry per distinct title.
 *
 * Returns the elected representatives, each carrying `variantCount` (how many
 * prints it stood in for, 1 when unique). Input order is otherwise preserved
 * via the representative's own position, so the caller's ranking still holds.
 */
export function dedupeGames(games) {
  const groups = new Map();

  for (const game of games) {
    const key = normalizeTitle(game.name) || game.name.toLowerCase();
    const bucket = groups.get(key);
    if (bucket) bucket.push(game);
    else groups.set(key, [game]);
  }

  const representatives = [];
  for (const bucket of groups.values()) {
    const [best] = bucket.length === 1 ? bucket : [...bucket].sort(compare);
    representatives.push({ ...best, variantCount: bucket.length });
  }
  return representatives;
}
