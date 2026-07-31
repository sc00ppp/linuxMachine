import { useEffect, useRef } from 'react';
import { useFocusable } from '../focus';
import type { WeatherLocation } from './weatherData';

interface CityChoiceProps {
  location: WeatherLocation;
  selected: boolean;
  autoFocus: boolean;
  onSelect: (location: WeatherLocation) => void;
}

function CityChoice({ location, selected, autoFocus, onSelect }: CityChoiceProps) {
  const elementRef = useRef<HTMLButtonElement | null>(null);
  const { ref, focused } = useFocusable({
    id: `weather-city-${location.id}`,
    scope: 'weather',
    autoFocus,
    onAccept: () => onSelect(location),
  });

  useEffect(() => {
    if (!focused) return;
    elementRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [focused]);

  const setRef = (element: HTMLButtonElement | null) => {
    elementRef.current = element;
    ref(element);
  };

  return (
    <button
      className="weather-location"
      ref={setRef}
      type="button"
      tabIndex={-1}
      aria-pressed={selected}
      aria-label={`Open ${location.name}, ${location.detail}`}
    >
      {location.detected && (
        <span className="weather-location__pin" aria-hidden="true"><span /></span>
      )}
      <span>{location.name}</span>
    </button>
  );
}

function AddCityChoice({ onAdd }: { onAdd: () => void }) {
  const elementRef = useRef<HTMLButtonElement | null>(null);
  const { ref, focused } = useFocusable({
    id: 'weather-city-add',
    scope: 'weather',
    onAccept: onAdd,
  });

  useEffect(() => {
    if (focused) elementRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [focused]);

  const setRef = (element: HTMLButtonElement | null) => {
    elementRef.current = element;
    ref(element);
  };

  return (
    <button className="weather-location weather-location--add" ref={setRef} type="button" tabIndex={-1}>
      <span className="weather-location__plus" aria-hidden="true">+</span>
      <span>Add city</span>
    </button>
  );
}

interface LocationPickerProps {
  locations: readonly WeatherLocation[];
  selectedId: string;
  onSelect: (location: WeatherLocation) => void;
  onAdd: () => void;
}

export function LocationPicker({ locations, selectedId, onSelect, onAdd }: LocationPickerProps) {
  return (
    <div className="weather-locations-scroll">
      <nav className="weather-locations" aria-label="Saved cities">
        {locations.map((location) => (
          <CityChoice
            key={location.id}
            location={location}
            selected={location.id === selectedId}
            autoFocus={location.id === selectedId}
            onSelect={onSelect}
          />
        ))}
        <AddCityChoice onAdd={onAdd} />
      </nav>
    </div>
  );
}
