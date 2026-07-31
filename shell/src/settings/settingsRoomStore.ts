import { create } from 'zustand';

/**
 * Which screen is open inside the Settings room (DESIGN.md §11 room
 * language — a single row of tiles, each opening a full screen *within* the
 * room, not a sidebar). 'tiles' is the row itself; everything else is a
 * full-room screen a tile opened.
 */
export type SettingsScreen = 'tiles' | 'storage' | 'phone' | 'network' | 'system';

interface SettingsRoomState {
  screen: SettingsScreen;
  openScreen: (screen: SettingsScreen) => void;
  /** Back to the tile row. */
  closeScreen: () => void;
}

/**
 * INTEGRATOR HOOK (CONTRACTS.md Round 3.5): this is a tiny standalone
 * zustand store rather than component state living inside SettingsRoom,
 * even though a plain `useState` would satisfy Round 3.5 on its own. The
 * reason is App.tsx's back handling: today, per core/store.ts + App.tsx,
 * pressing B while `view === 'settings'` always calls `closeView()` and
 * drops straight to the channel wall — there is no concept of "a screen is
 * open inside the room" at the integrator level, so B closes the whole room
 * even if e.g. the Storage screen is open, skipping the "screen -> tile row"
 * step that Games gets for free via `gamesLevel`.
 *
 * To fix that later WITHOUT restructuring this module: give core/store.ts a
 * `settingsScreen` field (or import this store directly — either works),
 * and in App.tsx's back handler add a branch ahead of the existing
 * `view !== 'wall'` fallthrough:
 *
 *   } else if (st.mode === 'home' && st.view === 'settings' &&
 *              useSettingsRoomStore.getState().screen !== 'tiles') {
 *     useSettingsRoomStore.getState().closeScreen();
 *     sound.play('back');
 *   } else if (st.mode === 'home' && st.view !== 'wall') {
 *     ...
 *
 * No prop drilling, no lifting state up through SettingsRoom — the store
 * already lives outside the component tree, exactly where App.tsx would
 * need to read it from.
 */
export const useSettingsRoomStore = create<SettingsRoomState>((set) => ({
  screen: 'tiles',
  openScreen: (screen) => set({ screen }),
  closeScreen: () => set({ screen: 'tiles' }),
}));
