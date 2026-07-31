import { useEffect, useLayoutEffect, useRef } from 'react';
import { channelById } from '../core/channels';
import { useConsoleStore } from '../core/store';
import { GearIcon, WifiIcon, WrenchIcon } from '../icons';
import { tuning } from '../motion/tuning';
import { sound } from '../sound';
import { ComingSoonScreen } from './ComingSoonScreen';
import { PhoneScreen } from './PhoneScreen';
import { SettingsGlow } from './SettingsGlow';
import { useSettingsRoomStore, type SettingsScreen } from './settingsRoomStore';
import { SettingsTile } from './SettingsTile';
import { StorageScreen } from './StorageScreen';
import { SETTINGS_TILES, type SettingsTileDef } from './tiles';
import { cssVars, prefersReducedMotion } from './util';
import './SettingsRoom.css';

/** The channel wall's own Settings tile owns this accent — reused so the room lights the same color as the tile that opened it. */
const ROOM_ACCENT = channelById('settings')?.accent ?? '#4e8e8b';

const SCREEN_TITLE: Record<Exclude<SettingsScreen, 'tiles'>, string> = {
  storage: 'Storage',
  phone: 'Phone',
  network: 'Network',
  system: 'System',
};

/**
 * The Settings room (CONTRACTS.md Round 3.5, DESIGN.md §11 room language):
 * a single row of tiles — NOT a sidebar — each opening a full screen inside
 * the room. App.tsx activates focus scope 'settings' for the whole room
 * (both the tile row and whichever screen is open share it, exactly like
 * the Games room's two levels share scope 'games') and owns all back
 * input; this component never handles back itself.
 *
 * "Which screen is open" lives in useSettingsRoomStore rather than
 * component state — see that file for why (the integrator hook for making
 * B step down one level instead of always closing the whole room).
 */
export function SettingsRoom() {
  const screen = useSettingsRoomStore((s) => s.screen);
  const openScreen = useSettingsRoomStore((s) => s.openScreen);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const levelRef = useRef<HTMLDivElement | null>(null);

  // Every time the room mounts (opened fresh from the wall), start back at
  // the tile row. The screen store is module-level and survives unmount, so
  // without this a second visit could resume deep inside e.g. Storage.
  useEffect(() => {
    useSettingsRoomStore.getState().closeScreen();
  }, []);

  // Drill-in from the wall, same choreography as the Games room.
  useLayoutEffect(() => {
    animateDrill(rootRef.current, 'deeper', tuning.drillInMs);
  }, []);

  // Screen changes drill too: opening a screen arrives from the right,
  // stepping back to the tile row arrives from the left.
  const prevScreen = useRef<SettingsScreen | null>(null);
  useLayoutEffect(() => {
    const from = prevScreen.current;
    prevScreen.current = screen;
    if (from === null || from === screen) return;

    const deeper = screen !== 'tiles';
    animateDrill(
      levelRef.current,
      deeper ? 'deeper' : 'shallower',
      deeper ? tuning.drillInMs : tuning.drillMs,
    );
  }, [screen]);

  const handleTileAccept = (tile: SettingsTileDef) => {
    if (tile.id === 'controllers') {
      // The global Wii-Home-style overlay (DESIGN.md §12), summonable from
      // anywhere — opening it here doesn't change which screen this room
      // thinks is open. Narrowing on the literal id (rather than a separate
      // `external` flag) also proves to TypeScript that `tile.id` in the
      // branch below is a valid SettingsScreen.
      sound.play('accept');
      useConsoleStore.getState().openControllers();
      return;
    }
    sound.play('accept');
    openScreen(tile.id);
  };

  const inTiles = screen === 'tiles';

  return (
    <div
      className="settings"
      ref={rootRef}
      data-screen={screen}
      style={cssVars({
        '--accent': ROOM_ACCENT,
        '--focus-ms': `${tuning.focusMoveMs}ms`,
        '--focus-ease': tuning.focusEase,
      })}
    >
      <SettingsGlow accent={ROOM_ACCENT} />

      <header className="settings-header" data-collapse="y">
        <span className="settings-header__glyph" aria-hidden="true">
          <GearIcon />
        </span>
        <h1 className="settings-heading">Settings</h1>
        {!inTiles && (
          <>
            <span className="settings-crumb" aria-hidden="true">
              ›
            </span>
            <span className="settings-screen-name">{SCREEN_TITLE[screen]}</span>
          </>
        )}
      </header>

      {/* Keyed on the screen so the outgoing screen's focus registrations
          and scroll position tear down cleanly before the next one mounts —
          same trick as the Games room's `games-level`. */}
      <div className="settings-level" key={screen} ref={levelRef}>
        {screen === 'tiles' && (
          <div className="settings-row">
            {SETTINGS_TILES.map((tile, i) => (
              <SettingsTile
                key={tile.id}
                tile={tile}
                accent={ROOM_ACCENT}
                onAccept={handleTileAccept}
                autoFocus={i === 0}
              />
            ))}
          </div>
        )}
        {screen === 'storage' && <StorageScreen />}
        {screen === 'phone' && <PhoneScreen />}
        {screen === 'network' && (
          <ComingSoonScreen
            glyph={<WifiIcon />}
            title="Network"
            note="Wi-Fi and connection details will live here once the console can see the network."
          />
        )}
        {screen === 'system' && (
          <ComingSoonScreen
            glyph={<WrenchIcon />}
            title="System"
            note="Software version, updates, and reset options will live here."
          />
        )}
      </div>

      <footer className="settings-hints" data-collapse="y">
        {inTiles && (
          <span className="settings-hint">
            <span className="settings-hint-badge" aria-hidden="true">
              A
            </span>
            <span className="settings-hint-label">Open</span>
          </span>
        )}
        <span className="settings-hint">
          <span className="settings-hint-badge" aria-hidden="true">
            B
          </span>
          <span className="settings-hint-label">Back</span>
        </span>
      </footer>
    </div>
  );
}

/**
 * The drill: a level arriving from the direction you came from. Purely
 * cosmetic (identical recipe to games/GamesRoom.tsx's `animateDrill`, kept
 * as a local copy rather than a shared import — each room owns its motion
 * glue so no room depends on another worker's internals), so every failure
 * path is swallowed.
 */
function animateDrill(
  el: HTMLElement | null,
  direction: 'deeper' | 'shallower',
  duration: number,
): void {
  if (!el) return;

  const reduced = prefersReducedMotion();
  const dx = direction === 'deeper' ? tuning.drillSlidePx : -tuning.drillSlidePx;
  const frames: Keyframe[] = reduced
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
        { opacity: 0, transform: `translate3d(${dx}px, 0, 0)` },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
      ];

  try {
    el.animate(frames, {
      duration: reduced ? 90 : duration,
      easing: tuning.drillInEase,
    });
  } catch {
    /* cosmetic only */
  }
}
