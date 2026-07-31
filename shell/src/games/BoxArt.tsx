import { useCallback, useEffect, useRef } from 'react';
import type { ConsoleEntry } from '../core/consoles';
import { useFocusable } from '../focus';
import { Glyph, StarIcon } from '../icons';
import { coverArt } from './coverArt';
import { cssVars, prefersReducedMotion } from './util';
import './BoxArt.css';

interface BoxArtProps {
  /** Focus id — `game-<index>` per the contract. */
  id: string;
  title: string;
  /** Selected console: supplies the accent, the glyph, and the art seed. */
  platform: ConsoleEntry;
  /**
   * Real scraped cover from the imported library (`/art/<system>/<slug>.png`).
   * When present it replaces the generated gradient entirely; the generated
   * art remains the fallback for titles the scrape missed.
   */
  art?: string | null;
  /** Draw the user's star over the cover without disturbing its art. */
  favorite?: boolean;
  /** Scraped rating (0–1) to overlay, or null to hide. */
  rating?: number | null;
  /** Accept opens this game's console detail page. */
  onAccept: () => void;
  /** First box takes focus when you drill into a console's library. */
  autoFocus?: boolean;
}

/**
 * One fake box on the shelf.
 *
 * The focusable element *is* the cover (not a wrapper), for two reasons: the
 * focus ring should hug the artwork, and `playLaunch` measures the element it
 * is handed — so the launch grows out of the box face exactly, the same way a
 * channel tile does on the wall.
 */
export function BoxArt({
  id,
  title,
  platform,
  art: cover,
  favorite = false,
  rating = null,
  onAccept,
  autoFocus,
}: BoxArtProps) {
  const elRef = useRef<HTMLDivElement | null>(null);

  // The focus engine holds the callback it was registered with, so hand it a
  // stable one that reads current props out of a ref.
  const latest = useRef({ onAccept });
  useEffect(() => {
    latest.current = { onAccept };
  });

  const accept = useCallback(() => {
    const el = elRef.current;
    if (el) latest.current.onAccept();
  }, []);

  const { ref: focusRef, focused } = useFocusable({
    id,
    scope: 'games',
    onAccept: accept,
    autoFocus,
  });

  // Compose the engine's callback ref with our own bookkeeping. Depending on
  // `focusRef` is deliberate: a new callback makes React detach with null and
  // re-attach, which re-registers the element.
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      elRef.current = el;
      focusRef(el);
    },
    [focusRef],
  );

  // Keep the focused box inside the (vertically scrolling) shelf.
  useEffect(() => {
    if (!focused) return;
    elRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [focused]);

  const art = coverArt(platform.id, title);

  return (
    <div
      ref={setRef}
      className="boxart"
      data-focused={focused ? 'true' : undefined}
      data-real-art={cover ? 'true' : undefined}
      role="button"
      aria-label={`${title} — ${platform.name}`}
      style={cssVars({
        '--accent': platform.accent,
        '--cover-hue': art.hue,
        '--cover-angle': art.angle,
        '--cover-hx': art.highlightX,
        '--cover-hy': art.highlightY,
        '--cover-lift': art.lift,
        '--cover-sat': art.saturation,
        '--cover-sheen': art.sheen,
        '--cover-title': art.titleSize,
      })}
    >
      {/* The face clips the art; the ring on `.boxart::after` sits outside it. */}
      <div className="boxart-face">
        {cover ? (
          <img className="boxart-photo" src={cover} alt="" loading="lazy" decoding="async" />
        ) : (
          <>
            <div className="boxart-art" />
            <div className="boxart-motif" data-motif={art.motif} />
          </>
        )}
        <div className="boxart-sheen" />
        <div className="boxart-spine" />

        {favorite && (
          <span className='boxart-favorite' aria-hidden='true'>
            <StarIcon />
          </span>
        )}

        {rating !== null && rating > 0 && (
          <span className="boxart-rating" aria-hidden="true">
            <span className="boxart-rating-star"><StarIcon /></span>
            {(rating * 10).toFixed(1)}
          </span>
        )}

        {/*
          `tile-glyph` is not decoration here: motion/transitions.ts paints the
          launch cover by reading `.tile-glyph`'s markup out of the element it
          is given, so tagging the console glyph with that class is what makes
          the console mark bloom to fullscreen on launch instead of a bare
          gradient. BoxArt.css re-states every visual property Tile.css sets on
          that class, so the shared hook can't drag the wall's 8.5rem sizing in
          here.
        */}
        <span className="boxart-glyph tile-glyph" aria-hidden="true">
          <Glyph id={platform.id} fallback={platform.glyph} />
        </span>

        <div className="boxart-plate">
          <span className="boxart-band" />
          <span className="boxart-title">{title}</span>
        </div>

        <div className="boxart-rim" />
      </div>
    </div>
  );
}
