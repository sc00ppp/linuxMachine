import { useEffect } from 'react';
import { startCursorIdle } from './styles/cursorIdle';
import { startInput } from './input';
import { startTvLink } from './core/tvLink';
import type { ConsoleInput } from './core/types';
import { focusManager } from './focus';
import { sound } from './sound';
import { useConsoleStore } from './core/store';
import { lazy, Suspense } from 'react';
import { HomeScreen } from './home/HomeScreen';
import { ChannelBoundary } from './core/ChannelBoundary';

/**
 * Channels load lazily and behind an error boundary. Eager imports meant a
 * single broken channel module took the whole shell down — unacceptable on a
 * device whose job is to always return you Home.
 */
const GamesRoom = lazy(() => import('./games/GamesRoom').then((m) => ({ default: m.GamesRoom })));
const MoviesChannel = lazy(() =>
  import('./movies/MoviesChannel').then((m) => ({ default: m.MoviesChannel })),
);
const SettingsRoom = lazy(() =>
  import('./settings/SettingsRoom').then((m) => ({ default: m.SettingsRoom })),
);
const WeatherChannel = lazy(() =>
  import('./weather/WeatherChannel').then((m) => ({ default: m.WeatherChannel })),
);
const NewsChannel = lazy(() =>
  import('./news/NewsChannel').then((m) => ({ default: m.NewsChannel })),
);
const SituationChannel = lazy(() =>
  import('./situation/SituationChannel').then((m) => ({ default: m.SituationChannel })),
);

/** Every in-shell room renders through the same guarded, suspended frame. */
function Room({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <ChannelBoundary name={name}>
      <Suspense fallback={null}>{children}</Suspense>
    </ChannelBoundary>
  );
}
import { AppSim } from './appsim/AppSim';
import { HomeShelf } from './overlay/HomeShelf';
import { ControllersOverlay } from './controllers/ControllersOverlay';
import { RemapRoom } from './remap/RemapRoom';

/**
 * Top-level wiring. Owned by the integrator — workers import their modules
 * here only via the contracts in CONTRACTS.md.
 *
 * Input priority (top wins): remap room → controllers overlay → shelf →
 * current view ('games' room or the wall) → running app (which only listens
 * for Home/X). While `remapListening` is set, the remap room is capturing a
 * raw button press itself, so ALL semantic input is ignored here.
 */
export default function App() {
  const mode = useConsoleStore((s) => s.mode);
  const view = useConsoleStore((s) => s.view);
  const shelfOpen = useConsoleStore((s) => s.shelfOpen);
  const controllersOpen = useConsoleStore((s) => s.controllersOpen);
  const remapPlatform = useConsoleStore((s) => s.remapPlatform);

  useEffect(() => {
    const scope = remapPlatform
      ? 'remap'
      : controllersOpen
        ? 'controllers'
        : shelfOpen
          ? 'shelf'
          : mode === 'home'
            ? view === 'wall'
              ? 'home'
              : view // each in-shell room is its own focus scope
            : 'none';
    focusManager.setScope(scope);
  }, [mode, view, shelfOpen, controllersOpen, remapPlatform]);

  useEffect(() => startCursorIdle(), []);

  useEffect(() => {
    const handleConsoleInput = (e: ConsoleInput) => {
      sound.init(); // no-op after first call; needs a user gesture to unlock
      const st = useConsoleStore.getState();

      if (st.remapListening) return; // remap room owns the raw next press

      // X — Controllers overlay, from anywhere (Wii Home spirit). Inside the
      // remap room X is ignored (you're already under the controllers stack).
      if (e.type === 'menu') {
        if (st.remapPlatform) return;
        if (st.controllersOpen) {
          st.closeControllers();
          sound.play('shelfClose');
        } else {
          st.openControllers();
          sound.play('shelfOpen');
        }
        return;
      }

      if (e.type === 'home') {
        // Home never fights the overlay stack; it only matters in an app.
        if (st.controllersOpen || st.remapPlatform) return;
        if (st.mode === 'app') {
          if (st.shelfOpen) {
            st.closeShelf();
            sound.play('shelfClose');
          } else {
            st.openShelf();
            sound.play('shelfOpen');
          }
        }
        return;
      }

      if (e.type === 'back') {
        if (st.remapPlatform) {
          st.closeRemap();
          sound.play('back');
        } else if (st.controllersOpen) {
          st.closeControllers();
          sound.play('shelfClose');
        } else if (st.shelfOpen) {
          st.closeShelf();
          sound.play('shelfClose');
        } else if (st.mode === 'home' && st.view === 'news' && st.newsReading) {
          // Reader → headline view, not out of the channel.
          st.setNewsReading(false);
          sound.play('back');
        } else if (st.mode === 'home' && st.view === 'games' && st.gamesLevel === 'grid') {
          // Wii U grid → back up to the console row, not out of the room.
          st.setGamesLevel('consoles');
          sound.play('back');
        } else if (st.mode === 'home' && st.view !== 'wall') {
          st.closeView();
          sound.play('back');
        } else {
          sound.play('back');
        }
        return;
      }

      // nav / accept — only when something focusable is on screen.
      const inApp = st.mode === 'app' && !st.shelfOpen && !st.controllersOpen && !st.remapPlatform;
      if (inApp) return;

      switch (e.type) {
        case 'nav': {
          const moved = focusManager.move(e.dir);
          sound.play(moved ? 'tick' : 'edge');
          break;
        }
        case 'accept':
          focusManager.accept();
          break;
      }
    };

    // The phone is just another controller: both sources feed one handler.
    const stopLocal = startInput(handleConsoleInput);
    const stopLink = startTvLink(handleConsoleInput);
    return () => {
      stopLocal();
      stopLink();
    };
  }, []);

  return (
    <div className="console-root">
      {mode === 'home' && view === 'wall' && <HomeScreen />}
      {mode === 'home' && view === 'games' && (
        <Room name="Games"><GamesRoom /></Room>
      )}
      {mode === 'home' && view === 'movies' && (
        <Room name="Movies & TV"><MoviesChannel /></Room>
      )}
      {mode === 'home' && view === 'settings' && (
        <Room name="Settings"><SettingsRoom /></Room>
      )}
      {mode === 'home' && view === 'weather' && (
        <Room name="Weather"><WeatherChannel /></Room>
      )}
      {mode === 'home' && view === 'news' && (
        <Room name="News"><NewsChannel /></Room>
      )}
      {mode === 'home' && view === 'situation' && (
        <Room name="Situation"><SituationChannel /></Room>
      )}
      {mode === 'app' && <AppSim />}
      {shelfOpen && <HomeShelf />}
      {controllersOpen && !remapPlatform && <ControllersOverlay />}
      {remapPlatform && <RemapRoom platformId={remapPlatform} />}
    </div>
  );
}
