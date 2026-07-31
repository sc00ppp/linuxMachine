import { useEffect, useRef } from 'react';
import { createLink } from '../link/transport';

interface TextPayload {
  text?: unknown;
  commit?: unknown;
}

/**
 * `startTvLink` currently owns the shell-wide text toast and does not expose a
 * subscriber surface. While Search is visible, this small second TV client
 * listens to the same live-only channel so the real field can replace that
 * placeholder behavior. It closes as soon as the user leaves Search.
 */
export function usePhoneText(
  enabled: boolean,
  onText: (text: string, commit: boolean) => void,
): void {
  const callback = useRef(onText);
  callback.current = onText;

  useEffect(() => {
    if (!enabled) return;
    const link = createLink({
      url: 'ws://127.0.0.1:43919/ws',
      role: 'tv',
    });
    const unsubscribe = link.subscribe('text', (event) => {
      const payload = event.payload as TextPayload;
      if (typeof payload?.text !== 'string') return;
      callback.current(payload.text, payload.commit === true);
    });

    return () => {
      unsubscribe();
      link.close();
    };
  }, [enabled]);
}
