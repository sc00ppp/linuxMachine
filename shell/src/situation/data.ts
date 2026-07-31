/**
 * Browser-safe data layer for the Situation channel.
 *
 * The desktop app routes every request through Tauri to sidestep CORS. This
 * port deliberately talks only to credential-free providers that are useful
 * from a normal browser. Each request settles independently so one sleeping
 * upstream never takes the whole channel with it.
 */

const CACHE_KEY = 'console:situation:last-good:v1';
const REQUEST_TIMEOUT_MS = 9_000;

export const SITUATION_SOURCE_COUNT = 10;

export interface Quake {
  id: string;
  magnitude: number;
  place: string;
  occurredAt: number;
  lat: number;
  lng: number;
  depthKm: number;
}

export interface NaturalEvent {
  id: string;
  title: string;
  category: string;
  occurredAt: number;
  lat: number;
  lng: number;
}

export interface Volcano {
  id: string;
  name: string;
  alert: string;
  region: string;
  lat: number;
  lng: number;
}

export interface WeatherAlert {
  id: string;
  event: string;
  area: string;
  severity: string;
  sentAt: number;
  lat: number | null;
  lng: number | null;
}

export interface FloodGauge {
  id: string;
  name: string;
  state: string;
  category: string;
  lat: number;
  lng: number;
}

export interface CityWeather {
  name: string;
  lat: number;
  lng: number;
  tempC: number;
  windKph: number;
  code: number;
}

export interface CityAir {
  name: string;
  lat: number;
  lng: number;
  aqi: number;
  pm25: number | null;
}

export interface IssPosition {
  lat: number;
  lng: number;
  altitudeKm: number;
  velocityKph: number;
  observedAt: number;
}

export interface SignalStory {
  id: number;
  title: string;
  score: number;
  comments: number;
}

export interface CoinSignal {
  id: string;
  symbol: string;
  usd: number;
  change24h: number;
}

export interface SituationSnapshot {
  version: 1;
  updatedAt: number;
  quakes: Quake[];
  events: NaturalEvent[];
  volcanoes: Volcano[];
  alerts: WeatherAlert[];
  gauges: FloodGauge[];
  weather: CityWeather[];
  air: CityAir[];
  iss: IssPosition | null;
  stories: SignalStory[];
  coins: CoinSignal[];
}

export interface SituationLoadResult {
  snapshot: SituationSnapshot;
  reached: string[];
  missed: string[];
}

export interface TrafficTrack {
  id: string;
  callsign: string;
  from: string;
  to: string;
  altitude: string;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
}

/**
 * TODO(daemon): OpenSky's global state feed was anonymous in the desktop app,
 * but it is too large and not reliably CORS-accessible from a TV WebView.
 * Replace this representative route shape with a small daemon-normalized feed.
 */
export const MOCK_TRAFFIC: TrafficTrack[] = [
  {
    id: 'traffic-atlantic',
    callsign: 'NIGHT 28',
    from: 'New York',
    to: 'London',
    altitude: '11.3 km',
    start: { lat: 40.7, lng: -74 },
    end: { lat: 51.5, lng: -0.1 },
  },
  {
    id: 'traffic-pacific',
    callsign: 'PACIFIC 6',
    from: 'Tokyo',
    to: 'Seattle',
    altitude: '10.8 km',
    start: { lat: 35.7, lng: 139.7 },
    end: { lat: 47.6, lng: -122.3 },
  },
  {
    id: 'traffic-south',
    callsign: 'SOUTHERN 41',
    from: 'Sydney',
    to: 'Singapore',
    altitude: '10.5 km',
    start: { lat: -33.9, lng: 151.2 },
    end: { lat: 1.4, lng: 103.8 },
  },
  {
    id: 'traffic-equator',
    callsign: 'EQUATOR 12',
    from: 'Nairobi',
    to: 'Mumbai',
    altitude: '11.0 km',
    start: { lat: -1.3, lng: 36.8 },
    end: { lat: 19.1, lng: 72.9 },
  },
  {
    id: 'traffic-andes',
    callsign: 'ANDEAN 9',
    from: 'Santiago',
    to: 'Lima',
    altitude: '9.8 km',
    start: { lat: -33.4, lng: -70.7 },
    end: { lat: -12, lng: -77 },
  },
];

