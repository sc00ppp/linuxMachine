import { useEffect, useRef } from 'react';
import { useFocusable } from '../focus';
import { WeatherIcon } from './WeatherIcon';
import { formatHour, type WeatherHour } from './weatherData';

interface HourCardProps {
  hour: WeatherHour;
  index: number;
}

export function HourCard({ hour, index }: HourCardProps) {
  const elementRef = useRef<HTMLButtonElement | null>(null);
  const { ref, focused } = useFocusable({
    id: `weather-hour-${index}`,
    scope: 'weather',
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
      className="weather-hour"
      ref={setRef}
      type="button"
      tabIndex={-1}
      aria-label={`${formatHour(hour.time, index)}, ${hour.condition}, ${Math.round(hour.temperature)} degrees, ${Math.round(hour.precipitationChance)} percent chance of precipitation`}
    >
      <span className="weather-hour__time">{formatHour(hour.time, index)}</span>
      <WeatherIcon className="weather-hour__symbol" kind={hour.kind} isDay={hour.isDay} label="" />
      <strong>{Math.round(hour.temperature)}°</strong>
      <span className="weather-hour__rain">{Math.round(hour.precipitationChance)}%</span>
    </button>
  );
}
