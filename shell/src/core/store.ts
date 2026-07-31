import { create } from 'zustand';
import type { ConsoleMode } from './types';

/** In-shell screens layered over/instead of the channel wall. */
export type HomeView =
  | 'wall'
  | 'games'
  | 'movies'
  | 'youtube'
  | 'customtv'
  | 'settings'
  | 'weather'
  | 'news'
  | 'situation';

/**
 * Global console state. Owned by the integrator — workers import, never edit.
 *
 * Launch round-trip (DESIGN.md §3):
 *   HomeScreen tile accept → motion.playLaunch(tileEl) → launchApp(id)
 *   Home button in app     → openShelf() / closeShelf()
 *   Shelf "Quit to Home"   → requestReturn() → HomeScreen mounts, runs
 *   motion.playReturn(tileEl of returningChannel) → finishReturn()
 *
 * Overlay stack (top wins input): remap room → controllers overlay → shelf.
 * The Controllers overlay (DESIGN.md §12) can open over ANY state — that's
 * the Wii Home Menu trick — so it lives outside mode/view.
 */
interface ConsoleStore {
  mode: ConsoleMode;
  /** In-shell screen when mode === 'home'. */
  view: HomeView;
  /** Games room level: console picker → a console's grid → one game's page. */
  gamesLevel: 'consoles' | 'grid' | 'detail';
  /** Custom TV opens live; guide and on-demand are steps down from it. */
  customTvScreen: 'live' | 'guide' | 'library';
  /** Which game's detail page is open (shelf entry key). */
  selectedGameKey: string | null;
  /** News channel: reading the full story rather than the headline view. */
  newsReading: boolean;
  /** Channel id of the simulated running app (mode === 'app'). */
  runningChannel: string | null;
  /** Optional specific title (e.g. a game) shown by the app sim. */
  runningTitle: string | null;
  /** Set while the return-home reverse transition is playing. */
  returningChannel: string | null;
  shelfOpen: boolean;

  /** Controllers overlay (DESIGN.md §12). */
  controllersOpen: boolean;
  /** Remap room (DESIGN.md §13): the emulated platform id, or null. */
  remapPlatform: string | null;
  /** True while remap captures the next raw button — App must ignore input. */
  remapListening: boolean;

  launchApp: (channelId: string, title?: string) => void;
  openShelf: () => void;
  closeShelf: () => void;
  /** Quit the app; Home mounts and plays the reverse transition. */
  requestReturn: () => void;
  finishReturn: () => void;

  openGames: () => void;
  openSettings: () => void;
  /** Generic drill into any in-shell channel screen. */
  openView: (view: HomeView) => void;
  closeView: () => void;
  setGamesLevel: (level: 'consoles' | 'grid' | 'detail') => void;
  setCustomTvScreen: (screen: 'live' | 'guide' | 'library') => void;
  openGameDetail: (key: string) => void;
  closeGameDetail: () => void;
  setNewsReading: (reading: boolean) => void;

  openControllers: () => void;
  closeControllers: () => void;
  openRemap: (platformId: string) => void;
  closeRemap: () => void;
  setRemapListening: (listening: boolean) => void;
}

export const useConsoleStore = create<ConsoleStore>((set) => ({
  mode: 'home',
  view: 'wall',
  gamesLevel: 'consoles',
  customTvScreen: 'live',
  selectedGameKey: null,
  newsReading: false,
  runningChannel: null,
  runningTitle: null,
  returningChannel: null,
  shelfOpen: false,
  controllersOpen: false,
  remapPlatform: null,
  remapListening: false,

  launchApp: (channelId, title) =>
    set({
      mode: 'app',
      runningChannel: channelId,
      runningTitle: title ?? null,
      shelfOpen: false,
    }),
  openShelf: () => set({ shelfOpen: true }),
  closeShelf: () => set({ shelfOpen: false }),
  requestReturn: () =>
    set((s) => ({
      mode: 'home',
      // Quitting a game returns to the wall, not into the Games room.
      view: 'wall',
      returningChannel: s.runningChannel,
      runningChannel: null,
      runningTitle: null,
      shelfOpen: false,
    })),
  finishReturn: () => set({ returningChannel: null }),

  openGames: () => set({ view: 'games', gamesLevel: 'consoles' }),
  openSettings: () => set({ view: 'settings' }),
  openView: (view) => set({ view, gamesLevel: 'consoles', customTvScreen: 'live', newsReading: false }),
  closeView: () =>
    set({ view: 'wall', gamesLevel: 'consoles', customTvScreen: 'live', newsReading: false }),
  setGamesLevel: (level) => set({ gamesLevel: level }),
  setCustomTvScreen: (screen) => set({ customTvScreen: screen }),
  openGameDetail: (key) => set({ gamesLevel: 'detail', selectedGameKey: key }),
  closeGameDetail: () => set({ gamesLevel: 'grid', selectedGameKey: null }),
  setNewsReading: (reading) => set({ newsReading: reading }),

  openControllers: () => set({ controllersOpen: true }),
  closeControllers: () =>
    set({ controllersOpen: false, remapPlatform: null, remapListening: false }),
  openRemap: (platformId) => set({ remapPlatform: platformId }),
  closeRemap: () => set({ remapPlatform: null, remapListening: false }),
  setRemapListening: (listening) => set({ remapListening: listening }),
}));
