/**
 * Interruptible spring scrolling — the replacement for
 * `scrollIntoView({ behavior: 'smooth' })`.
 *
 * Why this exists: the whole shell navigated by native smooth scroll, and it
 * felt jerky for one specific reason. Chromium's smooth scroll is a fixed,
 * non-interruptible curve. Press right again before it finishes — which is
 * exactly what holding a d-pad does, at one press every 120ms against a
 * ~300ms curve — and the browser *cancels* the in-flight animation and starts
 * a fresh one from a standing start. Velocity is thrown away on every press,
 * so a held direction reads as a stutter of little lurches instead of one
 * glide. No amount of CSS tuning fixes it, because none of it is exposed.
 *
 * A spring has no such seam. Retargeting mid-flight keeps the current
 * velocity and simply bends the trajectory toward the new destination, so
 * five presses in a row produce one continuous accelerating sweep that
 * settles once. That carried velocity is the entire "Apple feel" — it is not
 * the easing curve, it is the fact that the motion is never restarted.
 *
 * The spring is critically-damped-ish (ζ just under 1): it must never
 * overshoot a shelf edge, because overshoot on a 10-foot screen reads as a
 * mistake rather than as bounce.
 */
import { tuning } from './tuning';

type Axis = 'x' | 'y';
type Align = 'start' | 'center' | 'end' | 'nearest';

export interface GlideOptions {
  /** Vertical alignment, matching scrollIntoView's vocabulary. */
  block?: Align;
  /** Horizontal alignment. */
  inline?: Align;
  /** Skip the spring and jump (used pre-paint, and for reduced motion). */
  instant?: boolean;
}

interface AxisState {
  target: number;
  velocity: number;
}

interface ContainerState {
  x: AxisState | null;
  y: AxisState | null;
  frame: number | null;
  lastTime: number;
  /** The container's own `scroll-behavior`, restored when we let go. */
  restoreBehavior: string;
}

/**
 * Live springs, keyed by scroll container. Weak so a container that unmounts
 * mid-glide is collectable — rooms are keyed on their level and remount
 * constantly, and a Map would pin every screen the user ever visited.
 */
const states = new WeakMap<Element, ContainerState>();

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/** Does this element actually scroll on `axis`? */
function scrollsOn(el: Element, axis: Axis): boolean {
  const style = getComputedStyle(el);
  const overflow = axis === 'x' ? style.overflowX : style.overflowY;
  if (overflow !== 'auto' && overflow !== 'scroll') return false;
  const scrollSize = axis === 'x' ? el.scrollWidth : el.scrollHeight;
  const clientSize = axis === 'x' ? el.clientWidth : el.clientHeight;
  // A pane that *could* scroll but has nothing to scroll is not the container
  // we want; keep walking up so a short row inside a tall page still glides.
  return scrollSize - clientSize > 1;
}

/** Nearest scrollable ancestor on `axis`, or null if nothing scrolls. */
function scrollParent(el: Element, axis: Axis): Element | null {
  let node = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    if (scrollsOn(node, axis)) return node;
    node = node.parentElement;
  }
  return null;
}

function pixels(value: string, fallback = 0): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * How far `el` must move along `axis` for the requested alignment, measured
 * inside the container's scroll-padding box.
 *
 * scroll-padding is not decoration here: the home wall's "the row stays put
 * while focus roams the middle, and glides only when focus reaches the
 * margins" behaviour IS `scroll-padding-inline` plus `nearest`. Ignoring it
 * would recentre on every hop and lose the Switch-style feel entirely.
 */
function deltaFor(
  container: Element,
  el: Element,
  axis: Axis,
  align: Align,
): number {
  const containerRect = container.getBoundingClientRect();
  const elementRect = el.getBoundingClientRect();
  const style = getComputedStyle(container);

  const padStart = pixels(
    axis === 'x' ? style.scrollPaddingLeft : style.scrollPaddingTop,
  );
  const padEnd = pixels(
    axis === 'x' ? style.scrollPaddingRight : style.scrollPaddingBottom,
  );

  const viewStart = (axis === 'x' ? containerRect.left : containerRect.top) + padStart;
  const viewEnd = (axis === 'x' ? containerRect.right : containerRect.bottom) - padEnd;
  const elStart = axis === 'x' ? elementRect.left : elementRect.top;
  const elEnd = axis === 'x' ? elementRect.right : elementRect.bottom;

  switch (align) {
    case 'start':
      return elStart - viewStart;
    case 'end':
      return elEnd - viewEnd;
    case 'center':
      return (elStart + elEnd) / 2 - (viewStart + viewEnd) / 2;
    case 'nearest':
    default: {
      // Already inside the padded window: hold absolutely still. This is the
      // rule that keeps the wall from creeping a few pixels on every press.
      if (elStart >= viewStart && elEnd <= viewEnd) return 0;
      // Too large to fit: align its leading edge rather than jittering.
      if (elEnd - elStart > viewEnd - viewStart) return elStart - viewStart;
      return elStart < viewStart ? elStart - viewStart : elEnd - viewEnd;
    }
  }
}

function clampTarget(container: Element, axis: Axis, value: number): number {
  const max =
    axis === 'x'
      ? container.scrollWidth - container.clientWidth
      : container.scrollHeight - container.clientHeight;
  return Math.min(Math.max(value, 0), Math.max(max, 0));
}

function currentScroll(container: Element, axis: Axis): number {
  return axis === 'x' ? container.scrollLeft : container.scrollTop;
}

