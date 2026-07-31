import { useEffect, useState } from 'react';
import { QrCode } from './QrCode';
import './PhoneScreen.css';

interface PairInfo {
  pin: string;
  port: number;
}

/** Loopback-only per the wire protocol (CONTRACTS.md) — reachable because the shell runs on the console box itself. */
const PAIR_INFO_URL = 'http://127.0.0.1:43919/pair-info';
const RETRY_MS = 5000;
const FETCH_TIMEOUT_MS = 2500;

async function fetchPairInfo(): Promise<PairInfo | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(PAIR_INFO_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (
      typeof data === 'object' &&
      data !== null &&
      'pin' in data &&
      typeof (data as { pin: unknown }).pin === 'string'
    ) {
      const port = 'port' in data && typeof (data as { port: unknown }).port === 'number'
        ? (data as { port: number }).port
        : 43919;
      return { pin: (data as { pin: string }).pin, port };
    }
    return null;
  } catch {
    // Daemon not running, network hiccup, or (in dev, cross-origin) a CORS
    // block — all read the same to this screen: "can't reach the console
    // service right now," which the offline state below covers calmly.
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * The Phone screen (CONTRACTS.md Round 3.5) — pairing status + how-to.
 * Polls the daemon's loopback-only `/pair-info` every 5s; the daemon may
 * simply not be running yet in this prototype, which is a normal state, not
 * an error, so it reads like a console ("Console service offline") rather
 * than a failed web request.
 */
export function PhoneScreen() {
  const [info, setInfo] = useState<PairInfo | null>(null);
  const [checkedOnce, setCheckedOnce] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      const result = await fetchPairInfo();
      if (cancelled) return;
      setInfo(result);
      setCheckedOnce(true);
      timer = window.setTimeout(poll, RETRY_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const phoneUrl = `http://${window.location.hostname}:5620/phone`;

  return (
    <div className="phone-screen">
      <div className="phone-panel glass">
        {info ? (
          <>
            <p className="phone-eyebrow">Pair a phone</p>
            <div className="phone-pin" aria-label={`Pairing code ${info.pin.split('').join(' ')}`}>
              {info.pin.split('').map((digit, i) => (
                <span key={i}>{digit}</span>
              ))}
            </div>
            <p className="phone-howto">
              On your phone, open <b>{phoneUrl}</b> and enter this code — or just scan it.
            </p>
            <div className="phone-qr-wrap">
              <QrCode text={phoneUrl} />
            </div>
          </>
        ) : (
          <div className="phone-offline" data-checked={checkedOnce ? 'true' : undefined}>
            <span className="phone-offline-dot" aria-hidden="true" />
            <h2>Console service offline</h2>
            <p>Start the console service on this machine to pair a phone. Checking again every few seconds…</p>
          </div>
        )}
      </div>
    </div>
  );
}
