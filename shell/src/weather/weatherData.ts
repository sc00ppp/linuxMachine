export type WeatherKind =
  | 'clear'
  | 'cloud'
  | 'rain'
  | 'snow'
  | 'storm'
  | 'fog';

export interface WeatherLocation {
  id: string;
  name: string;
  detail: string;
  latitude: number;
  longitude: number;
  detected?: boolean;
}

export interface WeatherHour {
  time: string;
  temperature: number;
  weatherCode: number;
  kind: WeatherKind;
  condition: string;
  precipitationChance: number;
  isDay: boolean;
}

export interface WeatherDay {
  date: string;
  weatherCode: number;
  kind: WeatherKind;
  condition: string;
  high: number;
  low: number;
  precipitationChance: number;
  sunrise: string;
  sunset: string;
}

export interface WeatherPayload {
  location: WeatherLocation;
  timezone: string;
  fetchedAt: number;
  current: {
    temperature: number;
    apparentTemperature: number;
    weatherCode: number;
    kind: WeatherKind;
    condition: string;
    isDay: boolean;
    windSpeed: number;
  };
  hours: WeatherHour[];
  days: WeatherDay[];
}

export const DEFAULT_LOCATION: WeatherLocation = {
  id: 'new-york',
  name: 'New York',
  detail: 'New York, USA',
  latitude: 40.7128,
  longitude: -74.006,
};

export const CITIES_STORAGE_KEY = 'console-weather-cities';

const SELECTED_CITY_KEY = 'console-weather-selected-city';
const WEATHER_CACHE_KEY = 'console-weather-cache:v2';

type OpenMeteoResponse = {
  timezone?: unknown;
  current?: {
    temperature_2m?: unknown;
    apparent_temperature?: unknown;
    weather_code?: unknown;
    is_day?: unknown;
    wind_speed_10m?: unknown;
  };
  hourly?: {
    time?: unknown;
    temperature_2m?: unknown;
    weather_code?: unknown;
    precipitation_probability?: unknown;
    is_day?: unknown;
  };
  daily?: {
    time?: unknown;
    weather_code?: unknown;
    temperature_2m_max?: unknown;
    temperature_2m_min?: unknown;
    precipitation_probability_max?: unknown;
    sunrise?: unknown;
    sunset?: unknown;
  };
};

type GeocodingResponse = { results?: unknown };

type GeocodingResult = {
  id?: unknown;
  name?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  admin1?: unknown;
  country?: unknown;
};

type WeatherCacheEnvelope = {
  version: 2;
  payloads: Record<string, WeatherPayload>;
};

export function weatherKind(code: number): WeatherKind {
  if (code === 45 || code === 48) return 'fog';
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code >= 1 && code <= 3) return 'cloud';
  return 'clear';
}

