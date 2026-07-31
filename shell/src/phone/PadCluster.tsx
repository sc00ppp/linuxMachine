/**
 * The pad itself: d-pad on the left, face buttons on the right, Home between
 * them — the layout your thumbs already know.
 *
 * Every press maps 1:1 to a `ConsoleInput` and goes out on the `input` channel,
 * which the TV feeds through the exact same handler as a physical controller.
 * The phone is not a remote control app; it is another controller.
 */

import PadButton from './PadButton';
import type { ConsoleInput } from './types';
import './PadCluster.css';

export interface PadClusterProps {
  sendInput: (event: ConsoleInput) => void;
}

export default function PadCluster({ sendInput }: PadClusterProps) {
  return (
    <section className="cluster" aria-label="Controller">
      <div className="dpad" role="group" aria-label="Directional pad">
        {/* Directions repeat while held, at the same cadence as the real pad. */}
        <PadButton
          className="dpad-key dpad-key--up"
          ariaLabel="Up"
          repeat
          onPress={() => sendInput({ type: 'nav', dir: 'up' })}
        >
          <span className="dpad-arrow" />
        </PadButton>
        <PadButton
          className="dpad-key dpad-key--left"
          ariaLabel="Left"
          repeat
          onPress={() => sendInput({ type: 'nav', dir: 'left' })}
        >
          <span className="dpad-arrow" />
        </PadButton>
        <span className="dpad-hub" aria-hidden="true" />
        <PadButton
          className="dpad-key dpad-key--right"
          ariaLabel="Right"
          repeat
          onPress={() => sendInput({ type: 'nav', dir: 'right' })}
        >
          <span className="dpad-arrow" />
        </PadButton>
        <PadButton
          className="dpad-key dpad-key--down"
          ariaLabel="Down"
          repeat
          onPress={() => sendInput({ type: 'nav', dir: 'down' })}
        >
          <span className="dpad-arrow" />
        </PadButton>
      </div>

      <div className="face" role="group" aria-label="Buttons">
        {/* Xbox positions kept honest: Y would sit top. It has no meaning in the
            shell yet, so it renders as one of the wall's dashed empty sockets —
            an invitation, not an absence (DESIGN.md §10). */}
        <span className="face-socket" aria-hidden="true" />
        <PadButton
          className="face-key face-key--x"
          ariaLabel="X — Controllers"
          onPress={() => sendInput({ type: 'menu' })}
        >
          X
        </PadButton>
        <PadButton
          className="face-key face-key--b"
          ariaLabel="B — Back"
          onPress={() => sendInput({ type: 'back' })}
        >
          B
        </PadButton>
        <PadButton
          className="face-key face-key--a"
          ariaLabel="A — Accept"
          hapticMs={12}
          onPress={() => sendInput({ type: 'accept' })}
        >
          A
        </PadButton>
      </div>

      <PadButton
        className="home-key"
        ariaLabel="Home"
        hapticMs={14}
        onPress={() => sendInput({ type: 'home' })}
      >
        <span className="home-glyph">⌂</span>
      </PadButton>
    </section>
  );
}
