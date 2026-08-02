import { useEffect, useRef, type CSSProperties } from 'react';
import { useFocusable } from '../focus';
import { WeatherIcon } from './WeatherIcon';
import { formatForecastDay, type WeatherDay } from './weatherData';
import { glideIntoView } from '../motion/glide';

type RangeStyle = CSSProperties & Record<`--${string}`, string>;

interface DayCardProps {
  day: WeatherDay;
  index: number;
  /** Coldest low across the whole week — the left end of the shared scale. */
  scaleLow: number;
  /** Width of that scale in degrees; never zero, so the maths stays safe. */
  scaleSpan: number;
}

/**
 * A full-width row rather than a squeezed tile. Seven rows down a column read
 * far better from a couch than seven cards across one: the day names line up,
 * the conditions get room to spell themselves out, and the range bars share a
 * single temperature axis so the shape of the week is visible at a glance.
 */
export function DayCard({ day, index, scaleLow, scaleSpan }: DayCardProps) {
  const elementRef = useRef<HTMLButtonElement | null>(null);
  const { ref, focused } = useFocusable({
    id: `weather-day-${index}`,
    scope: 'weather',
  });

  useEffect(() => {
    if (!focused) return;
    glideIntoView(elementRef.current, { block: 'nearest' });
  }, [focused]);

  const setRef = (element: HTMLButtonElement | null) => {
    elementRef.current = element;
    ref(element);
  };

  const start = ((day.low - scaleLow) / scaleSpan) * 100;
  const end = ((day.high - scaleLow) / scaleSpan) * 100;
  const rain = Math.round(day.precipitationChance);
  const style: RangeStyle = {
    '--range-start': `${Math.max(0, Math.min(100, start))}%`,
    '--range-end': `${Math.max(0, Math.min(100, end))}%`,
  };

  return (
    <button
      className="weather-day"
      ref={setRef}
      type="button"
      tabIndex={-1}
      style={style}
      aria-label={`${formatForecastDay(day.date, index)}, ${day.condition}, high ${Math.round(day.high)}, low ${Math.round(day.low)}, ${rain} percent chance of rain`}
    >
      <span className="weather-day__name">{formatForecastDay(day.date, index)}</span>
      <WeatherIcon className="weather-day__symbol" kind={day.kind} label="" />
      <span className="weather-day__condition">{day.condition}</span>
      <span className="weather-day__rain">{rain > 0 ? `${rain}%` : ''}</span>
      <span className="weather-day__range">
        <span className="weather-day__low">{Math.round(day.low)}°</span>
        <span className="weather-day__track" aria-hidden="true">
          <span className="weather-day__fill" />
        </span>
        <span className="weather-day__high">{Math.round(day.high)}°</span>
      </span>
    </button>
  );
}
