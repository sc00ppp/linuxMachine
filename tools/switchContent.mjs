/**
 * Separate real Switch games from updates, DLC, and duplicate dumps.
 *
 * A Switch romset is not a list of games. It is a list of *content*: the base
 * game, every patch, and every add-on pack, each its own file. David's shelf
 * had 143 Switch "games", of which 100 were DLC — 40-odd of them Smash Bros.
 * fighter packs — plus 4 updates and 5 duplicated dumps. Around 34 are real.
 *
 * WHY THIS IS SAFE WHEN NAME MATCHING WAS NOT:
 * Dedupe deliberately excludes Switch (see tools/dedupe.mjs) because collapsing
 * by title would merge "Mario Kart 8 Deluxe" with its DLC — they share a name.
 * That reasoning still holds. But Nintendo encodes the answer in the file:
 * every title is a 16-hex-digit id whose last three nibbles are the content
 * type. We are not guessing from the title at all.
 *
 *   0100152000022000  -> ends 000  -> base game
 *   0100152000022800  -> ends 800  -> update/patch
 *   0100152000023001  -> anything else -> add-on content (DLC)
 *
 * The DLC id is the base id + 0x1000 with an index in the low nibbles, which is
 * why Smash's packs (01006A800016F00C, ...F045) sit just above its base id
 * (01006A800016E000).
 *
 * Only Switch needs this. Wii U, 3DS, Wii and PS3 in this library are plain
 * base-game dumps with no title ids and no add-on files — verified, not assumed.
 */

/** 16 hex digits in brackets, as No-Intro/NSW scene dumps name them. */
const TITLE_ID = /\[([0-9A-Fa-f]{16})\]/;

/**
 * Homebrew tooling and mod loaders ship alongside games in these sets. They are
 * not games and should never take a shelf slot.
 */
// Underscores are word characters, so `\b` never fires inside
// "Ultimate_Mod_Manager". Separators are normalised to spaces before testing.
const NOT_A_GAME = /\b(mod ?manager|homebrew|hbmenu|tinfoil|goldleaf|nx-?shell|awoo)\b/i;

const separatorsToSpaces = (value) => value.replace(/[_+.-]+/g, ' ');

/** Names that announce themselves as add-ons even without a usable title id. */
const DLC_IN_NAME = /\[?\bDLC\b|\bupdate\b|\bpatch\b/i;

export function switchTitleId(game) {
  const haystack = `${game.path || ''} ${game.name || ''}`;
  return TITLE_ID.exec(haystack)?.[1]?.toLowerCase() ?? null;
}

/** 'base' | 'update' | 'dlc' | 'unknown' */
export function classifySwitchContent(game) {
  const id = switchTitleId(game);
  if (id) {
    const tail = id.slice(-3);
    if (tail === '000') return 'base';
    if (tail === '800') return 'update';
    return 'dlc';
  }

  // No id: fall back to the filename, which is weaker but still catches the
  // obvious cases like "Mario Kart 8 Deluxe [DLC.nsp".
  const haystack = `${game.path || ''} ${game.name || ''}`;
  if (DLC_IN_NAME.test(haystack)) return 'dlc';
  return 'unknown';
}

/**
 * The base title id a piece of content belongs to.
 *
 * Updates share the base id with the low nibbles set to 800; DLC sits in the
 * next id up. Masking the last four nibbles groups all three together, which is
 * what lets a base game claim its own updates rather than stranding them.
 */
export function baseTitleId(id) {
  if (!id) return null;
  const head = id.slice(0, 12);
  const dlcAdjusted = id.slice(-4, -3);
  // DLC ids are base+0x1000, so step the 13th nibble back down for grouping.
  const nibble = Number.parseInt(dlcAdjusted, 16);
  if (!Number.isFinite(nibble)) return head;
  return head + (nibble > 0 ? (nibble - 1).toString(16) : dlcAdjusted);
}

/**
 * Scene tags, container names, release sites and version numbers that ride
 * along in a filename and are not part of the game's title. Without stripping
 * these, "Donkey_Kong_Country_Tropical_Freeze_1.0.2_Switch-xci.com" never
 * matches "Donkey Kong Country : Tropical Freeze".
 */
const FILENAME_NOISE =
  /\b(nsp|xci|nsz|xcz|nro|switch|nsw2u|krnl|vip|com|us|eu|jp|usa|europe|japan)\b/gi;

/**
 * Dotted version numbers, stripped BEFORE separators are flattened — once
 * "1.0.2" becomes "1 0 2" it is indistinguishable from the meaningful digits in
 * "Splatoon 3" or "NBA 2K24", and blanket digit removal would eat those.
 */
const VERSION = /\bv?\d+\.\d+(?:\.\d+)*\b/gi;

function normalizeTitle(name) {
  return separatorsToSpaces(
    name
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      // Underscores first — they are word characters, so `\b` in VERSION never
      // fires inside "Freeze_1.0.2_Switch". Dots stay until the version is out.
      .replace(/[_+]/g, ' ')
      .replace(VERSION, ' '),
  )
    // Diacritics must go, or "Pokémon" and "Pokemon" stay two different games.
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(FILENAME_NOISE, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Prefer the entry that looks like a real scraped release: one the scraper knew,
 * with a clean human title rather than a raw filename.
 */
function betterEntry(left, right) {
  const scraped = (g) => Number(Boolean(g.art || g.desc || g.publisher));
  if (scraped(left) !== scraped(right)) return scraped(right) - scraped(left);

  // A title still carrying brackets or underscores is an unparsed filename.
  const messy = (g) => Number(/[\[\]_]|nsw2u|krnl\.vip/i.test(g.name));
  if (messy(left) !== messy(right)) return messy(left) - messy(right);

  return left.name.length - right.name.length;
}

/**
 * Reduce a Switch romset to distinct playable games.
 *
 * Returns the surviving games plus counts, so the importer can report honestly
 * instead of silently discarding two thirds of a shelf.
 */
export function foldSwitchLibrary(games) {
  const dropped = { updates: 0, dlc: 0, tools: 0, duplicates: 0 };
  const keepers = [];

  for (const game of games) {
    if (NOT_A_GAME.test(separatorsToSpaces(`${game.path || ''} ${game.name || ''}`))) {
      dropped.tools += 1;
      continue;
    }
    const kind = classifySwitchContent(game);
    if (kind === 'update') {
      dropped.updates += 1;
      continue;
    }
    if (kind === 'dlc') {
      dropped.dlc += 1;
      continue;
    }
    keepers.push(game);
  }

  // Group by base title id where we have one, else by normalized title.
  const groups = new Map();
  for (const game of keepers) {
    const id = switchTitleId(game);
    const key = id ? `id:${baseTitleId(id)}` : `name:${normalizeTitle(game.name)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(game);
    else groups.set(key, [game]);
  }

  const out = [];
  for (const bucket of groups.values()) {
    if (bucket.length > 1) dropped.duplicates += bucket.length - 1;
    const [best] = bucket.length === 1 ? bucket : [...bucket].sort(betterEntry);
    out.push(bucket.length > 1 ? { ...best, variantCount: bucket.length } : best);
  }

  return { games: out, dropped };
}
