/**
 * Launch / return choreography — the console's signature "shared element"
 * moment (DESIGN.md §3, §6). A tile visually grows to fill the screen when
 * you launch an app; coming home reverses the exact motion, shrinking back
 * into the same tile. Everything here is vanilla DOM + WAAPI (`el.animate`)
 * so it works independently of whatever React tree is mounted above/below
 * it — the overlay is appended straight to `document.body`, which is what
 * lets it survive HomeScreen unmounting/remounting mid-flight.
 *
 * All timings/easings come from `tuning.ts` — nothing here is hand-tuned,
 * it's just the choreography wiring.
 *
 * Technique notes (kept in one place since it's non-obvious):
 *  - The moving element (tile clone on launch, accent cover on return) is
 *    always laid out at ITS OWN natural box (left:0; top:0; width/height =
 *    its own size) with `transform-origin: 0 0`, and animated purely via
 *    `transform: translate(...) scale(...)`. Because both keyframes use the
 *    *same* ordered function list (translate then scale), the browser
 *    interpolates translate and scale independently (CSS Transforms
 *    "matching transform lists" behavior) rather than decomposing a single
 *    matrix — so position and size each lerp linearly under the same
 *    easing curve, which is exactly equivalent to (and cheaper than)
 *    animating top/left/width/height directly.
 *  - Home chrome (anything tagged `data-collapse`) is a separate, parallel
 *    animation driven by `collapseChrome`/`restoreChrome` — it doesn't know
 *    or care about the tile zoom, it just measures itself and animates its
 *    own box away/back.
 */
import { tuning } from './tuning';

// ---------------------------------------------------------------------------
// Chrome collapse/restore — reusable, used internally by both transitions.
// ---------------------------------------------------------------------------

type CollapseKind = 'x' | 'y' | 'fade';

/** Snapshot of an element's box just before we started collapsing it. */
interface ChromeOriginal {
  /** Full inline `style` attribute at capture time, so restore can be exact. */
  cssText: string;
  width: number;
  height: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  opacity: number;
}

type StyleProps = Partial<
  Record<'width' | 'height' | 'marginLeft' | 'marginRight' | 'marginTop' | 'marginBottom' | 'opacity', string>
>;

/**
 * Elements we've collapsed, keyed by element, so a later `restoreChrome`
 * (possibly from a different call site) can reverse exactly what we did —
 * and so calling `collapseChrome` twice in a row doesn't re-capture an
 * already-collapsed box as if it were the "original" one.
 */
const chromeOriginals = new WeakMap<HTMLElement, ChromeOriginal>();

function measureOriginal(el: HTMLElement): ChromeOriginal {
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    cssText: el.style.cssText,
    width: rect.width,
    height: rect.height,
    marginLeft: parseFloat(cs.marginLeft) || 0,
    marginRight: parseFloat(cs.marginRight) || 0,
    marginTop: parseFloat(cs.marginTop) || 0,
    marginBottom: parseFloat(cs.marginBottom) || 0,
    opacity: cs.opacity === '' ? 1 : parseFloat(cs.opacity) || 0,
  };
}

function collapsedStyleFor(kind: CollapseKind): StyleProps {
  if (kind === 'x') return { width: '0px', marginLeft: '0px', marginRight: '0px', opacity: '0' };
  if (kind === 'y') return { height: '0px', marginTop: '0px', marginBottom: '0px', opacity: '0' };
  return { opacity: '0' };
}

function naturalStyleFor(kind: CollapseKind, o: ChromeOriginal): StyleProps {
  if (kind === 'x') {
    return { width: `${o.width}px`, marginLeft: `${o.marginLeft}px`, marginRight: `${o.marginRight}px`, opacity: `${o.opacity}` };
  }
  if (kind === 'y') {
    return { height: `${o.height}px`, marginTop: `${o.marginTop}px`, marginBottom: `${o.marginBottom}px`, opacity: `${o.opacity}` };
  }
  return { opacity: `${o.opacity}` };
}

/** Bracket-notation style assignment, kept in one spot behind a narrow cast. */
function applyStyle(el: HTMLElement, styles: StyleProps): void {
  const style = el.style as unknown as Record<string, string>;
  for (const key of Object.keys(styles)) {
    const value = (styles as Record<string, string | undefined>)[key];
    if (value !== undefined) style[key] = value;
  }
}

/**
 * Collapse every `data-collapse="x"|"y"|"fade"` element under `root` away
 * to nothing (width/height/margin/opacity → 0, depending on axis).
 *
 * `animate: false` snaps instantly (used by `playReturn`, which needs
 * chrome already hidden the instant HomeScreen remounts, before first
 * paint). `animate: true` eases it away over `tuning.chromeAwayMs`.
 */
