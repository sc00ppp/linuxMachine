/**
 * Connection banner.
 *
 * Lesson carried over from o3code's connection notice: a socket that blips for
 * 300 ms while the phone rotates or the AP roams must NOT flash a scary bar.
 * So the banner waits ~1.5 s of continuous trouble before appearing, and when
 * the link comes back it says so briefly instead of vanishing silently — the
 * user needs to know their presses count again.
 */

import { useEffect, useRef, useState } from 'react';
import type { LinkStatus } from './usePhoneLink';
import './StatusBanner.css';

/** How long the link must stay down before we admit it out loud. */
const SHOW_AFTER_MS = 1500;
/** How long the "back" note lingers once the link recovers. */
const RESTORED_MS = 1600;

type Phase = 'idle' | 'lost' | 'restored';

export interface StatusBannerProps {
  status: LinkStatus;
}

export default function StatusBanner({ status }: StatusBannerProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  /** Whether the banner actually surfaced — decides if recovery is worth noting. */
  const announced = useRef(false);

  useEffect(() => {
    if (status === 'connecting' || status === 'closed') {
      const timer = window.setTimeout(() => {
        announced.current = true;
        setPhase('lost');
      }, SHOW_AFTER_MS);
      // A blip clears this timer before it ever fires — that is the whole trick.
      return () => window.clearTimeout(timer);
    }

    if (status === 'open' && announced.current) {
      announced.current = false;
      setPhase('restored');
      const timer = window.setTimeout(() => setPhase('idle'), RESTORED_MS);
      return () => window.clearTimeout(timer);
    }

    setPhase('idle');
    return undefined;
  }, [status]);

  if (phase === 'idle') return null;

  const lost = phase === 'lost';
  return (
    <div className="banner glass" data-phase={phase} role="status" aria-live="polite">
      <span className="banner-dot" aria-hidden="true" />
      <span className="banner-text">
        {lost ? 'Looking for the console…' : 'Back with the console'}
      </span>
    </div>
  );
}
