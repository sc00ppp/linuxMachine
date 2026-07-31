import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  formatForecastDay,
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
  return `Open-Meteo · Local forecast · ${payload?.timezone ?? city.detail}`;
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
    <button className="weather-remove-city" ref={ref} type="button" tabIndex={-1} aria-label={`Remove ${city.name} from saved cities`}>
      Remove city
    </button>
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
  const [focusedDay, setFocusedDay] = useState(0);
  const payloadRef = useRef(payload);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const focusTargetRef = useRef<string | null>(null);

  const selectedCity = cities.find((city) => city.id === selectedCityId) ?? cities[0] ?? DEFAULT_LOCATION;
  const current = payload?.current ?? null;
  const selectedDay = payload?.days[focusedDay] ?? payload?.days[0] ?? null;

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
        setFocusedDay(0);
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
    setFocusedDay(0);
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
          <p>Saved cities</p>
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
      </header>

      <nav className="weather-tabs" aria-label={`${selectedCity.name} weather views`}>
        <div className="weather-tabs__place">
          <strong>{selectedCity.name}</strong>
          <span>{selectedCity.detail}</span>
        </div>
        <div className="weather-tabs__choices">
          <WeatherTabButton tab="conditions" active={activeTab === 'conditions'} onSelect={setActiveTab} />
          <WeatherTabButton tab="radar" active={activeTab === 'radar'} onSelect={setActiveTab} />
        </div>
      </nav>

      {activeTab === 'radar' ? (
        <RadarView location={selectedCity} timezone={payload?.timezone ?? 'UTC'} />
      ) : (
        <main className="weather-content">
          <section className="weather-hero" aria-label={`Current conditions for ${selectedCity.name}`}>
            <div className="weather-current">
              <p className="weather-current__date">
                {payload?.days[0] ? formatLongDate(payload.days[0].date) : 'Your weather, taking shape'}
              </p>
              <div className="weather-current__temperature" aria-label={current ? `${Math.round(current.temperature)} degrees Fahrenheit` : 'Temperature unavailable'}>
                <span>{current ? Math.round(current.temperature) : '—'}</span><sup>°</sup>
              </div>
              <h2>{current?.condition ?? 'Looking for the sky…'}</h2>
              {current && (
                <div className="weather-current__facts">
                  <span>Feels like {Math.round(current.apparentTemperature)}°</span>
                  <span className="weather-current__separator" aria-hidden="true" />
                  <span>Wind {Math.round(current.windSpeed)} mph</span>
                </div>
              )}
              <p className="weather-current__status" data-offline={status === 'offline' ? 'true' : undefined} aria-live="polite">
                {weatherStatus(status, payload, selectedCity)}
              </p>
            </div>
            <div className="weather-hero-art" aria-hidden="true">
              <div className="weather-hero-art__halo" />
              <WeatherIcon className="weather-hero-art__symbol" kind={current?.kind ?? 'cloud'} isDay={current?.isDay ?? true} label="" />
            </div>
            <RemoveCityButton city={selectedCity} onRemove={removeSelectedCity} />
          </section>

          {payload && (
            <>
              <section className="weather-hourly" aria-label="Hourly forecast">
                <div className="weather-strip-heading"><span>Next 24 hours</span><span className="weather-outlook__rule" /></div>
                <div className="weather-hours-scroll"><div className="weather-hours">
                  {payload.hours.map((hour, index) => <HourCard key={hour.time} hour={hour} index={index} />)}
                </div></div>
              </section>

              <section className="weather-outlook" aria-label="Seven day forecast">
                <div className="weather-strip-heading"><span>The week ahead</span><span className="weather-outlook__rule" /></div>
                <div className="weather-days-scroll"><div className="weather-days">
                  {payload.days.map((day, index) => (
                    <DayCard key={day.date} day={day} index={index} onFocus={setFocusedDay} />
                  ))}
                </div></div>
                {selectedDay && (
                  <div className="weather-detail" aria-live="polite">
                    <span className="weather-detail__day">{formatForecastDay(selectedDay.date, focusedDay)}</span>
                    <span className="weather-detail__item"><small>High / Low</small><strong>{Math.round(selectedDay.high)}° / {Math.round(selectedDay.low)}°</strong></span>
                    <span className="weather-detail__item"><small>Rain</small><strong>{Math.round(selectedDay.precipitationChance)}%</strong></span>
                    <span className="weather-detail__item"><small>Sunrise</small><strong>{formatSunTime(selectedDay.sunrise)}</strong></span>
                    <span className="weather-detail__item"><small>Sunset</small><strong>{formatSunTime(selectedDay.sunset)}</strong></span>
                  </div>
                )}
              </section>
            </>
          )}
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
