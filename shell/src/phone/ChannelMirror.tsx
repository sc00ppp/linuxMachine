/**
 * The mirror: the TV's channel row, in your hand (DESIGN.md §5).
 *
 * The TV stays authoritative — this component never keeps its own selection.
 * It renders whatever the last `state` snapshot said and, when you tap a tile,
 * it *drives the TV's focus there* by sending the same semantic nav events a
 * d-pad would produce, one step per tile. That is why the lantern still glides
 * across the wall instead of teleporting: the TV is genuinely being navigated.
 *
 * Tap the already-focused tile to accept it — tap-to-focus, tap-again-to-open.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ConsoleInput, MirroredChannel } from './types';
import { haptic } from './press';
import './ChannelMirror.css';

/** Gap between synthesised nav steps. Long enough for the TV's ~200 ms focus
 *  move to read as travel, short enough that a 4-tile jump still feels instant. */
const NAV_STEP_MS = 55;

export interface ChannelMirrorProps {
  channels: MirroredChannel[];
  focusedId: string | null;
  /** False when the TV's focus is not on the wall (app running, games room, shelf). */
  steerable: boolean;
  runningChannel: string | null;
  sendInput: (event: ConsoleInput) => void;
}

export default function ChannelMirror({
  channels,
  focusedId,
  steerable,
  runningChannel,
  sendInput,
}: ChannelMirrorProps) {
  const tiles = useRef(new Map<string, HTMLElement>());
  const timers = useRef<number[]>([]);
  const [pressedId, setPressedId] = useState<string | null>(null);
  /** Bumps to replay the "can't steer from here" hint animation. */
  const [nudge, setNudge] = useState(0);

  const focusedIndex = channels.findIndex((c) => c.id === focusedId);

  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Follow the TV: whatever it focused (by pad, by remote, or by our own taps)
  // is scrolled into the middle of the row.
  useEffect(() => {
    if (!focusedId) return;
    const el = tiles.current.get(focusedId);
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }, [focusedId]);

  const tap = useCallback(
    (index: number) => {
      if (!steerable) {
        // The TV is inside an app or another room; nav events would go nowhere.
        // Say so instead of pretending the tap worked.
        haptic(20);
        setNudge((n) => n + 1);
        return;
      }

      haptic(8);
      clearTimers();

      if (index === focusedIndex) {
        sendInput({ type: 'accept' });
        return;
      }

      if (focusedIndex < 0) {
        // Focus is on the wall but on something we don't mirror — nudge once in
        // the right direction rather than guessing a whole path.
        sendInput({ type: 'nav', dir: index === 0 ? 'left' : 'right' });
        return;
      }

      const delta = index - focusedIndex;
      const dir = delta > 0 ? 'right' : 'left';
      for (let step = 0; step < Math.abs(delta); step += 1) {
        timers.current.push(
          window.setTimeout(() => sendInput({ type: 'nav', dir }), step * NAV_STEP_MS),
        );
      }
    },
    [clearTimers, focusedIndex, sendInput, steerable],
  );

  if (channels.length === 0) {
    // No snapshot yet: empty sockets, same language as the TV's "coming soon"
    // slots, so a booting phone looks intentional rather than broken.
    return (
      <section className="mirror" aria-label="Channels">
        <div className="mirror-row mirror-row--ghost">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mirror-socket" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="mirror" aria-label="Channels">
      <div className="mirror-row" data-steerable={steerable ? 'true' : 'false'}>
        {channels.map((channel, index) => {
          const focused = channel.id === focusedId;
          return (
            <button
              key={channel.id}
              type="button"
              ref={(el) => {
                if (el) tiles.current.set(channel.id, el);
                else tiles.current.delete(channel.id);
              }}
              className="mirror-tile"
              style={
                channel.accent
                  ? ({ '--accent': channel.accent } as CSSProperties)
                  : undefined
              }
              data-focused={focused ? 'true' : 'false'}
              data-playing={channel.id === runningChannel ? 'true' : 'false'}
              data-pressed={pressedId === channel.id ? 'true' : 'false'}
              aria-current={focused ? 'true' : undefined}
              aria-label={
                focused ? `${channel.title}, selected — tap to open` : channel.title
              }
              // Tiles activate on tap-release, not press-down: the row scrolls
              // horizontally, and a finger that starts a swipe on a tile must
              // not fire it. (The pad buttons below, which never scroll, do
              // fire on press-down.)
              onPointerDown={() => setPressedId(channel.id)}
              onPointerUp={() => setPressedId(null)}
              onPointerCancel={() => setPressedId(null)}
              onClick={() => tap(index)}
            >
              <span className="mirror-face">
                <span className="mirror-glyph">{channel.glyph}</span>
                <span className="mirror-rim" />
              </span>
              <span className="mirror-label">{channel.title}</span>
            </button>
          );
        })}
      </div>

      {!steerable && (
        <p key={nudge} className="mirror-hint" role="status">
          The TV is busy elsewhere — press ⌂ to come back to the wall.
        </p>
      )}
    </section>
  );
}
