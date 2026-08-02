import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConsoleEntry as Platform } from '../core/consoles';
import { useFocusable } from '../focus';
import { ConsoleArt } from './consoleArt';
import { cssVars, prefersReducedMotion } from './util';
import './ConsoleTile.css';
import { glideIntoView } from '../motion/glide';

interface ConsoleTileProps {
  platform: Platform;
  /** Fires when this tile becomes the focused element (drives room lighting). */
  onFocus: (platformId: string) => void;
  /** Accept — drill into this console's library. */
  onOpen: (platformId: string) => void;
  /** Takes focus when the scope activates with no usable memory. */
  autoFocus?: boolean;
}

/**
 * One machine on the shelf (DESIGN.md §11, level 1).
 *
 * Structurally a sibling of the wall's channel tile (home/Tile.tsx): the
 * focusable element is the face, the label lives *below* it and only the
 * focused tile announces itself. The face carries an SVG illustration of the
 * real hardware instead of a glyph — that illustration is drawn by
 * `consoleArt.tsx` and themed entirely through CSS custom properties, so a
 * console is "its own machine in its own colour" with no per-platform code
 * here.
 */
export function ConsoleTile({ platform, onFocus, onOpen, autoFocus }: ConsoleTileProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const [realArtFailed, setRealArtFailed] = useState(false);

  useEffect(() => {
    setRealArtFailed(false);
  }, [platform.id]);

  // The focus engine holds the callback it was registered with; give it a
  // stable one that reads current props from a ref.
  const latest = useRef({ onOpen });
  useEffect(() => {
    latest.current = { onOpen };
  });
  const accept = useCallback(() => latest.current.onOpen(platform.id), [platform.id]);

  const { ref: focusRef, focused } = useFocusable({
    id: `console-${platform.id}`,
    scope: 'games',
    onAccept: accept,
    autoFocus,
  });

  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      elRef.current = el;
      focusRef(el);
    },
    [focusRef],
  );

  useEffect(() => {
    if (!focused) return;
    onFocus(platform.id);
    // Switch-style edge scrolling: the row only glides once focus pushes into
    // the scroller's side margins (`scroll-padding-inline` defines them).
    glideIntoView(elRef.current, { block: 'nearest', inline: 'nearest' });
  }, [focused, platform.id, onFocus]);

  return (
    <div className="ctile-slot">
      <div
        ref={setRef}
        className="ctile"
        data-focused={focused ? 'true' : undefined}
        role="button"
        aria-label={platform.name}
        style={cssVars({
          '--accent': platform.accent,
          // The illustration's plastic, tinted toward this machine's colour so
          // the row reads as thirteen different consoles rather than thirteen
          // recolours of one. Both are token-derived — no raw palette here.
          '--console-body': `color-mix(in srgb, var(--text) 86%, ${platform.accent})`,
          '--console-dark': `color-mix(in srgb, var(--bg-0) 76%, ${platform.accent})`,
        })}
      >
        <div className="ctile-face">
          <div className="ctile-sheen" />
          <div className="ctile-stage">
            <div className="ctile-artwrap">
              <div className="ctile-shadow" />
              {realArtFailed ? (
                <ConsoleArt id={platform.id} className="ctile-art" />
              ) : (
                <img
                  className="ctile-art ctile-art-real"
                  src={'/console-art/' + encodeURIComponent(platform.id) + '.png'}
                  alt=""
                  aria-hidden="true"
                  onError={() => setRealArtFailed(true)}
                />
              )}
            </div>
          </div>
          <div className="ctile-rim" />
        </div>
      </div>
      <div className={`ctile-label${focused ? ' is-focused' : ''}`}>{platform.name}</div>
    </div>
  );
}