const WORLD_CITIES = [
  { name: 'Vancouver', lat: 49.28, lng: -123.12 },
  { name: 'New York', lat: 40.71, lng: -74.01 },
  { name: 'Mexico City', lat: 19.43, lng: -99.13 },
  { name: 'São Paulo', lat: -23.55, lng: -46.63 },
  { name: 'London', lat: 51.51, lng: -0.13 },
  { name: 'Cairo', lat: 30.04, lng: 31.24 },
  { name: 'Nairobi', lat: -1.29, lng: 36.82 },
  { name: 'Delhi', lat: 28.61, lng: 77.21 },
  { name: 'Beijing', lat: 39.9, lng: 116.4 },
  { name: 'Tokyo', lat: 35.68, lng: 139.65 },
  { name: 'Jakarta', lat: -6.21, lng: 106.85 },
  { name: 'Sydney', lat: -33.87, lng: 151.21 },
  { name: 'Reykjavík', lat: 64.15, lng: -21.94 },
  { name: 'Cape Town', lat: -33.92, lng: 18.42 },
] as const;

type UnknownRecord = Record<string, unknown>;

function emptySnapshot(): SituationSnapshot {
  return {
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
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function dateValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...init?.headers,
      },
    });
    if (!response.ok) throw new Error('upstream unavailable');
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

interface Settled<T> {
  ok: boolean;
  data: T | null;
}

async function settle<T>(request: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, data: await request };
  } catch {
    return { ok: false, data: null };
  }
}

export function readSituationCache(): SituationSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? 'null');
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      typeof value.updatedAt !== 'number' ||
      !Array.isArray(value.quakes) ||
      !Array.isArray(value.events) ||
      !Array.isArray(value.volcanoes) ||
      !Array.isArray(value.alerts) ||
      !Array.isArray(value.gauges) ||
      !Array.isArray(value.weather) ||
      !Array.isArray(value.air) ||
      !Array.isArray(value.stories) ||
      !Array.isArray(value.coins)
    ) {
      return null;
    }
    return value as unknown as SituationSnapshot;
  } catch {
    return null;
  }
}

function writeSituationCache(snapshot: SituationSnapshot): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // The in-memory picture is still useful if storage is full or disabled.
  }
}

export async function loadSituationData(
  cached: SituationSnapshot | null,
): Promise<SituationLoadResult> {
  const base = cached ?? emptySnapshot();
  const [
    quakes,
    events,
    volcanoes,
    alerts,
    gauges,
    weather,
    air,
    iss,
    stories,
    coins,
  ] = await Promise.all([
    settle(fetchQuakes()),
    settle(fetchNaturalEvents()),
    settle(fetchVolcanoes()),
    settle(fetchWeatherAlerts()),
    settle(fetchFloodGauges()),
    settle(fetchWorldWeather()),
    settle(fetchWorldAir()),
    settle(fetchIss()),
    settle(fetchStories()),
    settle(fetchCoins()),
  ]);

  const outcomes = [
    ['USGS earthquakes', quakes.ok],
    ['NASA natural events', events.ok],
    ['USGS volcanoes', volcanoes.ok],
    ['NWS alerts', alerts.ok],
    ['NOAA flood gauges', gauges.ok],
    ['Open-Meteo weather', weather.ok],
    ['Open-Meteo air', air.ok],
    ['ISS position', iss.ok],
    ['Hacker News', stories.ok],
    ['CoinGecko', coins.ok],
  ] as const;
  const reached = outcomes.filter(([, ok]) => ok).map(([name]) => name);
  const missed = outcomes.filter(([, ok]) => !ok).map(([name]) => name);

  const snapshot: SituationSnapshot = {
    version: 1,
    updatedAt: reached.length > 0 ? Date.now() : base.updatedAt,
    quakes: quakes.data ?? base.quakes,
    events: events.data ?? base.events,
    volcanoes: volcanoes.data ?? base.volcanoes,
    alerts: alerts.data ?? base.alerts,
    gauges: gauges.data ?? base.gauges,
    weather: weather.data ?? base.weather,
    air: air.data ?? base.air,
    iss: iss.data ?? base.iss,
    stories: stories.data ?? base.stories,
    coins: coins.data ?? base.coins,
  };

  if (reached.length > 0) writeSituationCache(snapshot);
  return { snapshot, reached, missed };
}

