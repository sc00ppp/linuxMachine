import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LANDMASSES, MERIDIANS, PARALLELS, type Ring } from './worldOutline';
import './SituationGlobe.css';

export type MarkerKind =
  | 'quake'
  | 'event'
  | 'volcano'
  | 'alert'
  | 'flood'
  | 'air'
  | 'orbit'
  | 'signal'
  | 'traffic';

export interface SituationMarker {
  id: string;
  lat: number;
  lng: number;
  kind: MarkerKind;
}

export interface SituationTrace {
  id: string;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
}

interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

const GLOBE_CENTER_X = 400;
const GLOBE_CENTER_Y = 300;
const GLOBE_RADIUS = 224;

function normalizeLongitude(value: number): number {
  let normalized = value % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  return normalized;
}

function project(lat: number, lng: number, centerLng: number): ProjectedPoint {
  const latRad = (Math.max(-89, Math.min(89, lat)) * Math.PI) / 180;
  const lngRad = (normalizeLongitude(lng - centerLng) * Math.PI) / 180;
  const latitudeScale = Math.cos(latRad);
  return {
    x: GLOBE_CENTER_X + GLOBE_RADIUS * latitudeScale * Math.sin(lngRad),
    y: GLOBE_CENTER_Y - GLOBE_RADIUS * Math.sin(latRad) * 0.96,
    depth: latitudeScale * Math.cos(lngRad),
  };
}

/**
 * Project a lat/lng ring to an SVG path.
 *
 * Points on the far side are clamped onto the limb circle rather than
 * dropped, which keeps polygons closed so continents still fill correctly as
 * they rotate around the edge. Rings entirely on the back face return null.
 */
function ringPath(ring: Ring, centerLng: number, close: boolean): string | null {
  let anyVisible = false;
  const parts: string[] = [];

  for (let i = 0; i < ring.length; i += 1) {
    const [lng, lat] = ring[i];
    const p = project(lat, lng, centerLng);
    let { x, y } = p;

    if (p.depth < 0) {
      // Push onto the limb, preserving direction from the globe centre.
      const dx = x - GLOBE_CENTER_X;
      const dy = y - GLOBE_CENTER_Y;
      const len = Math.hypot(dx, dy) || 1;
      x = GLOBE_CENTER_X + (dx / len) * GLOBE_RADIUS;
      y = GLOBE_CENTER_Y + (dy / len) * GLOBE_RADIUS;
    } else {
      anyVisible = true;
    }

    parts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }

  if (!anyVisible) return null;
  return parts.join(' ') + (close ? ' Z' : '');
}

