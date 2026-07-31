import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useFocusable } from '../focus';
import { tuning } from '../motion/tuning';
import {
  fetchRadarManifest,
  radarTileUrl,
  radarTilesFor,
  readRadarCache,
  writeRadarCache,
  type RadarFrame,
  type RadarManifest,
} from './radarData';
import type { WeatherLocation } from './weatherData';

type RadarStatus = 'loading' | 'refreshing' | 'ready' | 'offline';

function RadarControl({ id, label, onAccept, primary = false }: {
  id: string;
  label: string;
  onAccept: () => void;
  primary?: boolean;
}) {
  const { ref } = useFocusable({ id, scope: 'weather', onAccept });
  return (
    <button className={`weather-radar-control${primary ? ' weather-radar-control--primary' : ''}`} ref={ref} type="button" tabIndex={-1}>
      {label}
    </button>
  );
}

function formatFrameTime(timestamp: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
    }).format(new Date(timestamp * 1000));
  } catch {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp * 1000));
  }
}

function RadarLayer({
  manifest,
  frame,
  location,
  active,
  onTileLoad,
  onTileError,
}: {
  manifest: RadarManifest;
  frame: RadarFrame;
  location: WeatherLocation;
  active: boolean;
  onTileLoad: () => void;
  onTileError: () => void;
}) {
  const tiles = useMemo(() => radarTilesFor(location), [location.latitude, location.longitude]);
  return (
    <div className="weather-radar-layer" data-active={active ? 'true' : undefined} aria-hidden="true">
      {tiles.map((tile) => {
        const style: CSSProperties = {
          left: `calc(50% + ${tile.leftRem}rem)`,
          top: `calc(50% + ${tile.topRem}rem)`,
        };
        return (
          <img
            key={tile.key}
            className="weather-radar-tile"
            src={radarTileUrl(manifest, frame, tile)}
            style={style}
            alt=""
            draggable={false}
            onLoad={active ? onTileLoad : undefined}
            onError={active ? onTileError : undefined}
          />
        );
      })}
    </div>
  );
}

export function RadarView({ location, timezone }: { location: WeatherLocation; timezone: string }) {
  const cacheRef = useRef<RadarManifest | null | undefined>(undefined);
  if (cacheRef.current === undefined) cacheRef.current = readRadarCache();
  const [manifest, setManifest] = useState<RadarManifest | null>(cacheRef.current);
  const [status, setStatus] = useState<RadarStatus>(cacheRef.current ? 'refreshing' : 'loading');
  const [frameIndex, setFrameIndex] = useState(0);
  const [tileReady, setTileReady] = useState(false);
  const [tileErrors, setTileErrors] = useState(0);
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const controller = new AbortController();
    setStatus(cacheRef.current ? 'refreshing' : 'loading');
    void fetchRadarManifest(controller.signal)
      .then((nextManifest) => {
        setManifest(nextManifest);
        setFrameIndex(0);
        setTileReady(false);
        setTileErrors(0);
        setStatus('ready');
        writeRadarCache(nextManifest);
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('offline');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!playing || !manifest || manifest.frames.length < 2) return;
    const timer = window.setInterval(() => {
      setFrameIndex((index) => (index + 1) % manifest.frames.length);
    }, tuning.settleFadeMs + tuning.focusMoveMs);
    return () => window.clearInterval(timer);
  }, [manifest, playing]);

  useEffect(() => {
    setTileErrors(0);
  }, [frameIndex, location.id]);

  const frames = manifest?.frames ?? [];
  const safeIndex = frames.length > 0 ? frameIndex % frames.length : 0;
  const activeFrame = frames[safeIndex];
  const nextFrame = frames.length > 1 ? frames[(safeIndex + 1) % frames.length] : null;

  let message = 'Gathering the last two hours of radar…';
  if (status === 'offline') {
    message = manifest
      ? 'Can’t refresh radar right now — showing the last saved timeline.'
      : 'Can’t reach the radar right now. Conditions are still available.';
  } else if (activeFrame && tileReady) {
    message = `RainViewer · ${frames.length} frames · ${formatFrameTime(activeFrame.time, timezone)}`;
  } else if (activeFrame && tileErrors >= 21) {
    message = 'The radar timeline arrived, but its image tiles are out of reach.';
  } else if (activeFrame) {
    message = `Painting the ${formatFrameTime(activeFrame.time, timezone)} radar frame…`;
  }

  return (
    <main className="weather-radar" aria-label={`Weather radar around ${location.name}`}>
      <div className="weather-radar__heading">
        <div>
          <p>Last two hours</p>
          <h2>Rain around {location.name}</h2>
        </div>
        <div className="weather-radar__controls">
          <RadarControl
            id="weather-radar-play"
            label={playing ? 'Pause' : 'Play'}
            primary
            onAccept={() => setPlaying((current) => !current)}
          />
          <RadarControl
            id="weather-radar-latest"
            label="Latest"
            onAccept={() => {
              if (frames.length > 0) setFrameIndex(frames.length - 1);
              setPlaying(false);
            }}
          />
        </div>
      </div>

      <div className="weather-radar-map">
        <svg className="weather-radar-map__land" viewBox="0 0 1200 420" preserveAspectRatio="none" aria-hidden="true">
          <path d="M-60 72c120 30 120 102 205 118 92 17 122-55 205-25 72 26 62 105 141 126 92 24 148-67 244-37 86 27 105 109 210 106 72-2 112-48 201-36 68 9 92 49 128 71" />
          <path d="M76 390c59-90 116-83 153-155 29-57 21-123 69-181M875-20c-6 66 51 96 35 159-19 72-99 84-97 163 1 43 28 74 63 118" />
        </svg>
        <div className="weather-radar-map__grid" aria-hidden="true" />
        {manifest && nextFrame && (
          <RadarLayer
            key={`next-${nextFrame.path}-${location.id}`}
            manifest={manifest}
            frame={nextFrame}
            location={location}
            active={false}
            onTileLoad={() => undefined}
            onTileError={() => undefined}
          />
        )}
        {manifest && activeFrame && (
          <RadarLayer
            key={`active-${activeFrame.path}-${location.id}`}
            manifest={manifest}
            frame={activeFrame}
            location={location}
            active
            onTileLoad={() => setTileReady(true)}
            onTileError={() => setTileErrors((count) => count + 1)}
          />
        )}
        <div className="weather-radar-marker" aria-hidden="true"><span /></div>
        <div className="weather-radar-map__label">{location.name}</div>
        <div className="weather-radar-legend" aria-hidden="true">
          <span>Light</span><i /><i /><i /><i /><span>Heavy</span>
        </div>
      </div>

      <p className="weather-radar__status" data-offline={status === 'offline' ? 'true' : undefined} aria-live="polite">
        {message}
      </p>
    </main>
  );
}