async function fetchQuakes(): Promise<Quake[]> {
  interface RawFeature {
    id?: unknown;
    properties?: UnknownRecord;
    geometry?: { coordinates?: unknown[] };
  }
  const response = await fetchJson<{ features?: RawFeature[] }>(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
  );
  return (response.features ?? [])
    .map((feature): Quake | null => {
      const coordinates = feature.geometry?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 3) return null;
      const properties = feature.properties ?? {};
      return {
        id: stringValue(feature.id, `quake-${coordinates.join('-')}`),
        magnitude: numberValue(properties.mag),
        place: stringValue(properties.place, 'A quiet place offshore'),
        occurredAt: numberValue(properties.time),
        lng: numberValue(coordinates[0]),
        lat: numberValue(coordinates[1]),
        depthKm: numberValue(coordinates[2]),
      };
    })
    .filter((quake): quake is Quake => quake !== null)
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 24);
}

function coordinatesFromGeometry(input: unknown, output: Array<[number, number]>): void {
  if (!Array.isArray(input)) return;
  if (
    input.length >= 2 &&
    typeof input[0] === 'number' &&
    typeof input[1] === 'number'
  ) {
    output.push([input[0], input[1]]);
    return;
  }
  for (const child of input) coordinatesFromGeometry(child, output);
}

function geometryCenter(coordinates: unknown): { lat: number; lng: number } | null {
  const points: Array<[number, number]> = [];
  coordinatesFromGeometry(coordinates, points);
  if (points.length === 0) return null;
  const total = points.reduce(
    (sum, [lng, lat]) => ({ lng: sum.lng + lng, lat: sum.lat + lat }),
    { lat: 0, lng: 0 },
  );
  return { lat: total.lat / points.length, lng: total.lng / points.length };
}

async function fetchNaturalEvents(): Promise<NaturalEvent[]> {
  interface RawEvent {
    id?: unknown;
    title?: unknown;
    categories?: Array<{ id?: unknown }>;
    geometry?: Array<{ date?: unknown; coordinates?: unknown }>;
  }
  const response = await fetchJson<{ events?: RawEvent[] }>(
    'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=250',
  );
  const allowed = new Set(['wildfires', 'severeStorms', 'volcanoes', 'floods']);
  return (response.events ?? [])
    .map((event): NaturalEvent | null => {
      const category = event.categories?.find((item) => allowed.has(stringValue(item.id)));
      const latest = event.geometry?.at(-1);
      const center = geometryCenter(latest?.coordinates);
      if (!category || !latest || !center) return null;
      const title = stringValue(event.title, 'Open natural event');
      if (title.toLowerCase().includes('prescribed fire')) return null;
      return {
        id: stringValue(event.id, `event-${title}`),
        title,
        category: stringValue(category.id, 'event'),
        occurredAt: dateValue(latest.date),
        ...center,
      };
    })
    .filter((event): event is NaturalEvent => event !== null)
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .slice(0, 32);
}

function volcanoRank(alert: string, color: string): number {
  const value = `${alert} ${color}`.toLowerCase();
  if (value.includes('warning') || value.includes('red')) return 4;
  if (value.includes('watch') || value.includes('orange')) return 3;
  if (value.includes('advisory') || value.includes('yellow')) return 2;
  return 0;
}

