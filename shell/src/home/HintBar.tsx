import './HintBar.css';

interface Hint {
  /** Glyph drawn inside the badge — a face button letter or a symbol. */
  key: string;
  label: string;
  /** Round face-button badge vs. flat system-button badge. */
  kind: 'face' | 'system';
}

const HINTS: Hint[] = [
  { key: 'A', label: 'Open', kind: 'face' },
  { key: 'B', label: 'Back', kind: 'face' },
  { key: 'X', label: 'Controllers', kind: 'face' },
  { key: '⌂', label: 'Home', kind: 'system' },
];

/**
 * Bottom chrome: contextual button hints (DESIGN.md §2).
 *
 * Badges are drawn from tokens rather than the unicode circled letters (Ⓐ/Ⓑ) —
 * those render at wildly different weights across platform fonts and look
 * broken at couch distance. `data-collapse="y"` retracts it downward on launch.
 */
export function HintBar() {
  return (
    <footer className="hintbar home-chrome" data-collapse="y">
      {HINTS.map((h) => (
        <div className="hintbar-item" key={h.key}>
          <span className={`hintbar-badge hintbar-badge--${h.kind}`} aria-hidden="true">
            {h.key}
          </span>
          <span className="hintbar-label">{h.label}</span>
        </div>
      ))}
    </footer>
  );
}