export function conditionFor(code: number, isDay = true): string {
  const labels: Record<number, string> = {
    0: isDay ? 'Clear and bright' : 'Clear night',
    1: isDay ? 'Mostly sunny' : 'Mostly clear',
    2: 'Partly cloudy',
    3: 'Cloudy',
    45: 'Soft fog',
    48: 'Frosty fog',
    51: 'Light drizzle',
    53: 'Drizzle',
    55: 'Steady drizzle',
    56: 'Freezing drizzle',
    57: 'Freezing drizzle',
    61: 'Light rain',
    63: 'Rain',
    65: 'Heavy rain',
    66: 'Freezing rain',
    67: 'Heavy freezing rain',
    71: 'Light snow',
    73: 'Snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Passing showers',
    81: 'Rain showers',
    82: 'Heavy showers',
    85: 'Snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorms',
    96: 'Storms with hail',
    99: 'Strong storms with hail',
  };
  return labels[code] ?? 'Changing skies';
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid weather field: ${field}`);
  }
  return value;
}

function numberArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    throw new Error(`Invalid weather field: ${field}`);
  }
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`Invalid weather field: ${field}`);
  }
  return value;
}

/** Validate Open-Meteo's aligned arrays before they reach the TV room. */
export async function fetchWeather(
  location: WeatherLocation,
  signal: AbortSignal,
): Promise<WeatherPayload> {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    forecast_days: '7',
    forecast_hours: '24',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, { signal });
  if (!response.ok) throw new Error('Weather service unavailable');

  const raw = (await response.json()) as OpenMeteoResponse;
  if (!raw.current || !raw.hourly || !raw.daily) throw new Error('Incomplete weather response');

  const hourTimes = stringArray(raw.hourly.time, 'hourly.time');
  const hourTemperatures = numberArray(raw.hourly.temperature_2m, 'hourly.temperature_2m');
  const hourCodes = numberArray(raw.hourly.weather_code, 'hourly.weather_code');
  const hourPrecipitation = numberArray(raw.hourly.precipitation_probability, 'hourly.precipitation_probability');
  const hourDaylight = numberArray(raw.hourly.is_day, 'hourly.is_day');
  const hourCount = Math.min(24, hourTimes.length, hourTemperatures.length, hourCodes.length, hourPrecipitation.length, hourDaylight.length);
  if (hourCount < 6) throw new Error('Not enough hourly forecast data');

  const dates = stringArray(raw.daily.time, 'daily.time');
  const codes = numberArray(raw.daily.weather_code, 'daily.weather_code');
  const highs = numberArray(raw.daily.temperature_2m_max, 'daily.temperature_2m_max');
  const lows = numberArray(raw.daily.temperature_2m_min, 'daily.temperature_2m_min');
  const precipitation = numberArray(raw.daily.precipitation_probability_max, 'daily.precipitation_probability_max');
  const sunrises = stringArray(raw.daily.sunrise, 'daily.sunrise');
  const sunsets = stringArray(raw.daily.sunset, 'daily.sunset');
  const dayCount = Math.min(7, dates.length, codes.length, highs.length, lows.length, precipitation.length, sunrises.length, sunsets.length);
  if (dayCount < 5) throw new Error('Not enough forecast days');

  const currentCode = numberValue(raw.current.weather_code, 'current.weather_code');
  const isDay = numberValue(raw.current.is_day, 'current.is_day') === 1;
  const hours: WeatherHour[] = Array.from({ length: hourCount }, (_, index) => {
    const weatherCode = hourCodes[index];
    const hourIsDay = hourDaylight[index] === 1;
    return {
      time: hourTimes[index],
      temperature: hourTemperatures[index],
      weatherCode,
      kind: weatherKind(weatherCode),
      condition: conditionFor(weatherCode, hourIsDay),
      precipitationChance: hourPrecipitation[index],
      isDay: hourIsDay,
    };
  });
  const days: WeatherDay[] = Array.from({ length: dayCount }, (_, index) => {
    const weatherCode = codes[index];
    return {
      date: dates[index],
      weatherCode,
      kind: weatherKind(weatherCode),
      condition: conditionFor(weatherCode),
      high: highs[index],
      low: lows[index],
      precipitationChance: precipitation[index],
      sunrise: sunrises[index],
      sunset: sunsets[index],
    };
  });

  return {
    location,
    timezone: typeof raw.timezone === 'string' ? raw.timezone : 'Local time',
    fetchedAt: Date.now(),
    current: {
      temperature: numberValue(raw.current.temperature_2m, 'current.temperature_2m'),
      apparentTemperature: numberValue(raw.current.apparent_temperature, 'current.apparent_temperature'),
      weatherCode: currentCode,
      kind: weatherKind(currentCode),
      condition: conditionFor(currentCode, isDay),
      isDay,
      windSpeed: numberValue(raw.current.wind_speed_10m, 'current.wind_speed_10m'),
    },
    hours,
    days,
  };
}

function locationDetail(result: GeocodingResult): string {
  const parts = [result.admin1, result.country].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  return [...new Set(parts)].join(', ') || 'Open-Meteo location';
}

export async function searchCities(query: string, signal: AbortSignal): Promise<WeatherLocation[]> {
  const normalized = query.trim();
  if (normalized.length < 2) return [];
  const params = new URLSearchParams({ name: normalized, count: '6', language: 'en', format: 'json' });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`, { signal });
  if (!response.ok) throw new Error('City search unavailable');
  const raw = (await response.json()) as GeocodingResponse;
  if (!Array.isArray(raw.results)) return [];

  const locations = raw.results.flatMap((entry): WeatherLocation[] => {
    if (!entry || typeof entry !== 'object') return [];
    const result = entry as GeocodingResult;
    if (
      (typeof result.id !== 'number' && typeof result.id !== 'string') ||
      typeof result.name !== 'string' ||
      typeof result.latitude !== 'number' || !Number.isFinite(result.latitude) ||
      typeof result.longitude !== 'number' || !Number.isFinite(result.longitude)
    ) return [];
    return [{
      id: `open-meteo-${String(result.id)}`,
      name: result.name,
      detail: locationDetail(result),
      latitude: result.latitude,
      longitude: result.longitude,
    }];
  });
  return locations.filter((location, index) => locations.findIndex((candidate) => candidate.id === location.id) === index);
}

function isWeatherKind(value: unknown): value is WeatherKind {
  return value === 'clear' || value === 'cloud' || value === 'rain' || value === 'snow' || value === 'storm' || value === 'fog';
}

function isLocation(value: unknown): value is WeatherLocation {
  if (!value || typeof value !== 'object') return false;
  const location = value as Partial<WeatherLocation>;
  return (
    typeof location.id === 'string' && typeof location.name === 'string' &&
    typeof location.detail === 'string' &&
    typeof location.latitude === 'number' && Number.isFinite(location.latitude) &&
    location.latitude >= -90 && location.latitude <= 90 &&
    typeof location.longitude === 'number' && Number.isFinite(location.longitude) &&
    location.longitude >= -180 && location.longitude <= 180 &&
    (location.detected === undefined || typeof location.detected === 'boolean')
  );
}

