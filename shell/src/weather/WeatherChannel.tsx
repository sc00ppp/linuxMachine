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
import { focusManager, useFocusable } from '../focus';
import { tuning } from '../motion/tuning';
import { sound } from '../sound';
import { CitySearch } from './CitySearch';
import { DayCard } from './DayCard';
import { HourCard } from './HourCard';
import { LocationPicker } from './LocationPicker';
import { RadarView } from './RadarView';
import { WeatherIcon } from './WeatherIcon';
import {
  DEFAULT_LOCATION,
  fetchWeather,
  formatLongDate,
  formatSunTime,
  readSavedCities,
  readSelectedCityId,
  readWeatherCache,
  writeSavedCities,
  writeSelectedCityId,
  writeWeatherCache,
  type WeatherLocation,
  type WeatherPayload,
} from './weatherData';
import './WeatherChannel.css';

type FetchStatus = 'loading' | 'refreshing' | 'ready' | 'offline';
type WeatherTab = 'conditions' | 'radar';
type WeatherStyle = CSSProperties & Record<`--${string}`, string>;

interface BootstrapState {
  persistedCities: WeatherLocation[] | null;
  cities: WeatherLocation[];
  selectedId: string;
  payload: WeatherPayload | null;
}

function bootstrapWeather(): BootstrapState {
  const persistedCities = readSavedCities();
  const cities = persistedCities ?? [DEFAULT_LOCATION];
  const selectedId = readSelectedCityId(cities);
  return {
    persistedCities,
    cities,
    selectedId,
    payload: readWeatherCache(selectedId),
  };
}

function weatherStatus(status: FetchStatus, payload: WeatherPayload | null, city: WeatherLocation): string {
  if (status === 'loading') return `Looking for the sky over ${city.name}…`;
  if (status === 'refreshing') return `Refreshing ${city.name} quietly…`;
  if (status === 'offline') {
    return payload
      ? `Can’t refresh ${city.name} — showing the last saved forecast.`
      : 'Can’t reach the weather right now. We’ll keep looking.';
  }
  return `Open-Meteo · ${payload?.timezone ?? city.detail}`;
}

function WeatherTabButton({ tab, active, onSelect }: {
  tab: WeatherTab;
  active: boolean;
  onSelect: (tab: WeatherTab) => void;
}) {
  const { ref } = useFocusable({
    id: `weather-tab-${tab}`,
    scope: 'weather',
    onAccept: () => onSelect(tab),
  });
  return (
    <button className="weather-tab" ref={ref} type="button" tabIndex={-1} aria-pressed={active}>
      {tab === 'conditions' ? 'Conditions' : 'Radar'}
    </button>
  );
}

function RemoveCityButton({ city, onRemove }: { city: WeatherLocation; onRemove: () => void }) {
  const { ref } = useFocusable({ id: 'weather-city-remove', scope: 'weather', onAccept: onRemove });
  return (
    <button
      className="weather-remove-city"
      ref={ref}
      type="button"
      tabIndex={-1}
      aria-label={`Remove ${city.name} from saved cities`}
    >
      Remove city
    </button>
  );
}

/** One label/value pair in the "now" panel's fact block. */
function NowFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="weather-fact">
      <span className="weather-fact__label">{label}</span>
      <strong className="weather-fact__value">{value}</strong>
    </div>
  );
}

