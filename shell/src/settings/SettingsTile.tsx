import { useCallback, useEffect, useRef } from 'react';
import { useFocusable } from '../focus';
import { Glyph } from '../icons';
import type { SettingsTileDef } from './tiles';
import { cssVars } from './util';
import './SettingsTile.css';

interface SettingsTileProps {
  tile: SettingsTileDef;
  accent: string;
  onAccept: (tile: SettingsTileDef) => void;
  autoFocus?: boolean;
}

/**
 * A setting tile: the Home wall's squircle-face-plus-glyph language
 * (home/Tile.css) applied to the Settings room, all sharing the room's
 * single slate-teal accent rather than a per-item color (CONTRACTS.md
 * Round 3.5 — "a single horizontal row of big setting tiles ... slate-teal
 * accent"). Structurally a sibling of home/Tile.tsx and games/ConsoleTile.tsx:
 * the focusable element is the face, the label lives below it, and only the
 * focused tile announces itself.
 */
export function SettingsTile({ tile, accent, onAccept, autoFocus }: SettingsTileProps) {
  const latest = useRef({ tile, onAccept });
  useEffect(() => {
    latest.current = { tile, onAccept };
  });
  const accept = useCallback(() => latest.current.onAccept(latest.current.tile), []);

  const { ref: focusRef, focused } = useFocusable({
    id: `settings-tile-${tile.id}`,
    scope: 'settings',
    onAccept: accept,
    autoFocus,
  });

  return (
    <div className="stile-slot">
      <div
        ref={focusRef}
        className="stile"
        data-focused={focused ? 'true' : undefined}
        role="button"
        aria-label={`${tile.title} — ${tile.blurb}`}
        style={cssVars({ '--accent': accent })}
      >
        <div className="stile-face">
          <div className="stile-sheen" />
          <div className="stile-body">
            <span className="stile-glyph">
              <Glyph id={tile.id} fallback={tile.glyph} />
            </span>
          </div>
          <div className="stile-rim" />
        </div>
      </div>
      <div className={`stile-label${focused ? ' is-focused' : ''}`}>{tile.title}</div>
      <div className={`stile-blurb${focused ? ' is-focused' : ''}`}>{tile.blurb}</div>
    </div>
  );
}
