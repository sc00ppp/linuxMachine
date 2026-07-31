import { useEffect, useRef } from 'react';
import { useFocusable } from '../focus';
import { WeatherIcon } from './WeatherIcon';
import { formatForecastDay, type WeatherDay } from './weatherData';

interface DayCardProps {
  day: WeatherDay;
  index: number;
  onFocus: (index: number) => void;
}

export function DayCard({ day, index, onFocus }: DayCardProps) {
  const elementRef = useRef<HTMLButtonElement | null>(null);
  const { ref, focused } = useFocusable({
    id: `weather-day-${index}`,
    scope: 'weather',
  });

  useEffect(() => {
    if (!focused) return;
    onFocus(index);
    elementRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [focused, index, onFocus]);

  const setRef = (element: HTMLButtonElement | null) => {
    elementRef.current = element;
    ref(element);
  };

  return (
    <button
      className="weather-day"
      ref={setRef}
      type="button"
      tabIndex={-1}
      aria-label={`${formatForecastDay(day.date, index)}, ${day.condition}, high ${Math.round(day.high)}, low ${Math.round(day.low)}`}
    >
      <span className="weather-day__name">
        {formatForecastDay(day.date, index)}
      </span>
      <WeatherIcon
        className="weather-day__symbol"
        kind={day.kind}
        label={day.condition}
      />
      <span className="weather-day__condition">{day.condition}</span>
      <span className="weather-day__temperatures">
        <strong>{Math.round(day.high)}°</strong>
        <span>{Math.round(day.low)}°</span>
      </span>
    </button>
  );
}