export function collapseChrome(root: ParentNode, animate: boolean): Promise<void> {
  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-collapse]'));
  const finished: Promise<void>[] = [];

  for (const el of els) {
    const kind = el.dataset.collapse as CollapseKind | undefined;
    if (kind !== 'x' && kind !== 'y' && kind !== 'fade') continue;

    let original = chromeOriginals.get(el);
    if (!original) {
      original = measureOriginal(el);
      chromeOriginals.set(el, original);
    }

    // Collapsing x/y clips the shrinking box instead of letting content
    // spill/reflow oddly mid-animation.
    if (!el.style.overflow) el.style.overflow = 'hidden';

    const to = collapsedStyleFor(kind);

    if (!animate) {
      applyStyle(el, to);
      continue;
    }

    const from = naturalStyleFor(kind, original);
    const anim = el.animate([from, to] as Keyframe[], {
      duration: tuning.chromeAwayMs,
      easing: tuning.chromeAwayEase,
      fill: 'forwards',
    });
    finished.push(anim.finished.then(() => {}, () => {}));
  }

  return finished.length ? Promise.all(finished).then(() => {}) : Promise.resolve();
}

/**
 * Reverse of `collapseChrome`: animate (or snap) every previously-collapsed
 * element back to the box it was measured at, then clean up so no inline
 * style override lingers afterward. Elements never collapsed by us (no
 * entry in `chromeOriginals`) are left untouched — nothing to reverse.
 */
export function restoreChrome(root: ParentNode, animate: boolean): Promise<void> {
  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-collapse]'));
  const finished: Promise<void>[] = [];

  for (const el of els) {
    const original = chromeOriginals.get(el);
    if (!original) continue;
    chromeOriginals.delete(el);

    if (!animate) {
      el.style.cssText = original.cssText;
      continue;
    }

    const kind = (el.dataset.collapse as CollapseKind | undefined) ?? 'fade';
    const from = collapsedStyleFor(kind);
    const to = naturalStyleFor(kind, original);

    const anim = el.animate([from, to] as Keyframe[], {
      duration: tuning.chromeBackMs,
      delay: tuning.chromeBackDelayMs,
      easing: tuning.chromeBackEase,
      fill: 'both',
    });

    // Once it lands, drop back to the exact original inline style (so a
    // later resize/rerender isn't fighting a stale WAAPI override), then
    // cancel the (now-redundant) animation. Order matters: set the real
    // style first, *then* cancel, so there's no one-frame revert-to-
    // collapsed flash from removing the animation's composited effect.
    const settle = () => {
      el.style.cssText = original.cssText;
      anim.cancel();
    };
    finished.push(anim.finished.then(settle, settle));
  }

  return finished.length ? Promise.all(finished).then(() => {}) : Promise.resolve();
}

// ---------------------------------------------------------------------------
// Overlay layer plumbing
// ---------------------------------------------------------------------------

/**
 * At most one transition owns the screen at a time. Tracking it as a
 * singleton lets a fresh `playLaunch`/`playReturn` call clean up a stale,
 * still-fading-out layer from an interrupted previous call instead of
 * stacking overlays.
 */
let activeOverlay: HTMLDivElement | null = null;

function createOverlay(): HTMLDivElement {
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }
  const layer = document.createElement('div');
  layer.setAttribute('data-motion-overlay', '');
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '9999',
    overflow: 'hidden',
    pointerEvents: 'none',
  });
  document.body.appendChild(layer);
  activeOverlay = layer;
  return layer;
}

function fadeOutAndRemove(layer: HTMLDivElement, ms = 150): void {
  const done = () => {
    if (activeOverlay === layer) activeOverlay = null;
    layer.remove();
  };
  try {
    const anim = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-out', fill: 'forwards' });
    anim.finished.then(done, done);
  } catch {
    done();
  }
}

/**
 * The moving cover: a FULL-VIEWPORT pane painted like a tile face (accent
 * gradient + centered glyph), which both transitions scale between tile-rect
 * and identity.
 *
 * Why full-viewport: the browser rasterizes an animated element once, at its
 * layout size. The old approach cloned the tile at ~340px and scaled it up
 * ~6× — visibly soft on a TV. Laying the cover out at viewport size means
 * the raster is 1:1 exactly when it fills the screen (the state that
 * lingers as the app fades in); scaled *down* to tile size it merely
 * supersamples. Crisp at both ends.
 */
