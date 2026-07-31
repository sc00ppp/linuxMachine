import { useEffect, useState } from 'react';
import './TopBar.css';
import { DownloadStatus } from './DownloadStatus';

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

function greeting(d: Date): string {
  const h = d.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Good night';
}

/**
 * Ticks once per minute, aligned to the wall clock.
 *
 * A naive `setInterval(60_000)` drifts and, worse, lands mid-minute — the
 * displayed time would be up to 59 s stale. Re-arming a timeout for the top of
 * the next minute keeps the clock honest and costs one timer.
 */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      const d = new Date();
      const msToNextMinute = 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds());
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, msToNextMinute + 50); // small cushion against early timer wakeups
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  return now;
}

/** Wi-Fi strength arcs. Fake full signal — Phase 1 has no network layer. */
function WifiIcon() {
  return (
    <svg className="topbar-icon" viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M2.6 8.6a14.6 14.6 0 0 1 18.8 0" />
        <path d="M5.9 12.3a9.7 9.7 0 0 1 12.2 0" />
        <path d="M9.2 15.9a4.8 4.8 0 0 1 5.6 0" />
      </g>
      <circle cx="12" cy="19.2" r="1.35" fill="currentColor" />
    </svg>
  );
}

/** Controller status glyph. Fake "one pad connected". */
function ControllerIcon() {
  return (
    <svg className="topbar-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.6 7.2h8.8a4.4 4.4 0 0 1 4.3 3.5l1 4.9a2.5 2.5 0 0 1-2.45 3.02c-.95 0-1.83-.5-2.3-1.32L15.9 15.6H8.1l-1.05 1.7c-.47.82-1.35 1.32-2.3 1.32A2.5 2.5 0 0 1 2.3 15.6l1-4.9a4.4 4.4 0 0 1 4.3-3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.55"
      />
      <path
        d="M7.2 10.8v2.6M5.9 12.1h2.6"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
      <circle cx="16.1" cy="11.4" r="0.95" fill="currentColor" />
      <circle cx="18.1" cy="13.2" r="0.95" fill="currentColor" />
    </svg>
  );
}

/**
 * Top chrome: clock, greeting, connectivity glyphs, profile chip (DESIGN.md §9 —
 * profiles stay invisible until you reach for them, so this is just a chip).
 *
 * `data-collapse="y"` lets the launch choreography retract it upward.
 */
export function TopBar() {
  const now = useMinuteClock();

  return (
    <header className="topbar home-chrome" data-collapse="y">
      <div className="topbar-left">
        <div className="topbar-clock">{TIME_FMT.format(now)}</div>
        <div className="topbar-meta">
          <span className="topbar-greeting">{greeting(now)}</span>
          <span className="topbar-sep">·</span>
          <span>{DATE_FMT.format(now)}</span>
        </div>
      </div>

      <div className="topbar-right">
        <DownloadStatus />
        <div className="topbar-status" title="Living Room · connected">
          <WifiIcon />
        </div>
        <div className="topbar-status" title="1 controller connected">
          <ControllerIcon />
          <span className="topbar-badge">1</span>
        </div>
        <div className="topbar-avatar" aria-label="Profile">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="9" r="3.6" fill="currentColor" />
            <path
              d="M4.6 20.2c1.1-3.9 4-5.9 7.4-5.9s6.3 2 7.4 5.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
    </header>
  );
}