export function WeatherChannel() {
  const bootstrapRef = useRef<BootstrapState | null>(null);
  if (!bootstrapRef.current) bootstrapRef.current = bootstrapWeather();
  const bootstrap = bootstrapRef.current;

  const [cities, setCities] = useState<WeatherLocation[]>(bootstrap.cities);
  const [selectedCityId, setSelectedCityId] = useState(bootstrap.selectedId);
  const [payload, setPayload] = useState<WeatherPayload | null>(bootstrap.payload);
  const [status, setStatus] = useState<FetchStatus>(bootstrap.payload ? 'refreshing' : 'loading');
  const [activeTab, setActiveTab] = useState<WeatherTab>('conditions');
  const [searchOpen, setSearchOpen] = useState(false);
  const payloadRef = useRef(payload);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const focusTargetRef = useRef<string | null>(null);

  const selectedCity = cities.find((city) => city.id === selectedCityId) ?? cities[0] ?? DEFAULT_LOCATION;
  const current = payload?.current ?? null;
  const today = payload?.days[0] ?? null;

  /**
   * One shared temperature scale for the whole week, so the range bars in the
   * day rows are comparable to each other rather than each normalising itself.
   */
  const dayScale = useMemo(() => {
    const days = payload?.days ?? [];
    if (days.length === 0) return { low: 0, span: 1 };
    const low = Math.min(...days.map((day) => day.low));
    const high = Math.max(...days.map((day) => day.high));
    return { low, span: Math.max(high - low, 1) };
  }, [payload]);

  useEffect(() => { payloadRef.current = payload; }, [payload]);

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const offset = `${tuning.drillSlidePx / 16}rem`;
    const frames: Keyframe[] = reduced
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: `translate3d(${offset}, 0, 0)` },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ];
    try {
      element.animate(frames, { duration: reduced ? 1 : tuning.drillInMs, easing: tuning.drillInEase });
    } catch {
      // Entrance motion is decorative; older TV engines may omit WAAPI.
    }
  }, []);

  useLayoutEffect(() => {
    if (!focusTargetRef.current) return;
    focusManager.focusId(focusTargetRef.current);
    focusTargetRef.current = null;
  }, [cities, searchOpen]);

  useEffect(() => { sound.startAmbient(); }, []);

  useEffect(() => {
    if (bootstrap.persistedCities !== null) return;
    const persistFallback = () => {
      writeSavedCities([DEFAULT_LOCATION]);
      writeSelectedCityId(DEFAULT_LOCATION.id);
    };
    if (!navigator.geolocation) {
      persistFallback();
      return;
    }
    let mounted = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!mounted) return;
        const detected: WeatherLocation = {
          id: 'detected',
          name: 'Near you',
          detail: 'Current location',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          detected: true,
        };
        writeSavedCities([detected]);
        writeSelectedCityId(detected.id);
        setCities([detected]);
        setSelectedCityId(detected.id);
        const cached = readWeatherCache(detected.id);
        payloadRef.current = cached;
        setPayload(cached);
        setStatus(cached ? 'refreshing' : 'loading');
        focusTargetRef.current = `weather-city-${detected.id}`;
      },
      persistFallback,
      { enableHighAccuracy: false, maximumAge: 30 * 60 * 1000, timeout: 7000 },
    );
    return () => { mounted = false; };
  }, [bootstrap.persistedCities]);

  useEffect(() => {
    const controller = new AbortController();
    setStatus(payloadRef.current ? 'refreshing' : 'loading');
    void fetchWeather(selectedCity, controller.signal)
      .then((nextPayload) => {
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        setStatus('ready');
        writeWeatherCache(nextPayload);
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('offline');
      });
    return () => controller.abort();
  }, [selectedCity.id, selectedCity.latitude, selectedCity.longitude]);

  const selectCity = useCallback((city: WeatherLocation) => {
    writeSelectedCityId(city.id);
    setSelectedCityId(city.id);
    setActiveTab('conditions');
    const cached = readWeatherCache(city.id);
    payloadRef.current = cached;
    setPayload(cached);
    setStatus(cached ? 'refreshing' : 'loading');
  }, []);

  const chooseNewCity = useCallback((city: WeatherLocation) => {
    setCities((currentCities) => {
      const withoutDuplicate = currentCities.filter((saved) => saved.id !== city.id);
      const nextCities = [...withoutDuplicate, city];
      writeSavedCities(nextCities);
      return nextCities;
    });
    setSearchOpen(false);
    focusTargetRef.current = `weather-city-${city.id}`;
    selectCity(city);
  }, [selectCity]);

  const removeSelectedCity = useCallback(() => {
    const remaining = cities.filter((city) => city.id !== selectedCity.id);
    const nextCities = remaining.length > 0 ? remaining : [DEFAULT_LOCATION];
    const nextCity = nextCities[0];
    writeSavedCities(nextCities);
    setCities(nextCities);
    focusTargetRef.current = `weather-city-${nextCity.id}`;
    selectCity(nextCity);
  }, [cities, selectCity, selectedCity.id]);

  const weatherAccent = channelById('weather')?.accent;
  const style: WeatherStyle = {
    ...(weatherAccent ? { '--accent': weatherAccent } : {}),
    '--weather-focus-ms': `${tuning.focusMoveMs}ms`,
    '--weather-focus-ease': tuning.focusEase,
    '--weather-sky-ms': `${tuning.settleFadeMs}ms`,
    '--weather-settle-delay': `${tuning.settleFadeDelayMs}ms`,
    '--weather-drift-ms': `${tuning.settleFadeMs * 10}ms`,
    '--weather-breathe-ms': `${tuning.settleFadeMs * 4}ms`,
    '--weather-fall-ms': `${tuning.settleFadeMs * 2}ms`,
    '--weather-radar-frame-ms': `${tuning.focusMoveMs}ms`,
  };
  const sky = `${current?.kind ?? 'cloud'}-${current?.isDay === false ? 'night' : 'day'}`;

  if (searchOpen) {
    return (
      <div className="weather" ref={rootRef} style={style} data-sky={sky}>
        <header className="weather-header weather-header--search" data-collapse="y">
          <div className="weather-brand">
            <WeatherIcon className="weather-brand__symbol" kind="cloud" label="Weather" />
            <h1>Weather</h1>
          </div>
          <p className="weather-header__note">Saved cities</p>
        </header>
        <CitySearch onChoose={chooseNewCity} onCancel={() => setSearchOpen(false)} />
        <footer className="weather-hints" data-collapse="y">
          <span className="weather-hint"><span className="weather-hint__badge" aria-hidden="true">A</span><span>Choose</span></span>
          <span className="weather-hint"><span className="weather-hint__badge weather-hint__badge--wide" aria-hidden="true">D-pad</span><span>Move</span></span>
        </footer>
      </div>
    );
  }

  return (
    <div
      className="weather"
      ref={rootRef}
      style={style}
      data-sky={sky}
      aria-busy={status === 'loading' || status === 'refreshing'}
    >
      <header className="weather-header" data-collapse="y">
        <div className="weather-brand">
          <WeatherIcon className="weather-brand__symbol" kind="cloud" label="Weather" />
          <h1>Weather</h1>
        </div>
        <LocationPicker
          locations={cities}
          selectedId={selectedCity.id}
          onSelect={selectCity}
          onAdd={() => setSearchOpen(true)}
        />
        <nav className="weather-views" aria-label={`${selectedCity.name} weather views`}>
          <WeatherTabButton tab="conditions" active={activeTab === 'conditions'} onSelect={setActiveTab} />
          <WeatherTabButton tab="radar" active={activeTab === 'radar'} onSelect={setActiveTab} />
        </nav>
      </header>

      {activeTab === 'radar' ? (
        <RadarView location={selectedCity} timezone={payload?.timezone ?? 'UTC'} />
      ) : (
        <main className="weather-stage">
          <section className="weather-now" aria-label={`Current conditions for ${selectedCity.name}`}>
            <div className="weather-now__place">
              <h2>{selectedCity.name}</h2>
              <p>{today ? formatLongDate(today.date) : selectedCity.detail}</p>
            </div>

            <div className="weather-now__sky">
              <div className="weather-now__halo" aria-hidden="true" />
              <WeatherIcon
                className="weather-now__symbol"
                kind={current?.kind ?? 'cloud'}
                isDay={current?.isDay ?? true}
                label=""
              />
            </div>

            <div className="weather-now__reading">
              <p
                className="weather-now__temperature"
                aria-label={current ? `${Math.round(current.temperature)} degrees Fahrenheit` : 'Temperature unavailable'}
              >
                <span>{current ? Math.round(current.temperature) : '—'}</span>
                <sup aria-hidden="true">°</sup>
              </p>
              <p className="weather-now__condition">{current?.condition ?? 'Looking for the sky…'}</p>
            </div>

            <div className="weather-now__facts">
              <NowFact label="Feels like" value={current ? `${Math.round(current.apparentTemperature)}°` : '—'} />
              <NowFact label="Wind" value={current ? `${Math.round(current.windSpeed)} mph` : '—'} />
              <NowFact label="Sunrise" value={today ? formatSunTime(today.sunrise) : '—'} />
              <NowFact label="Sunset" value={today ? formatSunTime(today.sunset) : '—'} />
            </div>

            <div className="weather-now__foot">
              <p
                className="weather-now__status"
                data-offline={status === 'offline' ? 'true' : undefined}
                aria-live="polite"
              >
                {weatherStatus(status, payload, selectedCity)}
              </p>
              <RemoveCityButton city={selectedCity} onRemove={removeSelectedCity} />
            </div>
          </section>

          <div className="weather-forecast">
            <section className="weather-hourly" aria-label="Hourly forecast">
              <h2 className="weather-section-title">Next 24 hours</h2>
              {payload ? (
                <div className="weather-hours">
                  {payload.hours.map((hour, index) => (
                    <HourCard key={hour.time} hour={hour} index={index} />
                  ))}
                </div>
              ) : (
                <p className="weather-empty">The next day’s hours are on their way.</p>
              )}
            </section>

            <section className="weather-weekly" aria-label="Seven day forecast">
              <h2 className="weather-section-title">The week ahead</h2>
              {payload ? (
                <div className="weather-week">
                  {payload.days.map((day, index) => (
                    <DayCard
                      key={day.date}
                      day={day}
                      index={index}
                      scaleLow={dayScale.low}
                      scaleSpan={dayScale.span}
                    />
                  ))}
                </div>
              ) : (
                <p className="weather-empty">The week is still coming into focus.</p>
              )}
            </section>
          </div>
        </main>
      )}

      <footer className="weather-hints" data-collapse="y">
        <span className="weather-hint"><span className="weather-hint__badge weather-hint__badge--wide" aria-hidden="true">D-pad</span><span>Browse</span></span>
        <span className="weather-hint"><span className="weather-hint__badge" aria-hidden="true">A</span><span>Open</span></span>
        <span className="weather-hint"><span className="weather-hint__badge" aria-hidden="true">B</span><span>Back</span></span>
      </footer>
    </div>
  );
}
