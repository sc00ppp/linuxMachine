/**
 * The paired surface: mirror on top, pad on the bottom.
 *
 * Split follows DESIGN.md §5 — "the TV shows the thing; the phone shows things
 * about the thing". The top half is *about* the TV (what it is looking at,
 * what is running), the bottom half is how you drive it.
 */

import { useEffect, useState } from 'react';
import ChannelMirror from './ChannelMirror';
import PadCluster from './PadCluster';
import TextEntry from './TextEntry';
import type { ConsoleInput, StateSnapshot } from './types';
import './GamePad.css';

export interface GamePadProps {
  snapshot: StateSnapshot | null;
  sendInput: (event: ConsoleInput) => void;
  sendText: (text: string, commit: boolean) => void;
  onForget: () => void;
}

/** One line describing where the TV currently is. */
function describe(snapshot: StateSnapshot | null): string {
  if (!snapshot) return 'Waiting for the TV…';

  if (snapshot.mode === 'app') {
    const channel = snapshot.channels.find((c) => c.id === snapshot.runningChannel);
    const what = snapshot.runningTitle ?? channel?.title ?? 'an app';
    return snapshot.shelfOpen ? `Home menu · ${what}` : `Playing · ${what}`;
  }
  if (snapshot.view === 'games') {
    return snapshot.gamesLevel === 'grid' ? 'Games · library' : 'Games · consoles';
  }

  const focused = snapshot.channels.find((c) => c.id === snapshot.focusedId);
  return focused ? `Home · ${focused.title}` : 'Home';
}

export default function GamePad({ snapshot, sendInput, sendText, onForget }: GamePadProps) {
  // Unpairing is destructive and lives one thumb-slip from the pad, so it takes
  // two taps — the second one within a few seconds.
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 3500);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  // The wall can only be steered when the TV's focus is actually on it.
  const steerable =
    snapshot !== null &&
    snapshot.mode === 'home' &&
    snapshot.view === 'wall' &&
    !snapshot.shelfOpen;

  return (
    <div className="gamepad">
      <header className="gp-head">
        <p className="gp-context">{describe(snapshot)}</p>
        <button
          type="button"
          className="gp-forget"
          data-confirming={confirming ? 'true' : 'false'}
          onClick={() => {
            if (confirming) onForget();
            else setConfirming(true);
          }}
        >
          {confirming ? 'Tap again to forget' : 'Forget console'}
        </button>
      </header>

      <ChannelMirror
        channels={snapshot?.channels ?? []}
        focusedId={snapshot?.focusedId ?? null}
        runningChannel={snapshot?.runningChannel ?? null}
        steerable={steerable}
        sendInput={sendInput}
      />

      {/* Empty room between the two halves: the pad stays where the thumbs are,
          low on the screen, whatever the phone's height. */}
      <div className="gp-gap" />

      <PadCluster sendInput={sendInput} />

      <p className="gp-hints">
        <span>
          <b>A</b> Open
        </span>
        <span>
          <b>B</b> Back
        </span>
        <span>
          <b>X</b> Controllers
        </span>
      </p>

      <TextEntry sendText={sendText} />
    </div>
  );
}
