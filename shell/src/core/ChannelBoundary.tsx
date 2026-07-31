import { Component, type ReactNode } from 'react';
import { useConsoleStore } from './store';

/**
 * A failing channel must never take down Home — that's the console's core
 * promise (DESIGN.md: "Failures return safely to Home instead of exposing
 * the operating system"). Any error thrown while rendering a channel is
 * caught here and turned into a calm screen you can back out of.
 */
interface Props {
  children: ReactNode;
  /** Channel title, for the message. */
  name: string;
}

interface State {
  error: Error | null;
}

export class ChannelBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Console-visible for development; the daemon will collect these later.
    console.error('[channel error]', this.props.name, error);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section className="channel-fallback">
        <h1>{this.props.name} isn’t available</h1>
        <p>Press B to go back Home.</p>
        <button
          type="button"
          onClick={() => useConsoleStore.getState().closeView()}
        >
          Back to Home
        </button>
      </section>
    );
  }
}
