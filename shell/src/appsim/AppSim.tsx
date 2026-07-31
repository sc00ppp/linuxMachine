import type { CSSProperties } from 'react';
import { useConsoleStore } from '../core/store';
import { channelById } from '../core/channels';
import './AppSim.css';

/**
 * Fullscreen fake "application" — stands in for whatever was launched
 * (game/movie/YouTube/settings). It exists only to prove the launch/return
 * round-trip (DESIGN.md §3): something believable for the tile to zoom into,
 * and something for the Home overlay to dim/blur over.
 *
 * Deliberately owns no input handling. App.tsx listens for the Home button
 * globally (it toggles the shelf); everything else is swallowed while
 * mode === 'app' with the shelf closed, so this component only ever renders.
 */
export function AppSim() {
  const runningChannel = useConsoleStore((s) => s.runningChannel);
  const channel = runningChannel ? channelById(runningChannel) : undefined;

  // Guards against a mode/runningChannel mismatch (shouldn't happen per the
  // store's launchApp, but rendering nothing beats crashing on undefined).
  if (!channel) return null;

  return (
    <div className="appsim" style={{ '--accent': channel.accent } as CSSProperties}>
      {/* Slow drifting blurred blobs give the illusion of a "live" app
          without any real content — three overlapping radial fields moving
          on independent, very long, out-of-phase loops so the motion never
          feels mechanical or repeats obviously. */}
      <div className="appsim__blob appsim__blob--a" aria-hidden="true" />
      <div className="appsim__blob appsim__blob--b" aria-hidden="true" />
      <div className="appsim__blob appsim__blob--c" aria-hidden="true" />
      <div className="appsim__grain" aria-hidden="true" />

      <div className="appsim__content">
        <div className="appsim__glyph" aria-hidden="true">{channel.glyph}</div>
        <h1 className="appsim__title">{channel.title}</h1>
        <p className="appsim__hint">Press H — Home</p>
      </div>
    </div>
  );
}