async function fetchVolcanoes(): Promise<Volcano[]> {
  interface RawVolcano {
    geometry?: { coordinates?: unknown[] };
    properties?: UnknownRecord;
  }
  const response = await fetchJson<{ features?: RawVolcano[] }>(
    'https://volcanoes.usgs.gov/vsc/api/volcanoApi/geojson',
  );
  return (response.features ?? [])
    .map((feature): (Volcano & { rank: number }) | null => {
      const coordinates = feature.geometry?.coordinates;
      if (!Array.isArray(coordinates)) return null;
      const properties = feature.properties ?? {};
      const alert = stringValue(properties.alertLevel, 'Unassigned');
      const color = stringValue(properties.colorCode, 'Unassigned');
      const rank = volcanoRank(alert, color);
      if (rank < 2) return null;
      return {
        id: stringValue(
          properties.vnum,
          stringValue(properties.volcanoName, `volcano-${coordinates.join('-')}`),
        ),
        name: stringValue(properties.volcanoName, 'Unnamed volcano'),
        alert: `${alert} / ${color}`,
        region: stringValue(properties.region, 'Unknown region'),
        lng: numberValue(coordinates[0]),
        lat: numberValue(coordinates[1]),
        rank,
      };
    })
    .filter((volcano): volcano is Volcano & { rank: number } => volcano !== null)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 18)
    .map(({ rank: _rank, ...volcano }) => volcano);
}

function severityRank(value: string): number {
  switch (value.toLowerCase()) {
    case 'extreme':
      return 5;
    case 'severe':
      return 4;
    case 'moderate':
      return 3;
    case 'minor':
      return 2;
    default:
      return 1;
  }
}

async function fetchWeatherAlerts(): Promise<WeatherAlert[]> {
  interface RawAlert {
    id?: unknown;
    geometry?: { coordinates?: unknown } | null;
    properties?: UnknownRecord;
  }
  const response = await fetchJson<{ features?: RawAlert[] }>(
    'https://api.weather.gov/alerts/active',
    { headers: { Accept: 'application/geo+json' } },
  );
  return (response.features ?? [])
    .map((feature): (WeatherAlert & { rank: number }) | null => {
      const properties = feature.properties ?? {};
      if (stringValue(properties.status, 'Actual') !== 'Actual') return null;
      const center = geometryCenter(feature.geometry?.coordinates);
      const severity = stringValue(properties.severity, 'Unknown');
      return {
        id: stringValue(properties.id, stringValue(feature.id, 'weather-alert')),
        event: stringValue(properties.event, 'Weather alert'),
        area: stringValue(properties.areaDesc, 'United States'),
        severity,
        sentAt: dateValue(properties.sent),
        lat: center?.lat ?? null,
        lng: center?.lng ?? null,
        rank: severityRank(severity),
      };
    })
    .filter((alert): alert is WeatherAlert & { rank: number } => alert !== null)
    .sort((a, b) => b.rank - a.rank || b.sentAt - a.sentAt)
    .slice(0, 24)
    .map(({ rank: _rank, ...alert }) => alert);
}

function floodRank(value: string): number {
  switch (value.toLowerCase()) {
    case 'record':
      return 6;
    case 'major':
      return 5;
    case 'moderate':
      return 4;
    case 'minor':
      return 3;
    case 'action':
    case 'near_flood':
      return 2;
    default:
      return 0;
  }
}

async function fetchFloodGauges(): Promise<FloodGauge[]> {
  interface RawGauge {
    lid?: unknown;
    name?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    state?: { abbreviation?: unknown };
    status?: {
      observed?: { floodCategory?: unknown };
      forecast?: { floodCategory?: unknown };
    };
  }
  const response = await fetchJson<{ gauges?: RawGauge[] }>(
    'https://api.water.noaa.gov/nwps/v1/gauges' +
      '?bbox.xmin=-124.9&bbox.ymin=24.4&bbox.xmax=-66.9&bbox.ymax=49.6&srid=EPSG_4326',
  );
  return (response.gauges ?? [])
    .map((gauge): (FloodGauge & { rank: number }) | null => {
      const observed = stringValue(gauge.status?.observed?.floodCategory, 'unknown');
      const forecast = stringValue(gauge.status?.forecast?.floodCategory, 'unknown');
      const category =
        floodRank(observed) >= floodRank(forecast) ? observed : forecast;
      const rank = floodRank(category);
      if (rank === 0) return null;
      return {
        id: stringValue(gauge.lid, `gauge-${gauge.latitude}-${gauge.longitude}`),
        name: stringValue(gauge.name, 'River gauge'),
        state: stringValue(gauge.state?.abbreviation),
        category,
        lat: numberValue(gauge.latitude),
        lng: numberValue(gauge.longitude),
        rank,
      };
    })
    .filter((gauge): gauge is FloodGauge & { rank: number } => gauge !== null)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 24)
    .map(({ rank: _rank, ...gauge }) => gauge);
}