function isHourPayload(value: unknown): value is WeatherHour {
  if (!value || typeof value !== 'object') return false;
  const hour = value as Partial<WeatherHour>;
  return typeof hour.time === 'string' && typeof hour.temperature === 'number' &&
    typeof hour.weatherCode === 'number' && isWeatherKind(hour.kind) &&
    typeof hour.condition === 'string' && typeof hour.precipitationChance === 'number' &&
    typeof hour.isDay === 'boolean';
}

function isDayPayload(value: unknown): value is WeatherDay {
  if (!value || typeof value !== 'object') return false;
  const day = value as Partial<WeatherDay>;
  return typeof day.date === 'string' && typeof day.weatherCode === 'number' &&
    isWeatherKind(day.kind) && typeof day.condition === 'string' &&
    typeof day.high === 'number' && typeof day.low === 'number' &&
    typeof day.precipitationChance === 'number' && typeof day.sunrise === 'string' &&
    typeof day.sunset === 'string';
}

function isPayload(value: unknown): value is WeatherPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<WeatherPayload>;
  const current = payload.current as Partial<WeatherPayload['current']> | undefined;
  return isLocation(payload.location) && typeof payload.timezone === 'string' &&
    typeof payload.fetchedAt === 'number' && Boolean(current) &&
    typeof current?.temperature === 'number' && typeof current.apparentTemperature === 'number' &&
    typeof current.weatherCode === 'number' && isWeatherKind(current.kind) &&
    typeof current.condition === 'string' && typeof current.isDay === 'boolean' &&
    typeof current.windSpeed === 'number' && Array.isArray(payload.hours) &&
    payload.hours.length >= 6 && payload.hours.every(isHourPayload) &&
    Array.isArray(payload.days) && payload.days.length >= 5 && payload.days.every(isDayPayload);
}

export function readSavedCities(): WeatherLocation[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(CITIES_STORAGE_KEY);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return null;
    const cities = parsed.filter(isLocation);
    return cities.length > 0 ? cities : null;
  } catch { return null; }
}

export function writeSavedCities(cities: readonly WeatherLocation[]): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(CITIES_STORAGE_KEY, JSON.stringify(cities)); } catch { /* Storage is optional. */ }
}

export function readSelectedCityId(cities: readonly WeatherLocation[]): string {
  if (typeof window === 'undefined') return cities[0]?.id ?? DEFAULT_LOCATION.id;
  try {
    const stored = window.localStorage.getItem(SELECTED_CITY_KEY);
    return cities.some((city) => city.id === stored) ? (stored as string) : (cities[0]?.id ?? DEFAULT_LOCATION.id);
  } catch { return cities[0]?.id ?? DEFAULT_LOCATION.id; }
}

export function writeSelectedCityId(id: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(SELECTED_CITY_KEY, id); } catch { /* Selection persistence is optional. */ }
}

function readCacheEnvelope(): WeatherCacheEnvelope {
  const empty: WeatherCacheEnvelope = { version: 2, payloads: {} };
  if (typeof window === 'undefined') return empty;
  try {
    const stored = window.localStorage.getItem(WEATHER_CACHE_KEY);
    if (!stored) return empty;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return empty;
    const candidate = parsed as Partial<WeatherCacheEnvelope>;
    if (candidate.version !== 2 || !candidate.payloads || typeof candidate.payloads !== 'object') return empty;
    const payloads = Object.fromEntries(Object.entries(candidate.payloads).filter(([, payload]) => isPayload(payload)));
    return { version: 2, payloads };
  } catch { return empty; }
}

export function readWeatherCache(locationId: string): WeatherPayload | null {
  return readCacheEnvelope().payloads[locationId] ?? null;
}

export function writeWeatherCache(payload: WeatherPayload): void {
  if (typeof window === 'undefined') return;
  try {
    const envelope = readCacheEnvelope();
    envelope.payloads[payload.location.id] = payload;
    window.localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(envelope));
  } catch { /* The live forecast still works when storage is unavailable. */ }
}

export function formatForecastDay(date: string, index: number): string {
  if (index === 0) return 'Today';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(`${date}T12:00:00`));
}

export function formatLongDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`));
}

export function formatHour(isoLocal: string, index: number): string {
  if (index === 0) return 'Now';
  const match = /T(\d{2}):(\d{2})/.exec(isoLocal);
  if (!match) return '--';
  const hour = Number(match[1]);
  return `${hour % 12 || 12} ${hour >= 12 ? 'PM' : 'AM'}`;
}

/** Open-Meteo returns local wall-clock strings without a UTC offset. */
export function formatSunTime(isoLocal: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(isoLocal);
  if (!match) return '--';
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
}
