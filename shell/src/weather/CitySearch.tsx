import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { focusManager, useFocusable } from '../focus';
import { searchCities, type WeatherLocation } from './weatherData';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

interface SearchButtonProps {
  id: string;
  className?: string;
  label: string;
  onAccept: () => void;
  autoFocus?: boolean;
}

function SearchButton({ id, className = '', label, onAccept, autoFocus = false }: SearchButtonProps) {
  const { ref } = useFocusable({ id, scope: 'weather', onAccept, autoFocus });
  return (
    <button className={className} ref={ref} type="button" tabIndex={-1}>
      {label}
    </button>
  );
}

function SearchResult({ city, index, onChoose }: {
  city: WeatherLocation;
  index: number;
  onChoose: (city: WeatherLocation) => void;
}) {
  const { ref } = useFocusable({
    id: `weather-search-result-${index}`,
    scope: 'weather',
    onAccept: () => onChoose(city),
  });
  return (
    <button className="weather-search-result" ref={ref} type="button" tabIndex={-1}>
      <span>{city.name}</span>
      <small>{city.detail}</small>
    </button>
  );
}

interface CitySearchProps {
  onChoose: (city: WeatherLocation) => void;
  onCancel: () => void;
}

export function CitySearch({ onChoose, onCancel }: CitySearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WeatherLocation[] | null>(null);
  const [status, setStatus] = useState('Choose letters, then select Search.');
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useLayoutEffect(() => {
    focusManager.focusId(results ? 'weather-search-result-0' : 'weather-key-A');
  }, [results]);

  const addLetter = useCallback((letter: string) => {
    setQuery((current) => `${current}${letter}`.slice(0, 32));
  }, []);

  const runSearch = useCallback(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setStatus('Add at least two letters so we know where to look.');
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus(`Looking for ${normalized}…`);
    void searchCities(normalized, controller.signal)
      .then((cities) => {
        if (cities.length === 0) {
          setStatus(`No city named ${normalized} turned up. Try another spelling.`);
          return;
        }
        setResults(cities);
        setStatus(`${cities.length} places found. Choose one to save.`);
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('City search is out of reach right now. Your saved cities are still here.');
      });
  }, [query]);

  if (results) {
    return (
      <main className="weather-search" aria-label="City search results">
        <div className="weather-search__intro">
          <p className="weather-search__eyebrow">Add a city</p>
          <h2>Which {query.trim()}?</h2>
          <p aria-live="polite">{status}</p>
        </div>
        <div className="weather-search-results">
          {results.map((city, index) => (
            <SearchResult key={city.id} city={city} index={index} onChoose={onChoose} />
          ))}
        </div>
        <div className="weather-search__actions">
          <SearchButton id="weather-search-again" className="weather-action" label="Change search" onAccept={() => setResults(null)} />
          <SearchButton id="weather-search-cancel" className="weather-action weather-action--quiet" label="Cancel" onAccept={onCancel} />
        </div>
      </main>
    );
  }

  return (
    <main className="weather-search" aria-label="Add a saved city">
      <div className="weather-search__intro">
        <p className="weather-search__eyebrow">Add a city</p>
        <h2>Where should we watch the sky?</h2>
        <p aria-live="polite">{status}</p>
      </div>

      <label className="weather-search__query">
        <span>City name</span>
        <input
          value={query}
          maxLength={32}
          placeholder="Choose letters below or type here"
          onChange={(event) => setQuery(event.target.value.replace(/[^a-zA-Z .'-]/g, ''))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') runSearch();
          }}
        />
      </label>

      <div className="weather-keyboard" aria-label="On-screen city keyboard">
        {LETTERS.map((letter) => (
          <SearchButton
            key={letter}
            id={`weather-key-${letter}`}
            className="weather-key"
            label={letter}
            onAccept={() => addLetter(letter)}
            autoFocus={letter === 'A'}
          />
        ))}
        <SearchButton id="weather-key-space" className="weather-key weather-key--wide" label="Space" onAccept={() => addLetter(' ')} />
        <SearchButton id="weather-key-delete" className="weather-key weather-key--wide" label="Delete" onAccept={() => setQuery((current) => current.slice(0, -1))} />
        <SearchButton id="weather-key-search" className="weather-key weather-key--search" label="Search" onAccept={runSearch} />
        <SearchButton id="weather-key-cancel" className="weather-key weather-key--quiet" label="Cancel" onAccept={onCancel} />
      </div>
    </main>
  );
}