/** Graticule lines are stroked, so back-face points are dropped instead. */
function linePath(ring: Ring, centerLng: number): string | null {
  const parts: string[] = [];
  let pen = false;
  for (const [lng, lat] of ring) {
    const p = project(lat, lng, centerLng);
    if (p.depth < 0.02) {
      pen = false;
      continue;
    }
    parts.push(`${pen ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
    pen = true;
  }
  return parts.length > 1 ? parts.join(' ') : null;
}

function tracePath(
  trace: SituationTrace,
  centerLng: number,
): { d: string; visible: boolean } {
  const start = project(trace.start.lat, trace.start.lng, centerLng);
  const end = project(trace.end.lat, trace.end.lng, centerLng);
  const midX = (start.x + end.x) / 2;
  const midY = Math.min(start.y, end.y) - 54;
  return {
    d: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
    visible: start.depth > -0.22 || end.depth > -0.22,
  };
}

/**
 * Ease the globe's centre longitude toward its target instead of snapping.
 *
 * A duration-based ease-in-out tween, NOT exponential decay: decay starts at
 * maximum velocity, which reads as a jerk the instant you change selection.
 * This accelerates from rest and settles gently. Rotation always takes the
 * short way round (crossing the antimeridian rather than unwinding 350°).
 * Longer hops get a little more time, capped so it never feels sluggish.
 */
function useSmoothLongitude(target: number): number {
  const [current, setCurrent] = useState(target);
  const currentRef = useRef(target);
  const frameRef = useRef(0);

  useEffect(() => {
    const from = currentRef.current;
    const delta = normalizeLongitude(target - from);

    if (
      Math.abs(delta) < 0.05 ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      currentRef.current = target;
      setCurrent(target);
      return;
    }

    // 420ms for a nudge, up to ~900ms for a half-world swing.
    const duration = 420 + Math.min(480, (Math.abs(delta) / 180) * 480);
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeInOutCubic — rests at both ends, fastest in the middle.
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      currentRef.current = normalizeLongitude(from + delta * eased);
      setCurrent(currentRef.current);
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target]);

  return current;
}

/**
 * Per-layer symbols. A quake reads differently from a storm at a glance —
 * generic dots made every layer look the same, which defeated the point of
 * stacking them.
 */
function MarkerSymbol({ kind, selected }: { kind: MarkerKind; selected: boolean }) {
  const s = selected ? 1.35 : 1;
  const g = (children: ReactNode) => (
    <g className="situation-globe__marker-core" transform={`scale(${s})`}>
      {children}
    </g>
  );

  switch (kind) {
    case 'quake':
      // Concentric shock rings.
      return g(
        <>
          <circle r="2.6" />
          <circle className="situation-globe__marker-ring" r="6" />
          <circle className="situation-globe__marker-ring" r="9.5" />
        </>,
      );
    case 'volcano':
      // Cone with a vent plume.
      return g(<path d="M-6 5 L0 -5 L6 5 Z M0 -5 v-4" />);
    case 'alert':
      // Warning triangle.
      return g(<path d="M0 -6.5 L6 5 H-6 Z" />);
    case 'event':
      // Four-point spark (fires, storms — EONET's mixed bag).
      return g(<path d="M0 -7 L1.8 -1.8 L7 0 L1.8 1.8 L0 7 L-1.8 1.8 L-7 0 L-1.8 -1.8 Z" />);
    case 'flood':
      // Stacked water lines.
      return g(<path d="M-6 -2q3-2.5 6 0t6 0M-6 2.5q3-2.5 6 0t6 0" />);
    case 'air':
      // Soft ring — a reading, not an incident.
      return g(
        <>
          <circle className="situation-globe__marker-ring" r="6" />
          <circle r="1.8" />
        </>,
      );
    case 'orbit':
      // Satellite: body plus panels.
      return g(<path d="M-3 -3 h6 v6 h-6 Z M-3 0 h-6 M3 0 h6" />);
    case 'signal':
      // Broadcast arcs.
      return g(<path d="M0 4 v-3 M-4 1a5.5 5.5 0 0 1 8 0M-7.5 -2a10 10 0 0 1 15 0" />);
    case 'traffic':
      // Aircraft chevron.
      return g(<path d="M0 -7 L5.5 5 L0 2 L-5.5 5 Z" />);
    default:
      return g(<circle r="4" />);
  }
}

export function SituationGlobe({
  markers,
  traces,
  selectedId,
  scene,
}: {
  markers: SituationMarker[];
  traces: SituationTrace[];
  selectedId: string | null;
  scene: string;
}) {
  const selected = markers.find((marker) => marker.id === selectedId);
  const targetLng = selected?.lng ?? markers[0]?.lng ?? -18;
  const centerLng = useSmoothLongitude(targetLng);

  return (
    <div className="situation-globe" data-scene={scene} aria-hidden="true">
      <div className="situation-globe__aura" />
      <svg
        className="situation-globe__svg"
        viewBox="0 0 800 600"
        role="presentation"
      >
        <defs>
          <radialGradient id="situation-ocean" cx="31%" cy="22%" r="78%">
            <stop offset="0%" stopColor="color-mix(in srgb, var(--accent) 42%, var(--text))" />
            <stop offset="44%" stopColor="color-mix(in srgb, var(--accent) 26%, var(--bg-1))" />
            <stop offset="100%" stopColor="color-mix(in srgb, var(--accent) 8%, var(--bg-0))" />
          </radialGradient>
          <radialGradient id="situation-shade" cx="28%" cy="23%" r="82%">
            <stop offset="52%" stopColor="transparent" />
            <stop offset="100%" stopColor="color-mix(in srgb, var(--bg-0) 82%, transparent)" />
          </radialGradient>
          <clipPath id="situation-sphere-clip">
            <circle cx={GLOBE_CENTER_X} cy={GLOBE_CENTER_Y} r={GLOBE_RADIUS} />
          </clipPath>
        </defs>

        <ellipse
          className="situation-globe__floor"
          cx={GLOBE_CENTER_X}
          cy="544"
          rx="250"
          ry="25"
        />
        <circle
          className="situation-globe__sphere"
          cx={GLOBE_CENTER_X}
          cy={GLOBE_CENTER_Y}
          r={GLOBE_RADIUS}
        />

        {/* Graticule and coastlines are re-projected from real lat/lng every
            render, so the whole Earth genuinely turns when the globe
            re-centres on a selected event. */}
        <g className="situation-globe__grid" clipPath="url(#situation-sphere-clip)">
          {[...MERIDIANS, ...PARALLELS].map((ring: Ring, i: number) => {
            const d = linePath(ring, centerLng);
            return d ? <path key={`grat-${i}`} d={d} /> : null;
          })}
        </g>

        <g className="situation-globe__land" clipPath="url(#situation-sphere-clip)">
          {LANDMASSES.map((ring: Ring, i: number) => {
            const d = ringPath(ring, centerLng, true);
            return d ? <path key={`land-${i}`} d={d} /> : null;
          })}
        </g>

        <g className="situation-globe__traces" clipPath="url(#situation-sphere-clip)">
          {traces.map((trace) => {
            const projected = tracePath(trace, centerLng);
            return projected.visible ? (
              <path key={trace.id} d={projected.d} pathLength="1" />
            ) : null;
          })}
        </g>

        <g clipPath="url(#situation-sphere-clip)">
          {markers.map((marker) => {
            const point = project(marker.lat, marker.lng, centerLng);
            const selectedMarker = marker.id === selectedId;
            const style = {
              '--marker-x': `${point.x}px`,
              '--marker-y': `${point.y}px`,
              '--marker-depth': Math.max(0.2, (point.depth + 1) / 2),
            } as CSSProperties;
            return (
              <g
                className="situation-globe__marker"
                data-kind={marker.kind}
                data-selected={selectedMarker ? 'true' : 'false'}
                data-behind={point.depth < -0.16 ? 'true' : 'false'}
                key={marker.id}
                style={style}
              >
                <circle className="situation-globe__marker-wake" r="14" />
                <MarkerSymbol kind={marker.kind} selected={selectedMarker} />
              </g>
            );
          })}
        </g>

        {scene === 'orbit' && (
          <g className="situation-globe__orbit">
            <ellipse
              cx={GLOBE_CENTER_X}
              cy={GLOBE_CENTER_Y}
              rx="286"
              ry="92"
              transform={`rotate(-18 ${GLOBE_CENTER_X} ${GLOBE_CENTER_Y})`}
            />
            <g className="situation-globe__satellite">
              <rect x="-8" y="-5" width="16" height="10" rx="3" />
              <path d="M-8-2h-17v4h17M8-2h17v4H8" />
            </g>
          </g>
        )}

        <circle
          className="situation-globe__shade"
          cx={GLOBE_CENTER_X}
          cy={GLOBE_CENTER_Y}
          r={GLOBE_RADIUS}
        />
        <path className="situation-globe__shine" d="M258 178c42-54 101-77 148-73" />
      </svg>
    </div>
  );
}
