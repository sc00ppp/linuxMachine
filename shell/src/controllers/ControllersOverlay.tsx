import { useRef, type CSSProperties } from 'react';
import { useConsoleStore } from '../core/store';
import { useFocusable } from '../focus';
import { tuning } from '../motion/tuning';
import { sound } from '../sound';
import './ControllersOverlay.css';

/**
 * The controller switchboard stays independent of the screen beneath it.
 * App.tsx owns the overlay stack and all close/menu input; this component only
 * exposes controller actions within the active `controllers` focus scope.
 */
export function ControllersOverlay() {
  const openRemap = () => {
    sound.play('accept');
    useConsoleStore.getState().openRemap('snes');
  };

  return (
    <div
      className="controllers-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="controllers-overlay-title"
      style={
        {
          '--controllers-open-ms': `${tuning.shelfOpenMs}ms`,
          '--controllers-enter-ease': tuning.shelfEase,
          '--controllers-focus-ms': `${tuning.focusMoveMs}ms`,
          '--controllers-focus-ease': tuning.focusEase,
          '--controllers-pair-pulse-ms': `${tuning.settleFadeMs}ms`,
          '--controllers-pair-pulse-delay': `${-tuning.settleFadeMs / 2}ms`,
        } as CSSProperties
      }
    >
      <div className="controllers-overlay__backdrop" aria-hidden="true" />

      <section className="controllers-overlay__panel glass glass--strong">
        <header className="controllers-overlay__header">
          <div className="controllers-overlay__title-mark" aria-hidden="true">
            <span />
            <span />
          </div>
          <div>
            <h1 id="controllers-overlay-title">Controllers</h1>
            <p>Players and connected gamepads</p>
          </div>
        </header>

        <div className="controllers-overlay__pads">
          <article className="controller-card controller-card--connected glass">
            <div className="controller-card__status">
              <span className="controller-card__player-badge">P1</span>
              <span className="controller-card__connection">
                <span className="controller-card__connection-dot" aria-hidden="true" />
                Connected
              </span>
            </div>

            <div className="controller-card__identity">
              <ControllerSilhouette />
              <div>
                <p className="controller-card__eyebrow">Wireless gamepad</p>
                <h2>Xbox Wireless Controller</h2>
              </div>
            </div>

            <div className="controller-card__battery" aria-label="Battery 72 percent">
              <BatteryGlyph />
              <span>Battery</span>
              <strong>72%</strong>
            </div>

            <div className="controller-card__actions" aria-label="Player 1 controller actions">
              <ControllerAction
                id="remap"
                label="Remap buttons"
                primary
                autoFocus
                onActivate={openRemap}
              />
              <ControllerAction id="reorder" label="Reorder" />
              <ControllerAction id="disconnect" label="Disconnect" />
            </div>
          </article>

          <article className="controller-card controller-card--empty glass">
            <div className="controller-card__status">
              <span className="controller-card__player-badge controller-card__player-badge--empty">
                P2
              </span>
              <span className="controller-card__available">Available</span>
            </div>

            <div className="controller-card__pairing">
              <div className="controller-card__pairing-icon" aria-hidden="true">
                <span />
              </div>
              <p>Press any button on a new controller…</p>
            </div>
          </article>
        </div>

        <footer className="controllers-overlay__hints" aria-label="Controller hints">
          <span>
            <b aria-hidden="true">Ⓐ</b> Select
          </span>
          <span>
            <b aria-hidden="true">Ⓑ</b> Close
          </span>
        </footer>
      </section>
    </div>
  );
}

interface ControllerActionProps {
  id: string;
  label: string;
  primary?: boolean;
  autoFocus?: boolean;
  onActivate?: () => void;
}

/**
 * Placeholder actions deliberately animate through WAAPI. The focus manager
 * invokes callbacks directly instead of dispatching native click events, so a
 * DOM animation here keeps keyboard/gamepad and pointer activation identical.
 */
function ControllerAction({
  id,
  label,
  primary = false,
  autoFocus = false,
  onActivate,
}: ControllerActionProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const activate = () => {
    if (onActivate) {
      onActivate();
      return;
    }

    const button = buttonRef.current;
    if (!button || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    button.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.08)' },
        { transform: 'scale(1)' },
      ],
      {
        duration: tuning.drillInMs,
        easing: tuning.popEase,
      },
    );
  };

  const focusable = useFocusable({
    id: `controllers-${id}`,
    scope: 'controllers',
    onAccept: activate,
    autoFocus,
  });

  return (
    <button
      ref={(element) => {
        buttonRef.current = element;
        focusable.ref(element);
      }}
      type="button"
      className={`controller-action${primary ? ' controller-action--primary' : ''}`}
      data-focused={focusable.focused}
      onClick={activate}
    >
      {label}
    </button>
  );
}

/** A small line-art pad keeps the connected card recognizable without assets. */
function ControllerSilhouette() {
  return (
    <svg
      className="controller-card__silhouette"
      viewBox="0 0 180 112"
      role="img"
      aria-label="Xbox controller"
    >
      <path
        d="M54 25c13-10 59-10 72 0 14 11 25 37 31 60 3 12-2 20-12 21-10 2-18-7-25-20l-5-8H65l-5 8c-7 13-15 22-25 20-10-1-15-9-12-21 6-23 17-49 31-60Z"
        className="controller-card__silhouette-body"
      />
      <path d="M55 45v24M43 57h24" className="controller-card__silhouette-control" />
      <circle cx="125" cy="48" r="5" className="controller-card__silhouette-button" />
      <circle cx="139" cy="59" r="5" className="controller-card__silhouette-button" />
      <circle cx="111" cy="59" r="5" className="controller-card__silhouette-button" />
      <circle cx="125" cy="70" r="5" className="controller-card__silhouette-button" />
      <circle cx="76" cy="42" r="9" className="controller-card__silhouette-stick" />
      <circle cx="99" cy="72" r="9" className="controller-card__silhouette-stick" />
      <circle cx="90" cy="51" r="4" className="controller-card__silhouette-guide" />
    </svg>
  );
}

function BatteryGlyph() {
  return (
    <span className="controller-battery-glyph" aria-hidden="true">
      <span className="controller-battery-glyph__level" />
      <span className="controller-battery-glyph__cap" />
    </span>
  );
}
