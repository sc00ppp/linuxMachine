import { useCallback, useEffect, useRef } from 'react';
import type { Channel } from '../core/types';
import { useFocusable } from '../focus';
import { Glyph } from '../icons';
import { cssVars } from './util';
import './Tile.css';

interface TileProps {
  channel: Channel;
  /** Fires when this tile becomes the focused element (drives glow + context strip). */
  onFocus: (id: string) => void;
  /** Accept pressed. Receives the tile element so Home can hand it to playLaunch. */
  onAccept: (channel: Channel, el: HTMLElement) => void;
  /** Publishes the tile element to Home's registry (used by the return transition). */
  registerEl: (id: string, el: HTMLElement | null) => void;
  /** First tile of the wall takes focus when the scope activates with no memory. */
  autoFocus?: boolean;
}

/**
 * A channel tile: 16:10 squircle face with the label *below* it (DESIGN.md §3).
 *
 * Layout note: the focusable element is the face wrapper (`.tile`), not the
 * whole slot. That keeps the scale-up from pushing the label around, and gives
 * `playLaunch` a clean rect to clone — the label is chrome, not part of the app.
 */
export function Tile({ channel, onFocus, onAccept, registerEl, autoFocus }: TileProps) {
  const elRef = useRef<HTMLDivElement | null>(null);

  // The focus engine may hold onto the `onAccept` it was registered with, so
  // hand it a stable callback that reads the current props out of a ref.
  const latest = useRef({ channel, onAccept });
  useEffect(() => {
    latest.current = { channel, onAccept };
  });

  const accept = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    latest.current.onAccept(latest.current.channel, el);
  }, []);

  const { ref: focusRef, focused } = useFocusable({
    id: channel.id,
    scope: 'home',
    onAccept: accept,
    autoFocus,
  });

  // Compose the focus engine's callback ref with our own bookkeeping. Depending
  // on `focusRef` is deliberate: if the engine hands us a new callback, React
  // detaches with null and re-attaches, which re-registers the element.
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      elRef.current = el;
      registerEl(channel.id, el);
      focusRef(el);
    },
    [focusRef, registerEl, channel.id],
  );

  useEffect(() => {
    if (focused) onFocus(channel.id);
  }, [focused, channel.id, onFocus]);

  // Continue with nothing to resume gets the friendly "nothing yet" face
  // instead of art (DESIGN.md §10).
  const isEmpty = Boolean(channel.emptyHint);

  return (
    <div className="tile-slot">
      <div
        ref={setRef}
        className={`tile${isEmpty ? ' tile--empty' : ''}`}
        data-focused={focused ? 'true' : undefined}
        style={cssVars({ '--accent': channel.accent })}
        role="button"
        aria-label={channel.title}
      >
        <div className="tile-face">
          {channel.art && (
            <img
              className="tile-art"
              src={channel.art}
              alt=""
              onError={(event) => {
                // A pinned game whose art moved falls back to the glyph face
                // rather than showing a broken image on the wall.
                event.currentTarget.hidden = true;
              }}
            />
          )}
          <div className="tile-sheen" />
          <div className="tile-body">
            <span className="tile-glyph">
              <Glyph id={channel.iconId ?? channel.id} fallback={channel.glyph} />
            </span>
            {isEmpty && <span className="tile-emptyhint">{channel.emptyHint}</span>}
          </div>
          <div className="tile-rim" />
        </div>
      </div>
      <div className={`tile-label${focused ? ' is-focused' : ''}`}>{channel.title}</div>
    </div>
  );
}

/**
 * An unfilled slot. Wii-style dashed socket: reads as an invitation rather than
 * a hole. Never focusable and never announced — there is nothing here yet.
 */
export function EmptySocket() {
  return (
    <div className="tile-slot tile-slot--socket" aria-hidden="true">
      <div className="tile-socket">
        <span className="tile-socket-mark">+</span>
      </div>
      {/* Keeps socket rows the same height as labelled rows. */}
      <div className="tile-label tile-label--placeholder">&nbsp;</div>
    </div>
  );
}
