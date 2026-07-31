import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CHANNELS, TRAILING_SOCKETS, channelById } from '../core/channels';
import { useConsoleStore } from '../core/store';
import { useUserLibrary, type PinnedGame } from '../core/userLibrary';
import type { Channel } from '../core/types';
import { tuning } from '../motion/tuning';
import { playLaunch, playReturn } from '../motion/transitions';
import { sound } from '../sound';
import { FocusGlow } from './FocusGlow';
import { HintBar } from './HintBar';
import { EmptySocket, Tile } from './Tile';
import { TopBar } from './TopBar';
import { cssVars, prefersReducedMotion } from './util';
import './HomeScreen.css';

/** Chrome dims to a whisper after this long without input (DESIGN.md §2). */
const IDLE_MS = 5000;

/** The row: every channel in slot order, then whatever the user pinned. */
const CHANNEL_ROW: Channel[] = [...CHANNELS].sort((a, b) => a.slot - b.slot);

/** Marks a tile as a pinned game rather than a channel. */
const PIN_PREFIX = 'pin:';

/**
 * A pinned game becomes a real tile on the wall (DESIGN.md §11d) — the whole
 * point of pinning is that the game is one press from Home, so it has to live
 * in the same row and speak the same interaction language as a channel.
 *
 * Accent and glyph are read off the pin record rather than the console library,
 * so the wall never waits on a library chunk to paint.
 */
function pinChannel(pin: PinnedGame, slot: number): Channel {
  return {
    id: `${PIN_PREFIX}${pin.id}`,
    title: pin.title,
    accent: pin.accent || '#f0655a',
    glyph: pin.glyph || '🎮',
    art: pin.art,
    slot,
  };
}

/**
 * A small "no" nudge for a tile that can't be opened.
 *
 * Shakes the *face* rather than the tile root on purpose: the root carries the
 * focus `scale(1.08)` as a CSS transform, and a WAAPI transform animation
 * replaces it, which would make the tile pop down to 1.0 mid-shake.
 */
function shakeTile(tileEl: HTMLElement): void {
  if (prefersReducedMotion()) return;
  const face = tileEl.querySelector<HTMLElement>('.tile-face') ?? tileEl;
  face.animate(
    [0, -0.4, 0.32, -0.2, 0.1, 0].map((dx) => ({
      transform: `translateX(${dx}rem)`,
    })),
    { duration: tuning.focusMoveMs * 2, easing: tuning.popEase },
  );
}

/**
 * The channel wall (DESIGN.md §2–3).
 *
 * Owns three coupled pieces of state:
 *  - `focusedId`   — mirrored up from the tiles; drives the glow and the strip.
 *  - `awake`       — chrome visibility; any focus move or input wakes it.
 *  - `glow`        — measured centre of the focused tile, in stage coordinates.
 */
