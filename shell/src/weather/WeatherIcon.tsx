import type { WeatherKind } from './weatherData';

interface WeatherIconProps {
  kind: WeatherKind;
  isDay?: boolean;
  className?: string;
  label?: string;
}

function Celestial({ isDay }: { isDay: boolean }) {
  if (!isDay) {
    return (
      <path
        className="weather-symbol__moon"
        d="M61 18c-14 6-21 22-15 36 6 15 23 22 38 16-8 1-17-4-21-12-7-13-2-30 10-38-4-2-8-3-12-2Z"
      />
    );
  }

  return (
    <g className="weather-symbol__sun-wheel">
      <circle className="weather-symbol__sun" cx="59" cy="44" r="19" />
      <g className="weather-symbol__rays">
        <path d="M59 9v9M59 70v9M24 44h9M85 44h9M34 19l7 7M77 62l7 7M34 69l7-7M77 26l7-7" />
      </g>
    </g>
  );
}

function Cloud({ className = '' }: { className?: string }) {
  return (
    <g className={`weather-symbol__cloud ${className}`}>
      <path
        className="weather-symbol__cloud-shadow"
        d="M36 83c-12 0-21-8-21-19 0-10 7-18 17-19 4-15 17-25 33-25 17 0 31 12 34 28 13 0 24 10 24 23 0 13-11 23-25 23H36Z"
      />
      <path
        className="weather-symbol__cloud-face"
        d="M37 78c-10 0-17-6-17-15 0-8 6-14 14-15 4-13 15-22 29-22 15 0 27 10 30 25 12 0 21 8 21 19 0 10-9 18-21 18H37Z"
      />
      <path
        className="weather-symbol__cloud-light"
        d="M39 53c5-11 16-18 28-17 9 0 17 4 22 11-7-4-14-5-21-4-10 1-18 5-23 12-3 4-8 3-6-2Z"
      />
    </g>
  );
}

function ClearSymbol({ isDay }: { isDay: boolean }) {
  return (
    <g className="weather-symbol__clear">
      <Celestial isDay={isDay} />
      <path
        className="weather-symbol__airline"
        d="M30 97c20 6 48 7 73 0"
      />
    </g>
  );
}

function CloudSymbol({ isDay }: { isDay: boolean }) {
  return (
    <>
      <g className="weather-symbol__behind">
        <Celestial isDay={isDay} />
      </g>
      <Cloud />
    </>
  );
}

function RainSymbol() {
  return (
    <>
      <Cloud />
      <g className="weather-symbol__rain">
        <path className="weather-symbol__drop weather-symbol__drop--one" d="M44 91l-6 15" />
        <path className="weather-symbol__drop weather-symbol__drop--two" d="M67 92l-6 15" />
        <path className="weather-symbol__drop weather-symbol__drop--three" d="M90 91l-6 15" />
      </g>
    </>
  );
}

function SnowSymbol() {
  return (
    <>
      <Cloud />
      <g className="weather-symbol__snow">
        <path
          className="weather-symbol__flake weather-symbol__flake--one"
          d="M42 92v16M35 96l14 8M49 96l-14 8"
        />
        <path
          className="weather-symbol__flake weather-symbol__flake--two"
          d="M67 92v16M60 96l14 8M74 96l-14 8"
        />
        <path
          className="weather-symbol__flake weather-symbol__flake--three"
          d="M92 92v16M85 96l14 8M99 96l-14 8"
        />
      </g>
    </>
  );
}

function StormSymbol() {
  return (
    <>
      <Cloud className="weather-symbol__cloud--storm" />
      <g className="weather-symbol__storm">
        <path className="weather-symbol__bolt-glow" d="M72 81 54 105h15l-5 15 26-29H75l7-10Z" />
        <path className="weather-symbol__bolt" d="M72 81 54 105h15l-5 15 26-29H75l7-10Z" />
      </g>
    </>
  );
}

function FogSymbol({ isDay }: { isDay: boolean }) {
  return (
    <>
      <g className="weather-symbol__behind weather-symbol__behind--fog">
        <Celestial isDay={isDay} />
      </g>
      <g className="weather-symbol__fog">
        <path className="weather-symbol__fogline weather-symbol__fogline--one" d="M24 55c25-5 52 5 90 0" />
        <path className="weather-symbol__fogline weather-symbol__fogline--two" d="M17 72c32 6 68-6 106 0" />
        <path className="weather-symbol__fogline weather-symbol__fogline--three" d="M27 89c26-5 50 5 84 0" />
        <path className="weather-symbol__fogline weather-symbol__fogline--four" d="M40 105c20 4 38-4 65 0" />
      </g>
    </>
  );
}

/**
 * A deliberately small hand-drawn symbol set. Every condition shares the
 * same cloud construction and stroke rhythm, so the strip reads as one
 * illustrator's work instead of a collection of unrelated icons.
 */
export function WeatherIcon({
  kind,
  isDay = true,
  className = '',
  label = `${kind} weather`,
}: WeatherIconProps) {
  return (
    <svg
      className={`weather-symbol weather-symbol--${kind} ${className}`}
      viewBox="0 0 140 120"
      role="img"
      aria-label={label}
    >
      {kind === 'clear' && <ClearSymbol isDay={isDay} />}
      {kind === 'cloud' && <CloudSymbol isDay={isDay} />}
      {kind === 'rain' && <RainSymbol />}
      {kind === 'snow' && <SnowSymbol />}
      {kind === 'storm' && <StormSymbol />}
      {kind === 'fog' && <FogSymbol isDay={isDay} />}
    </svg>
  );
}
