import { mediaUrl } from './mediaHost';

/** A romhack, launchable from its base game's page. */
export interface GameMod {
  name: string;
  path: string;
}

export interface LibraryGame {
  systemId: string;
  path: string;
  name: string;
  desc: string;
  image: string;
  thumbnail: string;
  marquee: string;
  video: string | null;
  rating: number | null;
  releasedate: string;
  developer: string;
  publisher: string;
  genre: string;
  players: string;
  region: string;
  favorite: boolean;
  playcount: number;
  lastplayed: string;
  gametime: number;
  art: string | null;
  screenshot: string | null;
  /**
   * How many prints of this game the romset held (1 when unique). Set by the
   * importer's dedupe pass; absent on systems that aren't deduped.
   */
  variantCount?: number;
  /**
   * Romhacks of this game, folded off the shelf by the importer so they launch
   * from the page of the game they modify. Absent when there are none.
   */
  mods?: GameMod[];
}

export interface LibrarySystem {
  id: string;
  /**
   * Full source-library count, duplicates included — what the romset actually
   * holds. `games` is the deduped shelf, so on cartridge systems it is smaller
   * (NES: 2,255 files, ~900 distinct games). Nothing is capped.
   */
  gameCount: number;
  games: LibraryGame[];
}

export interface LibrarySystemSummary {
  id: string;
  gameCount: number;
  /** Number of game records in this system's lazy shelf chunk. */
  shelfCount: number;
}

interface GeneratedLibraryIndex {
  generatedAt: string;
  systems: LibrarySystemSummary[];
}

declare global {
  interface ImportMeta {
    glob<T = unknown>(
      pattern: string,
      options: { eager: true; import: 'default' },
    ): Record<string, T>;
    glob<T = unknown>(
      pattern: string,
    ): Record<string, () => Promise<T>>;
  }
}

/** RetroBat ids that differ from (or intentionally coalesce into) shell ids. */
export const RETROBAT_PLATFORM_ID_MAP: Readonly<Record<string, string>> = {
  megadrive: 'genesis',
  psx: 'ps1',
  gb: 'gb',
  gbc: 'gb',
};

const generatedIndexModules = import.meta.glob<GeneratedLibraryIndex>(
  './library/index.generated.json',
  { eager: true, import: 'default' },
);
const generatedIndex =
  generatedIndexModules['./library/index.generated.json'];
const sourceSystems = Array.isArray(generatedIndex?.systems)
  ? generatedIndex.systems
  : [];
const generatedSystemModules = import.meta.glob<{
  default: LibraryGame[];
}>('./library/*.generated.json');

export const hasLibrary = sourceSystems.length > 0;

function compareGames(left: LibraryGame, right: LibraryGame): number {
  if (left.playcount !== right.playcount) {
    return right.playcount - left.playcount;
  }
  if (left.favorite !== right.favorite) {
    return Number(right.favorite) - Number(left.favorite);
  }
  return (
    left.name.localeCompare(right.name, 'en', {
      numeric: true,
      sensitivity: 'base',
    }) || left.path.localeCompare(right.path, 'en')
  );
}

function resolveGameMedia(game: LibraryGame): LibraryGame {
  return {
    ...game,
    art: mediaUrl(game.art),
    screenshot: mediaUrl(game.screenshot),
    video: mediaUrl(game.video),
  };
}

const systemsById = new Map<string, LibrarySystemSummary>();
const sourceIdsById = new Map<string, string[]>();
for (const sourceSystem of sourceSystems) {
  const id = RETROBAT_PLATFORM_ID_MAP[sourceSystem.id] ?? sourceSystem.id;
  const sourceIds = sourceIdsById.get(id);
  if (sourceIds) {
    sourceIds.push(sourceSystem.id);
  } else {
    sourceIdsById.set(id, [sourceSystem.id]);
  }

  const current = systemsById.get(id);
  if (current) {
    current.gameCount += sourceSystem.gameCount;
    current.shelfCount += sourceSystem.shelfCount;
  } else {
    systemsById.set(id, {
      id,
      gameCount: sourceSystem.gameCount,
      shelfCount: sourceSystem.shelfCount,
    });
  }
}

const librarySystems = [...systemsById.values()];
const systemPromises = new Map<string, Promise<LibrarySystem>>();

async function importSystem(id: string): Promise<LibraryGame[]> {
  const path = `./library/${id}.generated.json`;
  const load = generatedSystemModules[path];
  if (!load) {
    throw new Error(`Missing generated library chunk: ${path}`);
  }
  const module = await load();
  if (!Array.isArray(module.default)) {
    throw new Error(`Invalid generated library chunk: ${path}`);
  }
  return module.default;
}

async function importMergedSystem(id: string): Promise<LibrarySystem> {
  const summary = systemsById.get(id);
  const sourceIds = sourceIdsById.get(id) ?? [];
  const sourceGames = await Promise.all(sourceIds.map(importSystem));
  const games = sourceGames
    .flat()
    .map(resolveGameMedia)
    .sort(compareGames);
  return {
    id,
    gameCount: summary?.gameCount ?? games.length,
    games,
  };
}

/**
 * Load one console's shelf. The promise remains cached after it settles, so
 * focus prefetch, opening the grid, and returning from the console row all
 * share the same network request and parsed records.
 */
export async function loadSystem(id: string): Promise<LibrarySystem> {
  const resolvedId = RETROBAT_PLATFORM_ID_MAP[id] ?? id;
  let promise = systemPromises.get(resolvedId);
  if (!promise) {
    promise = importMergedSystem(resolvedId);
    systemPromises.set(resolvedId, promise);
  }
  return promise;
}

export function allSystems(): LibrarySystemSummary[] {
  return librarySystems;
}