function buildFaceCover(accent: string, glyph: string, vw: number, vh: number): HTMLDivElement {
  const cover = document.createElement('div');
  Object.assign(cover.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${vw}px`,
    height: `${vh}px`,
    transformOrigin: '0 0',
    display: 'grid',
    placeItems: 'center',
    // Mirrors .tile-face's lighting so takeoff is seamless.
    background: [
      `radial-gradient(130% 105% at 22% 8%, color-mix(in srgb, ${accent} 88%, #f2eee8) 0%, transparent 62%)`,
      `linear-gradient(155deg, color-mix(in srgb, ${accent} 88%, #1e1b26) 0%, color-mix(in srgb, ${accent} 42%, #17151f) 100%)`,
    ].join(', '),
    pointerEvents: 'none',
  });

  if (glyph) {
    const g = document.createElement('span');
    // `glyph` is the tile's own rendered markup (an inline SVG icon from
    // src/icons, or a plain emoji for anything not drawn yet), so the cover
    // repaints exactly what the face showed. Trusted content: it is read
    // straight out of our own React-rendered tile.
    g.innerHTML = glyph;
    Object.assign(g.style, {
      fontSize: '11rem',
      lineHeight: '1',
      color: 'var(--text, #f2eee8)',
      // drop-shadow (not text-shadow) so SVG icons are seated too.
      filter: 'drop-shadow(0 0.5rem 3rem rgba(0, 0, 0, 0.45))',
    });
    cover.appendChild(g);
  }
  return cover;
}

/** The tile's glyph markup (icon SVG or emoji), for painting onto the cover. */
function glyphOf(tileEl: HTMLElement): string {
  const el = tileEl.querySelector('.tile-glyph');
  return el ? el.innerHTML : '';
}

/**
 * The cover scales non-uniformly (square tile ⇄ 16:9 screen), which would
 * squash the glyph at the tile end of the ride. Run an equal-and-opposite
 * scale on the glyph itself, under the same clock, so it stays circular the
 * whole way. `sx`/`sy` are the cover's tile-end scale factors.
 */
function counterScaleGlyph(
  cover: HTMLDivElement,
  sx: number,
  sy: number,
  direction: 'toScreen' | 'toTile',
  timing: KeyframeAnimationOptions,
): void {
  const glyph = cover.firstElementChild as HTMLElement | null;
  if (!glyph) return;
  const squashed = `scale(${sy / sx}, 1)`;
  const frames =
    direction === 'toScreen'
      ? [{ transform: squashed }, { transform: 'scale(1, 1)' }]
      : [{ transform: 'scale(1, 1)' }, { transform: squashed }];
  try {
    glyph.animate(frames, timing);
  } catch {
    /* cosmetic only */
  }
}

