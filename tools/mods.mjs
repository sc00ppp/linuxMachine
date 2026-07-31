/**
 * Group romhacks and mods under the game they modify.
 *
 * A hack belongs with its game, not scattered alphabetically across the shelf.
 * Five Fire Emblem hacks should be five entries on Fire Emblem's page, not five
 * more boxes to scroll past.
 *
 * DETECTION IS BY METADATA ABSENCE, NOT TITLE SHAPE. A scraped release carries
 * desc/publisher/releasedate/art from ScreenScraper; a romhack is in no
 * database, so it arrives bare. That asymmetry is the signal.
 *
 * The obvious alternative — matching title prefixes — was measured against the
 * real library and is actively wrong: it reads "Mega Man 2" as a mod of "Mega
 * Man", "Sonic The Hedgehog 2" as a mod of "Sonic", and "Super Mario Bros. 3"
 * as a mod of "Super Mario Bros." Sequels are not mods. Every guard below was
 * earned from a specific mismatch in David's actual romset.
 */

/**
 * PC-like systems are excluded. There a bare entry beside a scraped one is a
 * launcher artifact ("Slippi Dolphin.exe - Shortcut" next to "Slippi"), not a
 * romhack.
 */
const EXCLUDED_SYSTEMS = new Set(['windows', 'ports', 'pc']);

/**
 * Playlists and shortcuts are never mods. A multi-disc `.m3u` is the *same*
 * game — that is dedupe's job, and letting it land here would file
 * "Resident Evil 2.m3u" as a mod of Resident Evil 2.
 */
const EXCLUDED_EXTENSIONS = /\.(m3u|lnk|exe|url|bat|cmd)$/i;

/** Shortest base title we will let adopt a mod, normalized. */
const MIN_BASE_LENGTH = 5;

/**
 * A number or roman numeral straight after the base title means sequel, not
 * mod — "Dungeon II - Solstice" is a sequel to "Dungeon". Bare "x" and "v" are
 * deliberately absent: they read as sequel numerals far less often than they
 * read as hack suffixes ("Super Mario Land X").
 */
const SEQUEL_MARKER = /^(?:\d+|ii|iii|iv|vi|vii|viii|ix|xi|xii|xiii)\b/;

function normalize(name) {
  return name
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,\s*(the|a|an)\b/gi, ' ')
    .replace(/^\s*(the|a|an)\s+/i, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Did the scraper know this game? Art alone is not enough — a game can have a
 * local image with no other metadata — so any one scraped field counts.
 */
function isScraped(game) {
  return Boolean(game.art || game.desc || game.publisher || game.releasedate);
}

function isModCandidate(game) {
  if (isScraped(game)) return false;
  if (EXCLUDED_EXTENSIONS.test(game.path || '')) return false;
  return true;
}

/**
 * Find the base game a candidate modifies, or null.
 *
 * `bases` must be pre-sorted longest-title-first so "super mario land" claims
 * "Super Mario Land X" before plain "mario" ever sees it.
 */
function findBase(candidate, bases) {
  const title = normalize(candidate.name);
  if (!title) return null;

  for (const base of bases) {
    if (base.title.length < MIN_BASE_LENGTH) continue;
    if (base.title === title) continue;

    // The base must appear as a whole-word run, anchored at the start. A base
    // matching only at the end ("A-VCS-tec Challenge" vs "Challenge") is a
    // coincidence of vocabulary, not a hack of that game.
    if (!title.startsWith(base.title + ' ')) continue;

    const remainder = title.slice(base.title.length + 1);
    if (SEQUEL_MARKER.test(remainder)) continue;

    return base.game;
  }
  return null;
}

/**
 * Partition one system's shelf into standalone entries and mods.
 *
 * Returns `{ games, modCount }` where `games` keeps only non-mod entries, each
 * base game carrying a `mods` array of the entries folded into it. Mods that
 * matched nothing stay on the shelf as themselves — they are standalone
 * homebrew ("Among Us", "AEW Wrestling"), not mods of anything.
 */
export function foldMods(systemId, games) {
  if (EXCLUDED_SYSTEMS.has(systemId)) return { games, modCount: 0 };

  const bases = games
    .filter(isScraped)
    .map((game) => ({ game, title: normalize(game.name) }))
    .filter((entry) => entry.title.length >= MIN_BASE_LENGTH)
    .sort((left, right) => right.title.length - left.title.length);

  if (bases.length === 0) return { games, modCount: 0 };

  const modsByBase = new Map();
  const folded = new Set();

  for (const game of games) {
    if (!isModCandidate(game)) continue;
    const base = findBase(game, bases);
    if (!base) continue;

    const bucket = modsByBase.get(base);
    if (bucket) bucket.push(game);
    else modsByBase.set(base, [game]);
    folded.add(game);
  }

  if (folded.size === 0) return { games, modCount: 0 };

  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const remaining = [];
  for (const game of games) {
    if (folded.has(game)) continue;
    const mods = modsByBase.get(game);
    remaining.push(
      mods
        ? {
            ...game,
            mods: mods
              .map((mod) => ({ name: mod.name, path: mod.path }))
              .sort((left, right) => collator.compare(left.name, right.name)),
          }
        : game,
    );
  }

  return { games: remaining, modCount: folded.size };
}
