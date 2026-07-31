import type { WeatherLocation } from './weatherData';

export interface RadarFrame {
  time: number;
  path: string;
}

export interface RadarManifest {
  host: string;
  generated: number;
  fetchedAt: number;
  frames: RadarFrame[];
}

export interface RadarTile {
  key: string;
  x: number;
  y: number;
  leftRem: number;
  topRem: number;
}

const RADAR_ENDPOINT = 'https://api.rainviewer.com/public/weather-maps.json';
const RADAR_CACHE_KEY = 'console-weather-radar:v1';
export const RADAR_ZOOM = 7;
export const RADAR_TILE_REM = 16;

type RainViewerResponse = {
  host?: unknown;
  generated?: unknown;
  radar?: { past?: unknown };
};

function isFrame(value: unknown): value is RadarFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Partial<RadarFrame>;
  return typeof frame.time === 'number' && Number.isFinite(frame.time) &&
    typeof frame.path === 'string' && /^\/v2\/radar\/[a-zA-Z0-9]+$/.test(frame.path);
}

function isSafeHost(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (url.hostname === 'tilecache.rainviewer.com' || url.hostname.endsWith('.rainviewer.com'));
  } catch {
    return false;
  }
}

function isManifest(value: unknown): value is RadarManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<RadarManifest>;
  return isSafeHost(manifest.host) && typeof manifest.generated === 'number' &&
    typeof manifest.fetchedAt === 'number' && Array.isArray(manifest.frames) &&
    manifest.frames.length > 0 && manifest.frames.every(isFrame);
}

export async function fetchRadarManifest(signal: AbortSignal): Promise<RadarManifest> {
  const response = await fetch(RADAR_ENDPOINT, { signal });
  if (!response.ok) throw new Error('Radar service unavailable');
  const raw = (await response.json()) as RainViewerResponse;
  if (!isSafeHost(raw.host) || typeof raw.generated !== 'number' ||
      !raw.radar || !Array.isArray(raw.radar.past)) {
    throw new Error('Incomplete radar response');
  }
  const frames = raw.radar.past.filter(isFrame).slice(-6);
  if (frames.length === 0) throw new Error('No radar frames available');
  return { host: raw.host, generated: raw.generated, fetchedAt: Date.now(), frames };
}

export function readRadarCache(): RadarManifest | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(RADAR_CACHE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return isManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeRadarCache(manifest: RadarManifest): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RADAR_CACHE_KEY, JSON.stringify(manifest));
  } catch {
    // Browser image caching may still retain tiles when metadata persistence is unavailable.
  }
}

/** Standard Web Mercator slippy-tile math, kept independent of any map SDK. */
export function latLonToWorldTile(latitude: number, longitude: number, zoom: number) {
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const wrappedLongitude = ((longitude + 180) % 360 + 360) % 360 - 180;
  const scale = 2 ** zoom;
  const latitudeRadians = clampedLatitude * Math.PI / 180;
  return {
    x: (wrappedLongitude + 180) / 360 * scale,
    y: (1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * scale,
  };
}

/**
 * Build a 7x3 tile field around the selected city. URL x values wrap at the
 * antimeridian; y values stop at Web Mercator's polar limits. Offsets are in
 * rem so the map participates in the console's UI scaling.
 */
export function radarTilesFor(location: WeatherLocation, zoom = RADAR_ZOOM): RadarTile[] {
  const center = latLonToWorldTile(location.latitude, location.longitude, zoom);
  const tileCount = 2 ** zoom;
  const centerTileX = Math.floor(center.x);
  const centerTileY = Math.floor(center.y);
  const tiles: RadarTile[] = [];

  for (let row = -1; row <= 1; row += 1) {
    const y = centerTileY + row;
    if (y < 0 || y >= tileCount) continue;
    for (let column = -3; column <= 3; column += 1) {
      const unwrappedX = centerTileX + column;
      const x = ((unwrappedX % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${unwrappedX}-${y}`,
        x,
        y,
        leftRem: (unwrappedX - center.x) * RADAR_TILE_REM,
        topRem: (y - center.y) * RADAR_TILE_REM,
      });
    }
  }
  return tiles;
}

export function radarTileUrl(
  manifest: RadarManifest,
  frame: RadarFrame,
  tile: RadarTile,
  zoom = RADAR_ZOOM,
): string {
  return `${manifest.host}${frame.path}/256/${zoom}/${tile.x}/${tile.y}/2/1_1.png`;
}