export function HomeScreen() {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [awake, setAwake] = useState(true);
  const [glow, setGlow] = useState({ x: 0, y: 0 });

  // Pinning re-renders the wall through userLibrary's external store, so a game
  // pinned from its detail page is already on the row when you back out.
  const pins = useUserLibrary().pins;
  const row = useMemo(
    () => [
      ...CHANNEL_ROW,
      ...pins.map((pin, i) => pinChannel(pin, CHANNEL_ROW.length + i)),
    ],
    [pins],
  );
  // Sockets are an invitation to pin something; they shouldn't keep extending
  // the row once the user has taken it up.
  const sockets = Math.max(0, TRAILING_SOCKETS - pins.length);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  /** id → tile element. Populated by refs, so it's ready before effects run. */
  const tileEls = useRef(new Map<string, HTMLElement>());
  /** Blocks a second accept while a launch transition is in flight. */
  const busy = useRef(false);
  /** Guards the mount-time return choreography against a double effect run. */
  const returnStarted = useRef(false);
  const idleTimer = useRef(0);

  const registerEl = useCallback((id: string, el: HTMLElement | null) => {
    if (el) tileEls.current.set(id, el);
    else tileEls.current.delete(id);
  }, []);

  // --- chrome idle/wake ----------------------------------------------------

  const wake = useCallback(() => {
    setAwake(true); // React bails out when it's already true
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setAwake(false), IDLE_MS);
  }, []);

  useEffect(() => {
    wake();
    // Focus moves wake the chrome via `focusedId`, but a mouse nudge or a key
    // that didn't move focus (an edge bump) should wake it too.
    window.addEventListener('keydown', wake);
    window.addEventListener('pointermove', wake);
    return () => {
      window.clearTimeout(idleTimer.current);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('pointermove', wake);
    };
  }, [wake]);

  // --- focus-driven side effects -------------------------------------------

  const onTileFocus = useCallback((id: string) => setFocusedId(id), []);

  useEffect(() => {
    if (focusedId) wake();
  }, [focusedId, wake]);

  /**
   * Measure the focused tile's centre relative to the glow layer. The tile's
   * focus scale is centre-origin, so the centre is transform-invariant and we
   * can measure at any point during the scale transition.
   */
  const measureGlow = useCallback(() => {
    const stage = stageRef.current;
    const el = focusedId ? tileEls.current.get(focusedId) : null;
    if (!stage || !el) return;
    const s = stage.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    setGlow({ x: t.left + t.width / 2 - s.left, y: t.top + t.height / 2 - s.top });
  }, [focusedId]);

  useLayoutEffect(() => {
    // One frame of slack: on the very first paint the row may not be laid out.
    const raf = requestAnimationFrame(measureGlow);
    measureGlow();
    window.addEventListener('resize', measureGlow);

    // A resize listener alone isn't enough: the webfont landing, or the user
    // changing --ui-scale, reflows the wall without any window resize. Watching
    // the stage and the row covers both.
    const ro = new ResizeObserver(measureGlow);
    if (stageRef.current) ro.observe(stageRef.current);
    if (rowRef.current) ro.observe(rowRef.current);

    // The row scrolls under the lantern; smooth scrolling emits a stream of
    // scroll events, so re-measuring on each keeps the light on the tile the
    // whole ride rather than teleporting at the end.
    const scroller = scrollerRef.current;
    scroller?.addEventListener('scroll', measureGlow, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measureGlow);
      scroller?.removeEventListener('scroll', measureGlow);
      ro.disconnect();
    };
  }, [measureGlow]);

  // --- scroll-follow -------------------------------------------------------

  // Switch-style edge scrolling: the row stays put while focus roams the
  // middle, and glides only when focus pushes into the margins
  // (scroll-padding-inline on the scroller defines "the margins").
  useEffect(() => {
    if (!focusedId) return;
    const el = tileEls.current.get(focusedId);
    el?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      inline: 'nearest',
      block: 'nearest',
    });
  }, [focusedId]);

  // --- launch --------------------------------------------------------------

  const handleAccept = useCallback(async (channel: Channel, el: HTMLElement) => {
    if (busy.current) return;

    // Continue with nothing to resume: refuse, but warmly.
    if (channel.emptyHint) {
      sound.play('edge');
      shakeTile(el);
      return;
    }

    // Channels carrying a `view` open an in-shell room (Games, Settings,
    // Weather, News, Situation) rather than an external app — but they get
    // the SAME tile-zoom launch choreography. Rooms previously only drilled
    // in, so the real channels felt cheaper to open than the placeholder
    // ones, which is exactly backwards.
    if (channel.view) {
      busy.current = true;
      sound.play('launch');
      sound.duck(true);
      const view = channel.view;
      try {
        await playLaunch(el, channel.accent);
      } finally {
        useConsoleStore.getState().openView(view);
        busy.current = false;
      }
      return;
    }

    // A pinned game launches straight from the wall — that is what pinning is
    // for. Same choreography as pressing Play on its detail page.
    if (channel.id.startsWith(PIN_PREFIX)) {
      busy.current = true;
      sound.play('launch');
      sound.duck(true);
      try {
        await playLaunch(el, channel.accent);
      } finally {
        useConsoleStore.getState().launchApp('games', channel.title);
      }
      return;
    }

    busy.current = true;
    sound.play('launch');
    // Stay ducked past the transition — the app owns the audio bed from here;
    // the return flow un-ducks when we land back on the wall.
    sound.duck(true);
    try {
      await playLaunch(el, channel.accent);
    } finally {
      // Even if the choreography fails we must not strand the user on Home
      // with a half-collapsed screen.
      useConsoleStore.getState().launchApp(channel.id);
    }
  }, []);

  // --- return --------------------------------------------------------------

  // Layout effect: playReturn jump-collapses the chrome synchronously, and that
  // must happen before the remounted Home ever paints — a plain effect lets one
  // frame of un-collapsed chrome flash under the incoming cover.
  useLayoutEffect(() => {
    // Idempotent: StrictMode (or a future remount) must not fire the homecoming
    // choreography twice.
    if (returnStarted.current) return;
    returnStarted.current = true;

    const { returningChannel, finishReturn } = useConsoleStore.getState();
    if (!returningChannel) return;

    const channel = channelById(returningChannel);
    const el = tileEls.current.get(returningChannel);
    if (!channel || !el) {
      // Nothing to shrink into (channel removed?) — don't wedge the store.
      finishReturn();
      return;
    }

    // The freshly-mounted scroller starts at 0; if the homecoming tile lives
    // off-screen right, snap it into view NOW (instant, pre-paint) so the
    // shrink flies at the tile's real resting rect. The smooth scroll-follow
    // effect would otherwise drag the tile out from under the animation.
    el.scrollIntoView({ behavior: 'auto', inline: 'nearest', block: 'nearest' });

    let cancelled = false;
    void (async () => {
      sound.play('homecoming');
      try {
        await playReturn(el, channel.accent);
      } finally {
        sound.duck(false);
        if (!cancelled) useConsoleStore.getState().finishReturn();
      }
    })();

    return () => {
      cancelled = true;
    };
    // Mount-only: `returningChannel` is read imperatively so a store update
    // mid-transition can't restart the choreography.
  }, []);

  // --- ambient -------------------------------------------------------------

  // Ambient bed removed by request (2026-07-30) — the wall sits in silence,
  // only interaction sounds speak. `sound.startAmbient()` still exists if a
  // (quieter) bed ever comes back as a settings toggle.

  // Look up in `row`, not CHANNELS — a focused pin has no channel record, and
  // falling through to null would drop the wall's lantern on pinned tiles.
  const focusedChannel = focusedId
    ? (row.find((c) => c.id === focusedId) ?? null)
    : null;

  return (
    <div
      className="home"
      data-awake={awake ? 'true' : 'false'}
      style={cssVars({
        // Motion constants live in tuning.ts; CSS reads them from here so the
        // micro-interactions stay in step with the choreographed transitions.
        '--focus-ms': `${tuning.focusMoveMs}ms`,
        '--focus-ease': tuning.focusEase,
        '--glow-ms': `${Math.round(tuning.focusMoveMs * 1.9)}ms`,
        '--glow-halo-ms': `${Math.round(tuning.focusMoveMs * 3.2)}ms`,
        '--glow-tint-ms': `${Math.round(tuning.focusMoveMs * 2.4)}ms`,
        '--settle-ms': `${tuning.settleFadeMs}ms`,
      })}
    >
      <TopBar />

      <main className="home-stage" ref={stageRef}>
        <FocusGlow
          accent={focusedChannel?.accent ?? 'transparent'}
          x={glow.x}
          y={glow.y}
          active={focusedChannel !== null}
        />

        <div className="home-scroller" data-collapse="fade" ref={scrollerRef}>
          <div className="home-row" ref={rowRef}>
            {row.map((channel, i) => (
              <Tile
                key={channel.id}
                channel={channel}
                onFocus={onTileFocus}
                onAccept={handleAccept}
                registerEl={registerEl}
                autoFocus={i === 0}
              />
            ))}
            {Array.from({ length: sockets }, (_, i) => (
              <EmptySocket key={`socket-${i}`} />
            ))}
          </div>
        </div>

      </main>

      <HintBar />
    </div>
  );
}
