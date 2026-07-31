/**
 * Console catalog for the Games room (DESIGN.md §11). PC is deliberately just
 * another console — its "library" happens to be Steam. Fake game lists stand
 * in for the real library DB until Phase 4.
 */

export interface Platform {
  id: string;
  name: string;
  maker: string;
  /** Room lighting + box-art gradients take this accent. */
  accent: string;
  glyph: string;
  /** Fake titles until the library DB exists. */
  games: string[];
}

export const PLATFORMS: Platform[] = [
  // --- Nintendo ---
  { id: 'nes', name: 'NES', maker: 'Nintendo', accent: '#c94a3f', glyph: '🕹', games: ['Super Mario Bros. 3', 'The Legend of Zelda', 'Mega Man 2', 'Metroid', 'Punch-Out!!'] },
  { id: 'snes', name: 'SNES', maker: 'Nintendo', accent: '#7a6fb8', glyph: '🎛', games: ['Super Metroid', 'Chrono Trigger', 'A Link to the Past', 'Super Mario World', 'EarthBound', 'F-Zero'] },
  { id: 'n64', name: 'Nintendo 64', maker: 'Nintendo', accent: '#3e8e5a', glyph: '🎲', games: ['Flappy Bird', 'Ocarina of Time', 'Super Mario 64', 'Mario Kart 64', 'Banjo-Kazooie'] },
  // Real library scanned from D:\ISOs\Gamecube\Dolphin Games + D:\WII  USB (2026-07-30).
  {
    id: 'gamecube',
    name: 'GameCube',
    maker: 'Nintendo',
    accent: '#5b53a8',
    glyph: '🧊',
    games: [
      'Super Smash Bros. Melee',
      'Beyond Melee',
      'Project+ 2.11',
      'F-Zero GX',
      'Mario Kart: Double Dash!!',
      'Super Mario Sunshine',
      'Kirby Air Ride',
      'Zelda: Ocarina of Time & Master Quest',
      'Zelda: Twilight Princess',
      'Fire Emblem: Path of Radiance',
      'Pikmin',
      'Pikmin 2',
      'Star Fox: Assault',
      'Star Fox Adventures',
      'Mario Golf: Toadstool Tour',
      'Mario Superstar Baseball',
      'Wario World',
      'The Simpsons: Hit & Run',
      'Hot Wheels: Velocity X',
    ],
  },
  {
    id: 'wii',
    name: 'Wii',
    maker: 'Nintendo',
    accent: '#8fb7c9',
    glyph: '🎳',
    games: ['Mario Kart Wii', 'CTGP Revolution'],
  },
  { id: 'gb', name: 'Game Boy', maker: 'Nintendo', accent: '#9aa84e', glyph: '🔋', games: ["Link's Awakening", 'Pokémon Red', 'Tetris', 'Wario Land 3', 'Pokémon Crystal'] },
  // --- Sega ---
  { id: 'genesis', name: 'Genesis', maker: 'Sega', accent: '#3d6bd6', glyph: '💿', games: ['Sonic 2', 'Streets of Rage 2', 'Gunstar Heroes', 'Shining Force II', 'Ecco'] },
  { id: 'saturn', name: 'Saturn', maker: 'Sega', accent: '#8a8f98', glyph: '🪐', games: ['Panzer Dragoon Saga', 'NiGHTS', 'Virtua Fighter 2', 'Radiant Silvergun'] },
  { id: 'dreamcast', name: 'Dreamcast', maker: 'Sega', accent: '#e07830', glyph: '🌀', games: ['Jet Set Radio', 'Shenmue', 'Crazy Taxi', 'Sonic Adventure 2', 'Skies of Arcadia'] },
  // --- PlayStation ---
  { id: 'ps1', name: 'PlayStation', maker: 'PlayStation', accent: '#b9b9c9', glyph: '⬜', games: ['FF VII', 'Metal Gear Solid', 'Crash 3', 'Spyro 2', 'Symphony of the Night'] },
  { id: 'ps2', name: 'PlayStation 2', maker: 'PlayStation', accent: '#4a5ac9', glyph: '🌃', games: ['Shadow of the Colossus', 'MGS 3', 'Okami', 'Persona 4', 'God of War II'] },
  { id: 'psp', name: 'PSP', maker: 'PlayStation', accent: '#2f3f52', glyph: '📱', games: ['Crisis Core', 'Peace Walker', 'Lumines', 'Monster Hunter Freedom Unite'] },
  // --- PC (a console whose store is Steam) ---
  { id: 'pc', name: 'PC · Steam', maker: 'PC', accent: '#1f3a5f', glyph: '🖥', games: ['Hollow Knight', 'Hades', 'Celeste', 'Stardew Valley', 'DOOM Eternal', 'Balatro'] },
];

export const platformById = (id: string): Platform | undefined =>
  PLATFORMS.find((p) => p.id === id);

/** Rail grouping order for the Games room. */
export const MAKERS = ['Nintendo', 'Sega', 'PlayStation', 'PC'] as const;
