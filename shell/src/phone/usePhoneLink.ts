/**
 * React binding for the console socket, phone side.
 *
 * All the hard parts (backoff, keepalive, `visibilitychange` redial, replay
 * floors) live in `src/link/transport.ts` — this hook only owns the React
 * lifecycle and turns `state` events into a render-able snapshot.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
// Contract: CONTRACTS.md Round 3 → `shell/src/link/transport.ts`.
import {
  createLink,
  type Link,
  type LinkEvent,
  type LinkStatus,
} from '../link/transport';
import { CHAN, wsUrl } from './config';
import { asSnapshot, type ConsoleInput, type StateSnapshot } from './types';

export type { LinkStatus };

export interface PhoneLink {
  status: LinkStatus;
  /** Latest `state` snapshot from the TV, or null before the first one lands. */
  snapshot: StateSnapshot | null;
  sendInput: (event: ConsoleInput) => void;
  sendText: (text: string, commit: boolean) => void;
}

export function usePhoneLink(host: string, token: string | null): PhoneLink {
  const [status, setStatus] = useState<LinkStatus>(token ? 'connecting' : 'closed');
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const linkRef = useRef<Link | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('closed');
      return;
    }

    setStatus('connecting');
    const link = createLink({
      url: wsUrl(host),
      role: 'phone',
      token,
      onStatus: (s: LinkStatus) => setStatus(s),
    });
    linkRef.current = link;

    // `state` is ring-buffered server-side, so a phone that wakes up mid-session
    // gets the last snapshot replayed and renders the real TV state instantly.
    const unsubscribe = link.subscribe(CHAN.state, (event: LinkEvent) => {
      const next = asSnapshot(event.payload);
      if (next) setSnapshot(next);
    });

    return () => {
      unsubscribe();
      link.close();
      linkRef.current = null;
    };
  }, [host, token]);

  // Both senders are no-ops while the socket is down — transport drops silently,
  // which is the right behaviour for live-only channels: a button press that
  // arrives three seconds late is worse than one that never arrives.
  const sendInput = useCallback((event: ConsoleInput) => {
    linkRef.current?.send(CHAN.input, event);
  }, []);

  const sendText = useCallback((text: string, commit: boolean) => {
    linkRef.current?.send(CHAN.text, { text, commit });
  }, []);

  return { status, snapshot, sendInput, sendText };
}
