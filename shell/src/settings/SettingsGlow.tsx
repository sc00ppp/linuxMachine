import { cssVars } from './util';
import './SettingsGlow.css';

interface SettingsGlowProps {
  accent: string;
}

/**
 * "Opening an in-shell channel ... the channel screen inherits its accent
 * color" (DESIGN.md §3). Settings is one room with one accent throughout
 * (slate-teal), so unlike the Console Room's per-machine RoomLight this
 * never re-tints — it's just the room's ambient light, always on.
 */
export function SettingsGlow({ accent }: SettingsGlowProps) {
  return (
    <div className="settings-glow" aria-hidden="true" style={cssVars({ '--accent': accent })}>
      <div className="settings-glow-pool" />
      <div className="settings-glow-brow" />
    </div>
  );
}