function normalizedBatch<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

async function fetchWorldWeather(): Promise<CityWeather[]> {
  interface RawWeather {
    current_weather?: UnknownRecord;
  }
  const latitude = WORLD_CITIES.map((city) => city.lat).join(',');
  const longitude = WORLD_CITIES.map((city) => city.lng).join(',');
  const response = await fetchJson<RawWeather | RawWeather[]>(
    'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${latitude}&longitude=${longitude}&current_weather=true`,
  );
  const rows = normalizedBatch(response);
  return WORLD_CITIES.map((city, index) => {
    const current = rows[index]?.current_weather ?? {};
    return {
      ...city,
      tempC: numberValue(current.temperature),
      windKph: numberValue(current.windspeed),
      code: numberValue(current.weathercode, -1),
    };
  });
}

async function fetchWorldAir(): Promise<CityAir[]> {
  interface RawAir {
    current?: UnknownRecord;
  }
  const latitude = WORLD_CITIES.map((city) => city.lat).join(',');
  const longitude = WORLD_CITIES.map((city) => city.lng).join(',');
  const response = await fetchJson<RawAir | RawAir[]>(
    'https://air-quality-api.open-meteo.com/v1/air-quality' +
      `?latitude=${latitude}&longitude=${longitude}&current=us_aqi,pm2_5&forecast_days=1`,
  );
  const rows = normalizedBatch(response);
  return WORLD_CITIES.map((city, index) => {
    const current = rows[index]?.current ?? {};
    const pm25 = numberValue(current.pm2_5, Number.NaN);
    return {
      ...city,
      aqi: numberValue(current.us_aqi),
      pm25: Number.isFinite(pm25) ? pm25 : null,
    };
  }).sort((a, b) => b.aqi - a.aqi);
}

async function fetchIss(): Promise<IssPosition> {
  const response = await fetchJson<UnknownRecord>(
    'https://api.wheretheiss.at/v1/satellites/25544',
  );
  return {
    lat: numberValue(response.latitude),
    lng: numberValue(response.longitude),
    altitudeKm: numberValue(response.altitude),
    velocityKph: numberValue(response.velocity),
    observedAt: numberValue(response.timestamp) * 1000 || Date.now(),
  };
}

async function fetchStories(): Promise<SignalStory[]> {
  const ids = await fetchJson<number[]>(
    'https://hacker-news.firebaseio.com/v0/topstories.json',
  );
  const results = await Promise.all(
    ids.slice(0, 7).map((id) =>
      settle(
        fetchJson<UnknownRecord>(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
        ),
      ),
    ),
  );
  return results
    .map((result): SignalStory | null => {
      if (!result.data) return null;
      return {
        id: numberValue(result.data.id),
        title: stringValue(result.data.title, 'A new signal'),
        score: numberValue(result.data.score),
        comments: numberValue(result.data.descendants),
      };
    })
    .filter((story): story is SignalStory => story !== null);
}

async function fetchCoins(): Promise<CoinSignal[]> {
  interface RawCoin {
    usd?: unknown;
    usd_24h_change?: unknown;
  }
  const response = await fetchJson<Record<string, RawCoin>>(
    'https://api.coingecko.com/api/v3/simple/price' +
      '?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true',
  );
  return [
    { id: 'bitcoin', symbol: 'BTC' },
    { id: 'ethereum', symbol: 'ETH' },
    { id: 'solana', symbol: 'SOL' },
  ].map((coin) => ({
    ...coin,
    usd: numberValue(response[coin.id]?.usd),
    change24h: numberValue(response[coin.id]?.usd_24h_change),
  }));
}
