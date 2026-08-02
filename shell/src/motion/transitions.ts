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
 *    or care about the tile zoom, it just slides itself off its own edge of
 *    the screen and back. Compositor-only, deliberately: this runs at the
 *    same time as a full-viewport cover is scaling, and it is the one thing
 *    in the transition that used to touch layout.
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
  /**
   * Where this bar goes when it leaves — a `translate` value that carries it
   * clear of its own edge of the screen.
   *
   * This used to animate width/height/margins to zero, which was a mistake
   * that only became obvious on the media PC's GTX 970: those are layout
   * properties, so every frame of the launch re-ran layout for the chrome
   * while a full-viewport cover was scaling over it. Sliding is compositor
   * work — no layout, no paint — and it looks better besides, because a bar
   * that squashes to nothing reads as a bug where one that leaves reads as
   * the screen making way.
   */
  offset: string;
  opacity: number;
}

type StyleProps = Partial<Record<'translate' | 'opacity', string>>;

/**
 * Elements we've collapsed, keyed by element, so a later `restoreChrome`
 * (possibly from a different call site) can reverse exactly what we did —
 * and so calling `collapseChrome` twice in a row doesn't re-capture an
 * already-collapsed box as if it were the "original" one.
 */
const chromeOriginals = new WeakMap<HTMLElement, ChromeOriginal>();

/**
 * Which way a bar leaves, and how far. Decided from where it actually sits
 * rather than from a hard-coded "headers go up": rooms position their chrome
 * themselves, and a footer that slid upward through the content would be
 * very obviously wrong.
 */
function exitOffset(el: HTMLElement, kind: CollapseKind): string {
  if (kind === 'fade') return '0 0';
  const rect = el.getBoundingClientRect();
  // A little past the edge, so a bar with a shadow or a scrim clears fully.
  const slack = 24;
  if (kind === 'x') {
    const width = window.innerWidth || rect.right;
    const goesLeft = rect.left + rect.width / 2 < width / 2;
    return goesLeft ? `${-(rect.right + slack)}px 0` : `${width - rect.left + slack}px 0`;
  }
  const height = window.innerHeight || rect.bottom;
  const goesUp = rect.top + rect.height / 2 < height / 2;
  return goesUp ? `0 ${-(rect.bottom + slack)}px` : `0 ${height - rect.top + slack}px`;
}

function measureOriginal(el: HTMLElement, kind: CollapseKind): ChromeOriginal {
  const cs = getComputedStyle(el);
  return {
    cssText: el.style.cssText,
    offset: exitOffset(el, kind),
    opacity: cs.opacity === '' ? 1 : parseFloat(cs.opacity) || 0,
  };
}

function collapsedStyleFor(o: ChromeOriginal): StyleProps {
  return { translate: o.offset, opacity: '0' };
}

function naturalStyleFor(o: ChromeOriginal): StyleProps {
  return { translate: '0 0', opacity: `${o.opacity}` };
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
 * Slide every `data-collapse="x"|"y"` element under `root` off its own edge
 * of the screen, and fade every `data-collapse="fade"` one out.
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
      original = measureOriginal(el, kind);
      chromeOriginals.set(el, original);
    }

    const to = collapsedStyleFor(original);

    if (!animate) {
      applyStyle(el, to);
      continue;
    }

    const from = naturalStyleFor(original);
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

    const from = collapsedStyleFor(original);
    const to = naturalStyleFor(original);

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
      // Deliberately NO drop-shadow. This element is scaled roughly six-fold
      // across the launch, and a blurred filter on it forces the compositor to
      // re-blur a very large area every single frame — the most expensive
      // thing in the transition, on the one element that must stay smooth.
      // The cover's own gradient already separates the glyph from the ground.
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
export interface LaunchOptions {
  /**
   * Whether the room's chrome retracts along with the zoom.
   *
   * True when the screen is being left behind — the header and hint bar
   * belong to the thing you are leaving. False when the zoom is a move
   * *within* a room (a console opening into its library): the chrome is
   * continuous across that move, and retracting it would be a lie, as well
   * as leaving it collapsed since only the homecoming restores it.
   */
  collapseChrome?: boolean;
}

