/**
 * Pairing screen — the console's front door.
 *
 * Deliberately NOT a web form: a six-cell code display and a big on-screen
 * keypad, so the flow reads like typing a code into a game console and never
 * summons the browser's own keyboard over the layout. Errors speak like the
 * console talking to you, not like a validator.
 */

import { useCallback, useRef, useState } from 'react';
import PadButton from './PadButton';
import { haptic } from './press';
import { requestPair, type PairFailure, type PairRecord } from './pairing';
import { sound } from '../sound';
import './PairScreen.css';

const PIN_LENGTH = 6;

const FAILURE_COPY: Record<PairFailure, string> = {
  wrongPin: "That code didn't match — check the TV.",
  rateLimited: 'Too many tries. Restart the console for a fresh code.',
  unreachable: 'Can’t reach the console. Is this phone on the same Wi-Fi?',
  server: 'The console answered strangely. Give it another go.',
};

/** 1-9, then clear / 0 / backspace. */
const KEYS: readonly (string | 'clear' | 'back')[] = [
  '1', '2', '3',
  '4', '5', '6',
  '7', '8', '9',
  'clear', '0', 'back',
];

export interface PairScreenProps {
  host: string;
  /** Standing explanation (e.g. a stored token was refused), shown until the
   *  user starts typing or a real error takes its place. */
  notice?: string | null;
  onPaired: (record: PairRecord) => void;
}

export default function PairScreen({ host, notice, onPaired }: PairScreenProps) {
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  /** Audio must be unlocked from inside a gesture; the first keypress is one. */
  const audioReady = useRef(false);

  const submit = useCallback(
    async (pin: string) => {
      setBusy(true);
      setError(null);
      const result = await requestPair(host, pin);
      setBusy(false);

      if (result.ok) {
        haptic(18);
        // DESIGN.md §7: pairing is a two-note handshake — the TV asks, the
        // phone answers.
        try {
          sound.play('pair');
        } catch {
          /* no audio on this device — the pairing still happened */
        }
        onPaired(result.record);
        return;
      }

      // Wrong code: clear the cells so the next attempt starts clean, and let
      // the display shake rather than posting a red validation message.
      setDigits('');
      setError(FAILURE_COPY[result.kind]);
      setShake(true);
      haptic(24);
    },
    [host, onPaired],
  );

  const press = useCallback(
    (key: string) => {
      if (busy) return;

      if (!audioReady.current) {
        audioReady.current = true;
        try {
          sound.init();
        } catch {
          /* audio unavailable — decorative only */
        }
      }

      setError(null);
      if (key === 'back') {
        setDigits((d) => d.slice(0, -1));
        return;
      }
      if (key === 'clear') {
        setDigits('');
        return;
      }

      setDigits((d) => {
        if (d.length >= PIN_LENGTH) return d;
        const next = d + key;
        // Auto-submit on the sixth digit — no "Connect" button to hunt for.
        // Done here rather than in an effect so a double-invoked effect can
        // never burn one of the daemon's five attempts per boot.
        if (next.length === PIN_LENGTH) void submit(next);
        return next;
      });
    },
    [busy, submit],
  );

  const cells = Array.from({ length: PIN_LENGTH }, (_, i) => digits[i] ?? '');

  return (
    <div className="pair">
      <div className="pair-head">
        <h1 className="pair-title">Pair with the console</h1>
        <p className="pair-sub">Enter the six-digit code showing on your TV.</p>
      </div>

      <div
        className="pair-code glass"
        data-shake={shake ? 'true' : 'false'}
        data-busy={busy ? 'true' : 'false'}
        onAnimationEnd={() => setShake(false)}
        aria-label={`Pairing code, ${digits.length} of ${PIN_LENGTH} digits entered`}
      >
        {cells.map((digit, i) => (
          <span key={i} className="pair-cell" data-filled={digit ? 'true' : 'false'}>
            {digit || <i className="pair-cell-rest" />}
          </span>
        ))}
      </div>

      <p className="pair-status" role="status" aria-live="polite">
        {busy ? 'Asking the console…' : (error ?? (digits === '' ? (notice ?? ' ') : ' '))}
      </p>

      <div className="pair-keypad">
        {KEYS.map((key) => (
          <PadButton
            key={key}
            className={
              key === 'back' || key === 'clear' ? 'pair-key pair-key--aux' : 'pair-key'
            }
            ariaLabel={key === 'back' ? 'Delete' : key === 'clear' ? 'Clear' : key}
            disabled={busy}
            onPress={() => press(key)}
          >
            {key === 'back' ? '⌫' : key === 'clear' ? '✕' : key}
          </PadButton>
        ))}
      </div>

      <footer className="pair-foot">
        <p>
          No code on screen? Press <b>Ⓧ</b> on the home wall to open Controllers — the
          code sits in its footer.
        </p>
        <p className="pair-host">console at {host}</p>
      </footer>
    </div>
  );
}