/** Tile corner radius in px (uniform-corner assumption is fine here). */
function radiusOf(tileEl: HTMLElement): number {
  return parseFloat(getComputedStyle(tileEl).borderRadius) || 24;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------------------
// playLaunch
// ---------------------------------------------------------------------------

/**
 * Zoom `tileEl` up to cover the screen; resolves when covered.
 *
 * The caller (HomeScreen) is expected to flip app state the moment this
 * resolves — the cover is still opaque and full-screen at that point, so
 * the mode swap (HomeScreen → AppSim) happens invisibly underneath it. We
 * then dissolve the cover on our own clock afterward (not awaited) so the
 * new screen crossfades in once it's had a couple of frames to paint.
 */
export function playLaunch(tileEl: HTMLElement, accent: string): Promise<void> {
  if (prefersReducedMotion()) return quickCoverFade(accent, 'in');

  return new Promise((resolve) => {
    try {
      if (!tileEl.isConnected) {
        resolve();
        return;
      }

      const rect = tileEl.getBoundingClientRect();

      // Chrome retreats on its own clock; we don't wait on it, only on the
      // tile bloom (that's the beat HomeScreen is choreographed around).
      collapseChrome(document, true).catch(() => {});

      // The real tile disappears under the cover almost immediately, so an
      // eased scale-up that transiently underlaps a corner never exposes
      // stale content beneath.
      try {
        tileEl.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: tuning.chromeAwayMs,
          easing: tuning.chromeAwayEase,
          fill: 'forwards',
        });
      } catch {
        /* non-fatal: worst case the tile is visible a beat longer */
      }

      const layer = createOverlay();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cover = buildFaceCover(accent, glyphOf(tileEl), vw, vh);
      layer.appendChild(cover);

      // The cover is viewport-sized and starts scaled DOWN onto the tile.
      const sx = Math.max(rect.width, 1) / vw;
      const sy = Math.max(rect.height, 1) / vh;
      // Radius is painted pre-scale, so divide by the scale per axis to make
      // the on-screen corners match the tile at takeoff (the `x / y` form
      // keeps them circular under the non-uniform squish).
      const r = radiusOf(tileEl);
      const tileRadiusPreScale = `${r / sx}px / ${r / sy}px`;

      const zoomTiming: KeyframeAnimationOptions = {
        duration: tuning.launchZoomMs,
        delay: tuning.bloomDelayMs,
        easing: tuning.launchZoomEase,
        fill: 'forwards',
      };
      counterScaleGlyph(cover, sx, sy, 'toScreen', zoomTiming);

      let zoom: Animation;
      try {
        zoom = cover.animate(
          [
            { transform: `translate(${rect.left}px, ${rect.top}px) scale(${sx}, ${sy})`, borderRadius: tileRadiusPreScale },
            { transform: 'translate(0px, 0px) scale(1, 1)', borderRadius: '0px' },
          ],
          zoomTiming
        );
      } catch {
        resolve();
        fadeOutAndRemove(layer);
        return;
      }

      const land = () => {
        resolve();
        // Give the caller's state flip (mode → 'app') two frames to paint
        // before we start dissolving the cover into it.
        requestAnimationFrame(() => requestAnimationFrame(() => fadeOutAndRemove(layer)));
      };
      zoom.finished.then(land, land);
    } catch {
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// playReturn
// ---------------------------------------------------------------------------

/**
 * Reverse of `playLaunch`: a full-viewport accent cover shrinks back down
 * onto `tileEl`'s grid position. Resolves when it lands; chrome continues
 * animating back in and the cover continues dissolving into the real tile
 * afterward (not awaited, mirroring `playLaunch`'s asymmetric resolve).
 *
 * Called right after HomeScreen remounts (chrome present, natural layout).
 * We jump-collapse chrome synchronously first so the caller never gets a
 * visible frame of un-collapsed chrome before the cover appears.
 */
export function playReturn(tileEl: HTMLElement, accent: string): Promise<void> {
  if (prefersReducedMotion()) return quickCoverFade(accent, 'out');

  return new Promise((resolve) => {
    try {
      collapseChrome(document, false);
      // Chrome drifts back in on its own delayed clock (chromeBackDelayMs).
      restoreChrome(document, true).catch(() => {});

      if (!tileEl.isConnected) {
        resolve();
        return;
      }

      // Measure only after the chrome jump — collapsing top/bottom bars
      // can shift the row's centered position, and we want the shrink to
      // land on the tile's *final* box, not a pre-collapse one.
      const rect = tileEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const layer = createOverlay();
      const cover = buildFaceCover(accent, glyphOf(tileEl), vw, vh);
      layer.appendChild(cover);

      const scaleX = Math.max(rect.width, 1) / vw;
      const scaleY = Math.max(rect.height, 1) / vh;
      // Pre-scale radius so the landed corners match the tile (see playLaunch).
      const r = radiusOf(tileEl);
      const tileRadiusPreScale = `${r / scaleX}px / ${r / scaleY}px`;

      const shrinkTiming: KeyframeAnimationOptions = {
        duration: tuning.returnShrinkMs,
        easing: tuning.returnShrinkEase,
        fill: 'forwards',
      };
      counterScaleGlyph(cover, scaleX, scaleY, 'toTile', shrinkTiming);

      let shrink: Animation;
      try {
        shrink = cover.animate(
          [
            { transform: 'translate(0px, 0px) scale(1, 1)', borderRadius: '0px' },
            { transform: `translate(${rect.left}px, ${rect.top}px) scale(${scaleX}, ${scaleY})`, borderRadius: tileRadiusPreScale },
          ],
          shrinkTiming
        );
      } catch {
        resolve();
        fadeOutAndRemove(layer);
        return;
      }

      const land = () => {
        resolve();
        // Cover now sits pixel-for-pixel over the real tile; a short fade
        // hands off to it instead of a hard cut.
        fadeOutAndRemove(layer);
      };
      shrink.finished.then(land, land);
    } catch {
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// prefers-reduced-motion fallback: plain opacity crossfade, no spatial
// motion. Chrome is left untouched in this path — since the cover is an
// opaque full-viewport fade, there's nothing under it to hide/reveal.
// ---------------------------------------------------------------------------

function quickCoverFade(accent: string, direction: 'in' | 'out'): Promise<void> {
  return new Promise((resolve) => {
    try {
      const layer = createOverlay();
      // Flat accent is fine here: reduced motion means no zoom to sell.
      const cover = document.createElement('div');
      Object.assign(cover.style, { position: 'absolute', inset: '0', background: accent, pointerEvents: 'none' });
      layer.appendChild(cover);

      const keyframes: Keyframe[] =
        direction === 'in' ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }];

      const anim = cover.animate(keyframes, { duration: 150, easing: 'ease-out', fill: 'forwards' });

      const land = () => {
        resolve();
        if (direction === 'in') {
          // Leave the opaque cover in place briefly for the caller's state
          // flip, same handoff shape as the full launch animation.
          requestAnimationFrame(() => requestAnimationFrame(() => fadeOutAndRemove(layer, 100)));
        } else {
          if (activeOverlay === layer) activeOverlay = null;
          layer.remove();
        }
      };
      anim.finished.then(land, land);
    } catch {
      resolve();
    }
  });
}
