import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { channelById } from '../core/channels';
import { useFocusable } from '../focus';
import { tuning } from '../motion/tuning';
import { sound } from '../sound';
import {
  loadSituationData,
  readSituationCache,
  SITUATION_SOURCE_COUNT,
  type SituationSnapshot,
} from './data';
import {
  SituationGlobe,
  type MarkerKind,
  type SituationMarker,
  type SituationTrace,
} from './SituationGlobe';
import './SituationChannel.css';
import { glideIntoView } from '../motion/glide';

/**
 * Situation — a live globe with toggleable data layers.
 *
 * Layers stack on one globe rather than swapping between views, so you can
 * see quakes and storms together. The event list is the navigation: focusing
 * a row spins the globe to that point and shows its real numbers. No prose —
 * every line on this screen is a measured value with a source.
 */

type LayerId =
  | 'quakes'
  | 'events'
  | 'volcanoes'
  | 'alerts'
  | 'weather'
  | 'orbit';

interface LayerDef {
  id: LayerId;
  label: string;
  kind: MarkerKind;
  source: string;
  /** On by default? Keeps the first view legible instead of a confetti globe. */
  on: boolean;
}

const LAYERS: LayerDef[] = [
  { id: 'quakes', label: 'Earthquakes', kind: 'quake', source: 'USGS', on: true },
  { id: 'events', label: 'Natural events', kind: 'event', source: 'NASA EONET', on: true },
  { id: 'volcanoes', label: 'Volcanoes', kind: 'volcano', source: 'USGS', on: true },
  { id: 'alerts', label: 'Weather alerts', kind: 'alert', source: 'NWS', on: true },
  { id: 'weather', label: 'Air & weather', kind: 'air', source: 'Open-Meteo', on: false },
  { id: 'orbit', label: 'ISS', kind: 'orbit', source: 'wheretheiss.at', on: true },
  // No flights layer: every keyless live-flight API (OpenSky, adsb.lol,
  // adsb.fi) is CORS-blocked in the browser. Revisit once the daemon can
  // proxy — mock planes are worse than no planes.
];

interface Item {
  id: string;
  layer: LayerId;
  kind: MarkerKind;
  lat: number;
  lng: number;
  /** Left column of the row — the headline number. */
  value: string;
  /** The place / subject. */
  title: string;
  /** Right-aligned meta, e.g. age. */
  meta: string;
  /** Expanded facts on focus. Real measurements only. */
  facts: Array<[string, string]>;
}

