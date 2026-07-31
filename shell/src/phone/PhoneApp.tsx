/**
 * Phone companion surface — the GamePad (DESIGN.md §5).
 *
 * Rendered instead of the console App when the URL path is `/phone`
 * (the integrator forks in main.tsx). Two states only:
 *
 *   unpaired → PairScreen (PIN → POST /pair → token in localStorage)
 *   paired   → GamePad    (mirror of the TV + touch controls over the socket)
 *
 * Everything the phone knows about the console arrives on the `state` channel;
 * everything it does leaves on `input` / `text`. The TV stays authoritative.
 */

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import '../styles/tokens.css';
import '../styles/glass.css';
import './PhoneApp.css';
import GamePad from './GamePad';
import PairScreen from './PairScreen';
import StatusBanner from './StatusBanner';
import { consoleHost } from './config';
import { usePairing } from './pairing';
import { useKeyboardInset } from './useKeyboardInset';
import { usePhoneLink } from './usePhoneLink';

export function PhoneApp() {
  const host = useMemo(() => consoleHost(), []);
  const { pairing, save, forget } = usePairing(host);
  const { status, snapshot, sendInput, sendText } = usePhoneLink(
    host,
    pairing?.token ?? null,
  );
  /** Set when a stored token was refused, so the pair screen can explain itself. */
  const [rejected, setRejected] = useState(false);

  useKeyboardInset();

  // Phone-only document rules (no pull-to-refresh, no rubber-banding). Applied
  // from here rather than in a global stylesheet so the TV shell — which shares
  // these stylesheets — is untouched.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('phone-mode');
    const previousTitle = document.title;
    document.title = 'GamePad';
    return () => {
      root.classList.remove('phone-mode');
      document.title = previousTitle;
    };
  }, []);

  // Phone tokens live in the daemon's memory only, so every console reboot
  // invalidates them. Don't sulk about it: drop the dead token and show the PIN
  // screen again with a plain explanation.
  useEffect(() => {
    if (status !== 'authFailed') return;
    setRejected(true);
    forget();
  }, [status, forget]);

  // The pad is lit by whatever the TV is looking at: the focused channel's
  // accent (or the running app's) becomes --accent for the whole surface, so
  // buttons, rings, and the banner all shift color together as focus moves.
  const accent = useMemo(() => {
    if (!snapshot) return null;
    const id = snapshot.mode === 'app' ? snapshot.runningChannel : snapshot.focusedId;
    return snapshot.channels.find((c) => c.id === id)?.accent ?? null;
  }, [snapshot]);

  const style = accent && pairing ? ({ '--accent': accent } as CSSProperties) : undefined;

  return (
    <div className="phone-root" style={style}>
      {pairing ? (
        <>
          {/* Above the pad in the flow, not floating over it: an overlay pill
              would land on the status row on phones without a notch. */}
          <StatusBanner status={status} />
          <GamePad
            snapshot={snapshot}
            sendInput={sendInput}
            sendText={sendText}
            onForget={() => {
              setRejected(false);
              forget();
            }}
          />
        </>
      ) : (
        <PairScreen
          host={host}
          notice={rejected ? 'The console forgot this phone — pair it again.' : null}
          onPaired={(record) => {
            setRejected(false);
            save(record);
          }}
        />
      )}
    </div>
  );
}

/** Default export too, so either import style works from main.tsx. */
export default PhoneApp;
