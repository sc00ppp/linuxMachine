import { useEffect, useRef } from 'react';
import { useFocusable } from '../focus';
import { WeatherIcon } from './WeatherIcon';
import { formatHour, type WeatherHour } from './weatherData';
import { glideIntoView } from '../motion/glide';

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
    glideIntoView(elementRef.current, { block: 'nearest', inline: 'center' });
  }, [focused]);

  const setRef = (element: HTMLButtonElement | null) => {
    elementRef.current = element;
    ref(element);
  };

  const rain = Math.round(hour.precipitationChance);

  return (
    <button
      className="weather-hour"
      ref={setRef}
      type="button"
      tabIndex={-1}
      aria-label={`${formatHour(hour.time, index)}, ${hour.condition}, ${Math.round(hour.temperature)} degrees, ${rain} percent chance of precipitation`}
    >
      <span className="weather-hour__time">{formatHour(hour.time, index)}</span>
      <WeatherIcon className="weather-hour__symbol" kind={hour.kind} isDay={hour.isDay} label="" />
      <strong className="weather-hour__temperature">{Math.round(hour.temperature)}°</strong>
      {/* Always rendered, even at 0%, so the row never changes height when
          focus moves along it. Zero simply reads as empty space. */}
      <span className="weather-hour__rain" data-dry={rain === 0 ? 'true' : undefined}>
        {rain > 0 ? `${rain}%` : ''}
      </span>
    </button>
  );
}