const num = new Intl.NumberFormat('en-US');
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function ago(t: number): string {
  if (!t) return '—';
  const m = Math.max(0, Math.floor((Date.now() - t) / 60_000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const coords = (lat: number, lng: number) =>
  `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(1)}°${lng >= 0 ? 'E' : 'W'}`;

function categoryLabel(value: string): string {
  switch (value) {
    case 'wildfires':
      return 'Wildfire';
    case 'severeStorms':
      return 'Storm';
    case 'volcanoes':
      return 'Volcano';
    case 'floods':
      return 'Flood';
    default:
      return 'Event';
  }
}

function weatherLabel(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Cloud';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 95) return 'Storm';
  return '—';
}

/** Build every layer's rows from the snapshot. Values only — no narration. */
function buildItems(s: SituationSnapshot): Item[] {
  const out: Item[] = [];

  for (const q of s.quakes.slice(0, 12)) {
    out.push({
      id: `quake-${q.id}`,
      layer: 'quakes',
      kind: 'quake',
      lat: q.lat,
      lng: q.lng,
      value: `M${q.magnitude.toFixed(1)}`,
      title: q.place,
      meta: ago(q.occurredAt),
      facts: [
        ['Depth', `${q.depthKm.toFixed(0)} km`],
        ['Position', coords(q.lat, q.lng)],
        ['Source', 'USGS'],
      ],
    });
  }

  for (const e of s.events.slice(0, 10)) {
    out.push({
      id: `event-${e.id}`,
      layer: 'events',
      kind: 'event',
      lat: e.lat,
      lng: e.lng,
      value: categoryLabel(e.category),
      title: e.title,
      meta: ago(e.occurredAt),
      facts: [
        ['Position', coords(e.lat, e.lng)],
        ['Source', 'NASA EONET'],
      ],
    });
  }

  for (const v of s.volcanoes.slice(0, 8)) {
    out.push({
      id: `volcano-${v.id}`,
      layer: 'volcanoes',
      kind: 'volcano',
      lat: v.lat,
      lng: v.lng,
      value: v.alert,
      title: v.name,
      meta: v.region,
      facts: [
        ['Alert level', v.alert],
        ['Position', coords(v.lat, v.lng)],
        ['Source', 'USGS'],
      ],
    });
  }

  for (const a of s.alerts.filter((x) => x.lat !== null && x.lng !== null).slice(0, 10)) {
    out.push({
      id: `alert-${a.id}`,
      layer: 'alerts',
      kind: 'alert',
      lat: a.lat ?? 0,
      lng: a.lng ?? 0,
      value: a.severity,
      title: a.event,
      meta: ago(a.sentAt),
      facts: [
        ['Area', a.area],
        ['Source', 'US National Weather Service'],
      ],
    });
  }

  const airByName = new Map(s.air.map((c) => [c.name, c]));
  for (const w of s.weather) {
    const air = airByName.get(w.name);
    out.push({
      id: `air-${w.name}`,
      layer: 'weather',
      kind: 'air',
      lat: w.lat,
      lng: w.lng,
      value: `${Math.round(w.tempC)}°C`,
      title: w.name,
      meta: weatherLabel(w.code),
      facts: [
        ['Wind', `${Math.round(w.windKph)} km/h`],
        ['AQI', air ? String(Math.round(air.aqi)) : '—'],
        ['PM2.5', air?.pm25 == null ? '—' : `${air.pm25.toFixed(1)} µg/m³`],
      ],
    });
  }

  if (s.iss) {
    out.push({
      id: 'orbit-iss',
      layer: 'orbit',
      kind: 'orbit',
      lat: s.iss.lat,
      lng: s.iss.lng,
      value: `${num.format(Math.round(s.iss.velocityKph))} km/h`,
      title: 'ISS',
      meta: ago(s.iss.observedAt),
      facts: [
        ['Altitude', `${s.iss.altitudeKm.toFixed(0)} km`],
        ['Position', coords(s.iss.lat, s.iss.lng)],
        ['Orbit', '~92 min'],
      ],
    });
  }

  return out;
}

function LayerToggle({
  layer,
  on,
  count,
  onToggle,
  autoFocus,
}: {
  layer: LayerDef;
  on: boolean;
  count: number;
  onToggle: (id: LayerId) => void;
  autoFocus: boolean;
}) {
  const accept = useCallback(() => onToggle(layer.id), [layer.id, onToggle]);
  const { ref, focused } = useFocusable({
    id: `situation-layer-${layer.id}`,
    scope: 'situation',
    onAccept: accept,
    autoFocus,
  });

  return (
    <button
      ref={ref}
      type="button"
      className="situation-layer"
      data-on={on ? 'true' : 'false'}
      data-focused={focused ? 'true' : 'false'}
      data-kind={layer.kind}
      aria-pressed={on}
      onClick={accept}
    >
      <span className="situation-layer__dot" aria-hidden="true" />
      <span className="situation-layer__label">{layer.label}</span>
      <span className="situation-layer__count">{count}</span>
    </button>
  );
}

function EventRow({
  item,
  onFocused,
  autoFocus,
}: {
  item: Item;
  onFocused: (id: string) => void;
  autoFocus: boolean;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const { ref, focused } = useFocusable({
    id: `situation-item-${item.id}`,
    scope: 'situation',
    autoFocus,
  });

  useEffect(() => {
    if (!focused) return;
    onFocused(item.id);
    // The list is taller than the panel; keep the focused row in view.
    glideIntoView(elRef.current, { block: 'nearest' });
  }, [focused, item.id, onFocused]);

  return (
    <div
      ref={(el) => {
        elRef.current = el;
        ref(el);
      }}
      className="situation-row"
      data-focused={focused ? 'true' : 'false'}
      data-kind={item.kind}
    >
      <span className="situation-row__value">{item.value}</span>
      <span className="situation-row__title">{item.title}</span>
      <span className="situation-row__meta">{item.meta}</span>
      {focused && (
        <dl className="situation-row__facts">
          {item.facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

interface IssFix {
  lat: number;
  lng: number;
  altitudeKm: number;
  velocityKph: number;
  observedAt: number;
}

/**
 * The ISS crosses ~7.7 km every second, so the shared 10-minute snapshot
 * refresh leaves it thousands of km stale. It gets its own fast poll.
 * wheretheiss.at is keyless and CORS-open (verified).
 */
function useLiveIss(): IssFix | null {
  const [fix, setFix] = useState<IssFix | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        setFix({
          lat: j.latitude,
          lng: j.longitude,
          altitudeKm: j.altitude,
          velocityKph: j.velocity,
          observedAt: Date.now(),
        });
      } catch {
        /* keep the last fix; the channel stays calm when offline */
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return fix;
}

interface MarketCell {
  key: string;
  label: string;
  value: string;
  trend?: 'up' | 'down';
}

/**
 * Extra markets for the ticker.
 *
 * Verified from the browser: CoinGecko and open.er-api.com are keyless and
 * CORS-open. Equities and real commodity futures (S&P 500, WTI, COMEX gold)
 * are NOT reachable client-side — Yahoo, Stooq, Binance and CoinCap all fail
 * CORS. Gold here is tokenized gold (PAX Gold / Tether Gold), which tracks
 * spot closely and is labelled as such rather than passed off as XAU.
 * TODO(daemon): proxy Stooq/Yahoo for ^SPX, CL=F and true XAU spot.
 */
function useMarkets(): MarketCell[] {
  const [cells, setCells] = useState<MarketCell[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next: MarketCell[] = [];

      try {
        const r = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd&include_24hr_change=true',
        );
        if (r.ok) {
          const j = await r.json();
          const g = j['pax-gold'];
          if (g?.usd) {
            next.push({
              key: 'gold',
              label: 'GOLD (PAXG)',
              value: `$${Math.round(g.usd).toLocaleString()}  ${g.usd_24h_change >= 0 ? '▲' : '▼'}${Math.abs(g.usd_24h_change ?? 0).toFixed(1)}%`,
              trend: (g.usd_24h_change ?? 0) >= 0 ? 'up' : 'down',
            });
          }
        }
      } catch {
        /* ignore */
      }

      try {
        const r = await fetch('https://open.er-api.com/v6/latest/USD');
        if (r.ok) {
          const j = await r.json();
          for (const [code, label] of [
            ['EUR', 'USD/EUR'],
            ['GBP', 'USD/GBP'],
            ['JPY', 'USD/JPY'],
          ] as const) {
            const rate = j?.rates?.[code];
            if (typeof rate === 'number') {
              next.push({
                key: `fx-${code}`,
                label,
                value: code === 'JPY' ? rate.toFixed(1) : rate.toFixed(3),
              });
            }
          }
        }
      } catch {
        /* ignore */
      }

      if (!cancelled) setCells(next);
    };

    void load();
    const timer = window.setInterval(() => void load(), 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return cells;
}

const EMPTY: SituationSnapshot = {
  version: 1,
  updatedAt: 0,
  quakes: [],
  events: [],
  volcanoes: [],
  alerts: [],
  gauges: [],
  weather: [],
  air: [],
  iss: null,
  stories: [],
  coins: [],
};

export function SituationChannel() {
  const cached = useMemo(() => readSituationCache(), []);
  const [snapshot, setSnapshot] = useState<SituationSnapshot>(cached ?? EMPTY);
  const [reached, setReached] = useState<number | null>(null);
  const [enabled, setEnabled] = useState<Set<LayerId>>(
    () => new Set(LAYERS.filter((l) => l.on).map((l) => l.id)),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      el.animate(
        reduced
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: `translate3d(${tuning.drillSlidePx}px,0,0)` },
              { opacity: 1, transform: 'translate3d(0,0,0)' },
            ],
        { duration: reduced ? 80 : tuning.drillInMs, easing: tuning.drillInEase },
      );
    } catch {
      /* decorative */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let current = cached;
    const refresh = async () => {
      const result = await loadSituationData(current);
      if (cancelled) return;
      current = result.snapshot;
      setSnapshot(result.snapshot);
      setReached(result.reached.length);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [cached]);

  const liveIss = useLiveIss();
  const markets = useMarkets();

  // The fast ISS poll wins over the 10-minute snapshot's stale fix.
  const merged = useMemo<SituationSnapshot>(
    () => (liveIss ? { ...snapshot, iss: liveIss } : snapshot),
    [snapshot, liveIss],
  );

  const all = useMemo(() => buildItems(merged), [merged]);
  const counts = useMemo(() => {
    const m = new Map<LayerId, number>();
    for (const i of all) m.set(i.layer, (m.get(i.layer) ?? 0) + 1);
    return m;
  }, [all]);
  const items = useMemo(() => all.filter((i) => enabled.has(i.layer)), [all, enabled]);

  const toggle = useCallback((id: LayerId) => {
    sound.play('accept');
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const tickerCells = useMemo(() => {
    const cells: Array<{
      key: string;
      label: string;
      value: string;
      trend?: 'up' | 'down';
    }> = [...markets];
    for (const c of snapshot.coins) cells.push({
      key: c.id,
      label: c.id === 'bitcoin' ? 'BTC' : c.id === 'ethereum' ? 'ETH' : c.id.toUpperCase(),
      value: `${usd.format(c.usd)}  ${c.change24h >= 0 ? '▲' : '▼'}${Math.abs(c.change24h).toFixed(1)}%`,
      trend: c.change24h >= 0 ? ('up' as const) : ('down' as const),
    });
    for (const story of snapshot.stories.slice(0, 10)) {
      cells.push({ key: `hn-${story.id}`, label: 'HN', value: story.title });
    }
    return cells.length ? cells : [{ key: 'idle', label: '', value: 'Waiting for feeds…' }];
  }, [markets, snapshot.coins, snapshot.stories]);

  const markers: SituationMarker[] = items.map((i) => ({
    id: i.id,
    lat: i.lat,
    lng: i.lng,
    kind: i.kind,
  }));
  const traces: SituationTrace[] = [];

  const accent = channelById('situation')?.accent;
  const style = {
    '--accent': accent,
    '--situation-focus-ms': `${tuning.focusMoveMs}ms`,
    '--situation-ease': tuning.focusEase,
    '--situation-settle-ms': `${tuning.settleFadeMs}ms`,
    '--ambient-slow-ms': `${tuning.settleFadeMs * 20}ms`,
    '--ambient-orbit-ms': `${tuning.settleFadeMs * 13}ms`,
  } as CSSProperties;

  return (
    <section className="situation" ref={rootRef} style={style}>
      <div className="situation__wash" aria-hidden="true" />

      <aside className="situation-layers" aria-label="Layers">
        {LAYERS.map((layer, index) => (
          <LayerToggle
            key={layer.id}
            layer={layer}
            on={enabled.has(layer.id)}
            count={counts.get(layer.id) ?? 0}
            onToggle={toggle}
            autoFocus={index === 0}
          />
        ))}
        <span className="situation-sources">
          {reached === null ? '—' : `${reached}/${SITUATION_SOURCE_COUNT} sources`}
        </span>
      </aside>

      <div className="situation-globe-wrap">
        <SituationGlobe
          markers={markers}
          traces={traces}
          selectedId={selectedId}
          scene="pulse"
        />
      </div>

      <div className="situation-list" role="list">
        {items.map((item, index) => (
          <EventRow
            key={item.id}
            item={item}
            onFocused={setSelectedId}
            autoFocus={index === 0 && !LAYERS.length}
          />
        ))}
      </div>

      {/* Locationless data belongs on a ticker, not pinned to fake
          coordinates on the globe. Crypto is live (CoinGecko, keyless);
          TODO(daemon): equities need a proxy — browser-side quote APIs are
          either keyed or CORS-blocked. */}
      <div className="situation-ticker" aria-hidden="true">
        <div className="situation-ticker__track">
          {[...tickerCells, ...tickerCells].map((cell, i) => (
            <span className="situation-ticker__cell" key={`${cell.key}-${i}`}>
              <span className="situation-ticker__label">{cell.label}</span>
              <span
                className="situation-ticker__value"
                data-trend={cell.trend ?? 'flat'}
              >
                {cell.value}
              </span>
            </span>
          ))}
        </div>
      </div>

      <footer className="situation-hints glass">
        <span className="situation-hint">
          <span className="situation-hint__badge" aria-hidden="true">A</span>
          Toggle layer
        </span>
        <span className="situation-hint">
          <span className="situation-hint__badge" aria-hidden="true">B</span>
          Back
        </span>
      </footer>
    </section>
  );
}