function setScroll(container: Element, axis: Axis, value: number): void {
  if (axis === 'x') container.scrollLeft = value;
  else container.scrollTop = value;
}

/**
 * Advance one axis by `dt` seconds. Standard damped-spring integration:
 *
 *   a = -2ζω·v - ω²·(x - target)
 *
 * with ω from the response time, so `navGlideMs` reads as "how long until it
 * has essentially arrived" rather than as an opaque stiffness number.
 */
function step(
  container: Element,
  axis: Axis,
  state: AxisState,
  dt: number,
): boolean {
  const omega = (2 * Math.PI) / (tuning.navGlideMs / 1000);
  const zeta = tuning.navGlideDamping;

  let position = currentScroll(container, axis);
  // Sub-step at a fixed rate: a dropped frame (or a 30Hz TV panel) must not
  // change the trajectory, and a stiff spring integrated at 100ms per step
  // goes unstable and rings.
  const slice = 1 / 240;
  let remaining = dt;
  while (remaining > 0) {
    const h = Math.min(slice, remaining);
    const accel =
      -2 * zeta * omega * state.velocity - omega * omega * (position - state.target);
    state.velocity += accel * h;
    position += state.velocity * h;
    remaining -= h;
  }

  // Settled: snap exactly onto the target so repeated glides don't accumulate
  // sub-pixel drift, and report that this axis is done.
  if (Math.abs(position - state.target) < 0.5 && Math.abs(state.velocity) < 12) {
    setScroll(container, axis, state.target);
    return true;
  }

  setScroll(container, axis, position);
  return false;
}

function stop(container: Element, state: ContainerState): void {
  if (state.frame !== null) cancelAnimationFrame(state.frame);
  state.frame = null;
  (container as HTMLElement).style.scrollBehavior = state.restoreBehavior;
}

function run(container: Element, state: ContainerState): void {
  const tick = (now: number) => {
    // Clamp dt: returning to a backgrounded tab hands us a multi-second delta,
    // which would teleport the shelf.
    const dt = Math.min((now - state.lastTime) / 1000, 1 / 20);
    state.lastTime = now;

    let done = true;
    if (state.x) {
      if (step(container, 'x', state.x, dt)) state.x = null;
      else done = false;
    }
    if (state.y) {
      if (step(container, 'y', state.y, dt)) state.y = null;
      else done = false;
    }

    if (done) {
      stop(container, state);
      return;
    }
    state.frame = requestAnimationFrame(tick);
  };

  state.frame = requestAnimationFrame(tick);
}

/**
 * Bring `el` into view inside its scroll parents, on a spring.
 *
 * Drop-in for `el.scrollIntoView({ behavior: 'smooth', block, inline })`.
 * Both axes are handled, each against its own nearest scrollable ancestor,
 * so a card inside a horizontal rail inside a vertical page glides on both
 * at once — which native scrollIntoView does too, just worse.
 */
export function glideIntoView(
  el: Element | null | undefined,
  options: GlideOptions = {},
): void {
  if (!el || typeof window === 'undefined') return;

  const block = options.block ?? 'nearest';
  const inline = options.inline ?? 'nearest';
  const instant = options.instant || prefersReducedMotion();

  for (const axis of ['x', 'y'] as const) {
    const align = axis === 'x' ? inline : block;
    const container = scrollParent(el, axis);
    if (!container) continue;

    const delta = deltaFor(container, el, axis, align);
    // `nearest` returning 0 is the common case (focus roaming the middle of a
    // row); doing nothing at all is the point, so never start a spring for it.
    if (Math.abs(delta) < 0.5) continue;

    const from = currentScroll(container, axis);
    const target = clampTarget(container, axis, from + delta);
    if (Math.abs(target - from) < 0.5) continue;

    if (instant) {
      // Native smooth scroll must be off for a direct write to land as a jump.
      const element = container as HTMLElement;
      const saved = element.style.scrollBehavior;
      element.style.scrollBehavior = 'auto';
      setScroll(container, axis, target);
      element.style.scrollBehavior = saved;
      continue;
    }

    let state = states.get(container);
    if (!state) {
      state = {
        x: null,
        y: null,
        frame: null,
        lastTime: performance.now(),
        restoreBehavior: (container as HTMLElement).style.scrollBehavior,
      };
      states.set(container, state);
    }

    // We write scrollLeft/scrollTop every frame. If the container still has
    // CSS `scroll-behavior: smooth`, each of those writes would kick off its
    // own native smooth scroll and fight the spring — so take it off for the
    // duration and hand it back when we settle.
    (container as HTMLElement).style.scrollBehavior = 'auto';

    const existing = axis === 'x' ? state.x : state.y;
    const next: AxisState = existing
      // The whole reason this module exists: keep the velocity. A press that
      // lands mid-flight bends the current motion instead of restarting it.
      ? { target, velocity: existing.velocity }
      : { target, velocity: 0 };

    if (axis === 'x') state.x = next;
    else state.y = next;

    if (state.frame === null) {
      state.lastTime = performance.now();
      run(container, state);
    }
  }
}

/**
 * Abandon any in-flight glide for the container that owns `el`.
 *
 * Needed before a shared-element transition measures a tile: a spring still
 * settling would drag the tile out from under the zoom, and the launch would
 * land on a rect that no longer exists.
 */
export function cancelGlide(el: Element | null | undefined): void {
  if (!el) return;
  for (const axis of ['x', 'y'] as const) {
    const container = scrollParent(el, axis);
    if (!container) continue;
    const state = states.get(container);
    if (!state) continue;
    state.x = null;
    state.y = null;
    stop(container, state);
  }
}