export function playLaunch(
  tileEl: HTMLElement,
  accent: string,
  options: LaunchOptions = {},
): Promise<void> {
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
      if (options.collapseChrome !== false) {
        collapseChrome(document, true).catch(() => {});
      }

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
// playScreenExit
// ---------------------------------------------------------------------------

/**
 * The missing half of every in-room transition.
 *
 * Rooms animate the screen that arrives — the console picker slides in, a
 * game's detail page slides in — but the screen being left was simply
 * destroyed on the same frame. So a step deeper was a hard cut followed by a
 * slide, and a step back out was the same. The incoming animation was doing
 * all the work of selling a move that had already happened.
 *
 * React gives no way to animate a node it is about to unmount, so this takes
 * a photocopy: the outgoing element is cloned into the overlay layer at the
 * exact rect it occupied, and the copy is animated out while React gets on
 * with mounting the replacement underneath. The clone is inert — no ids, no
 * focus, no input — it exists for a quarter of a second purely to leave.
 *
 * @param el   The screen being unmounted, while it is still in the document.
 * @param dx   Pixels to drift horizontally; sign carries the direction of
 *             travel, so going deeper and backing out don't look identical.
 */
export function playScreenExit(el: HTMLElement, dx: number): void {
  if (prefersReducedMotion()) return;
  // Cleanup can run after the node is already detached, depending on how the
  // caller is wired. Nothing to photograph in that case — the incoming
  // animation alone is a graceful enough degradation.
  if (!el.isConnected) return;
  // A launch cover is already over the screen, opaque and full-viewport. The
  // copy would drift about entirely unseen, at the exact moment the zoom
  // needs the frames.
  if (activeOverlay) return;

  // A photocopy costs a clone, a layout and a paint of everything in the
  // subtree — including the parts scrolled out of sight. On a nine-game shelf
  // that is 137 nodes and half a millisecond; on a four-figure library it is
  // thousands of nodes and a dropped frame at the exact moment the user
  // expects smooth motion. Past this size the arriving screen animates alone,
  // which is a much better trade than a hitch.
  if (el.querySelectorAll('*').length > 3000) return;

  try {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    const layer = document.createElement('div');
    layer.setAttribute('data-motion-exit', '');
    Object.assign(layer.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      // Under the chrome (z 6) but over the room, so the outgoing screen
      // passes beneath the header and hint pill exactly as the live one did.
      zIndex: '3',
      overflow: 'hidden',
      pointerEvents: 'none',
    });

    const clone = el.cloneNode(true) as HTMLElement;
    // A duplicate id or a stray `data-focused` would confuse the focus engine
    // and screen readers alike for as long as the copy lives.
    clone.removeAttribute('id');
    for (const node of clone.querySelectorAll('[id]')) node.removeAttribute('id');
    clone.setAttribute('aria-hidden', 'true');
    Object.assign(clone.style, {
      position: 'absolute',
      inset: '0',
      margin: '0',
      // Scroll position is not cloned, so anchor the copy where the real
      // element was scrolled to rather than snapping it to the top.
      transform: `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`,
    });

    layer.appendChild(clone);
    document.body.appendChild(layer);

    const remove = () => layer.remove();
    const anim = layer.animate(
      [
        { opacity: 1, translate: '0 0' },
        { opacity: 0, translate: `${dx}px 0` },
      ],
      {
        duration: tuning.drillMs,
        easing: tuning.drillOutEase,
        fill: 'forwards',
      },
    );
    anim.finished.then(remove, remove);
  } catch {
    // Purely decorative; a failure here must never block a navigation.
  }
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
