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
}

export interface LibrarySystem {
  id: string;
  /** Full source-library count; `games` is capped for the console prototype. */
  gameCount: number;
  games: LibraryGame[];
}

interface GeneratedLibrary {
  generatedAt: string;
  systems: LibrarySystem[];
}

declare global {
  interface ImportMeta {
    glob<T = unknown>(
      pattern: string,
      options: { eager: true; import: 'default' },
    ): Record<string, T>;
  }
}

/** RetroBat ids that differ from (or intentionally coalesce into) shell ids. */
export const RETROBAT_PLATFORM_ID_MAP: Readonly<Record<string, string>> = {
  megadrive: 'genesis',
  psx: 'ps1',
  gb: 'gb',
  gbc: 'gb',
};

const generatedModules = import.meta.glob<GeneratedLibrary>(
  './library.generated.json',
  { eager: true, import: 'default' },
);
const generatedLibrary = generatedModules['./library.generated.json'];
const sourceSystems = Array.isArray(generatedLibrary?.systems)
  ? generatedLibrary.systems
  : [];
const GAME_LIMIT = 150;

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

const systemsById = new Map<string, LibrarySystem>();
for (const sourceSystem of sourceSystems) {
  const id = RETROBAT_PLATFORM_ID_MAP[sourceSystem.id] ?? sourceSystem.id;
  const current = systemsById.get(id);
  if (current) {
    current.gameCount += sourceSystem.gameCount;
    current.games = [...current.games, ...sourceSystem.games]
      .sort(compareGames)
      .slice(0, GAME_LIMIT);
  } else {
    systemsById.set(id, {
      id,
      gameCount: sourceSystem.gameCount,
      games: [...sourceSystem.games].sort(compareGames).slice(0, GAME_LIMIT),
    });
  }
}

const librarySystems = [...systemsById.values()];

export function getSystem(id: string): LibrarySystem | undefined {
  return systemsById.get(RETROBAT_PLATFORM_ID_MAP[id] ?? id);
}

export function getGames(id: string): LibraryGame[] {
  return getSystem(id)?.games ?? [];
}

export function allSystems(): LibrarySystem[] {
  return librarySystems;
}
