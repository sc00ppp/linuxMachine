import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { platformById } from '../core/platforms';
import { useConsoleStore } from '../core/store';
import { focusManager, useFocusable } from '../focus';
import { tuning } from '../motion/tuning';
import { sound } from '../sound';
import { ControllerDiagram } from './ControllerDiagram';
import {
  PAD_VIEWBOX,
  XBOX_LAYOUT,
  createDefaultProfiles,
  defaultMappingFor,
  padLayoutFor,
  physicalButtonById,
  physicalButtonFromGamepadIndex,
  physicalButtonFromKeyboard,
  type MappingProfiles,
  type PadButton,
  type PhysicalButtonId,
} from './pads';
import './RemapRoom.css';

interface RemapRoomProps {
  platformId: string;
}

type MotionStyle = CSSProperties & {
  '--accent'?: string;
  '--remap-focus-ms': string;
  '--remap-focus-ease': string;
  '--remap-pop-ease': string;
  '--remap-pulse-ms': string;
};

function PadFocusTarget({
  platformId,
  button,
  autoFocus,
  listening,
  onAccept,
  onFocused,
}: {
  platformId: string;
  button: PadButton;
  autoFocus: boolean;
  listening: boolean;
  onAccept: (buttonId: string) => void;
  onFocused: (buttonId: string) => void;
}) {
  const focusId = `remap-button-${platformId}-${button.id}`;
  const accept = useCallback(
    () => onAccept(button.id),
    [button.id, onAccept],
  );
  const { ref, focused } = useFocusable({
    id: focusId,
    scope: 'remap',
    onAccept: accept,
    autoFocus,
  });

  useEffect(() => {
    if (focused) onFocused(button.id);
  }, [button.id, focused, onFocused]);

  const width = Math.max(button.width ?? 38, 42);
  const height = Math.max(button.height ?? button.width ?? 38, 42);
  const style: CSSProperties = {
    left: `${(button.x / PAD_VIEWBOX.width) * 100}%`,
    top: `${(button.y / PAD_VIEWBOX.height) * 100}%`,
    width: `${(width / PAD_VIEWBOX.width) * 100}%`,
    height: `${(height / PAD_VIEWBOX.height) * 100}%`,
  };

  return (
    <button
      ref={ref}
      className="remap-focus-target"
      type="button"
      tabIndex={-1}
      aria-label={`Rebind ${button.spokenLabel}`}
      aria-pressed={listening}
      style={style}
      onClick={accept}
      onPointerEnter={() => focusManager.focusId(focusId)}
    />
  );
}

function gamepadButtons(gamepad: Gamepad): boolean[] {
  return gamepad.buttons.map(
    (button) => button.pressed || button.value > 0.5,
  );
}

export function RemapRoom({ platformId }: RemapRoomProps) {
  const roomRef = useRef<HTMLDivElement | null>(null);
  const layout = padLayoutFor(platformId);
  const platform = platformById(platformId);
  const [profiles, setProfiles] = useState<MappingProfiles>(
    createDefaultProfiles,
  );
  const [selectedButtonId, setSelectedButtonId] = useState(
    () => layout.buttons[0]?.id ?? '',
  );
  const [listeningButtonId, setListeningButtonId] = useState<string | null>(
    null,
  );

  const selectedButton =
    layout.buttons.find((button) => button.id === selectedButtonId) ??
    layout.buttons[0];
  const displayedButtonId = selectedButton?.id ?? '';
  const currentMapping =
    profiles[platformId] ?? defaultMappingFor(platformId);
  const mappedPhysicalId = currentMapping[displayedButtonId];
  const mappedPhysicalButton = physicalButtonById(mappedPhysicalId);
  const isListening = listeningButtonId !== null;

  const roomStyle = useMemo<MotionStyle>(() => {
    const style: MotionStyle = {
      '--remap-focus-ms': `${tuning.focusMoveMs}ms`,
      '--remap-focus-ease': tuning.focusEase,
      '--remap-pop-ease': tuning.popEase,
      '--remap-pulse-ms': `${tuning.settleFadeMs}ms`,
    };
    if (platform) style['--accent'] = platform.accent;
    return style;
  }, [platform]);

  useEffect(() => {
    setSelectedButtonId(layout.buttons[0]?.id ?? '');
    setListeningButtonId(null);
    useConsoleStore.getState().setRemapListening(false);
  }, [layout.buttons, platformId]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;

    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const animation = room.animate(
      [
        { opacity: 0, transform: 'scale(1.012)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      {
        duration: reduced ? 1 : tuning.shelfOpenMs,
        easing: tuning.shelfEase,
        fill: 'both',
      },
    );
    return () => animation.cancel();
  }, []);

  useEffect(
    () => () => {
      // Closing the overlay through store state unmounts us immediately. Make
      // raw-input ownership impossible to strand if that ever happens while a
      // browser/gamepad event is between frames.
      useConsoleStore.getState().setRemapListening(false);
    },
    [],
  );

  const beginListening = useCallback((buttonId: string) => {
    setSelectedButtonId(buttonId);
    setListeningButtonId(buttonId);
    useConsoleStore.getState().setRemapListening(true);
  }, []);

  useEffect(() => {
    if (!listeningButtonId) return;

    let finished = false;
    let frame = 0;
    const previousButtons = new Map<number, boolean[]>();

    const complete = (
      physicalButton: PhysicalButtonId | undefined,
      cancelled = false,
    ) => {
      if (finished) return;
      finished = true;

      if (physicalButton) {
        setProfiles((previousProfiles) => {
          const profile =
            previousProfiles[platformId] ?? defaultMappingFor(platformId);
          return {
            ...previousProfiles,
            [platformId]: {
              ...profile,
              [listeningButtonId]: physicalButton,
            },
          };
        });
      }

      useConsoleStore.getState().setRemapListening(false);
      setListeningButtonId(null);
      sound.play(cancelled ? 'edge' : 'accept');
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;

      if (event.code === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        complete(undefined, true);
        return;
      }

      const physicalButton = physicalButtonFromKeyboard(event.code);
      if (!physicalButton) return;

      event.preventDefault();
      event.stopPropagation();
      complete(physicalButton);
    };

    // Seed the edge detector with the state that opened listening. In
    // particular, a held gamepad A must be released before it can be chosen;
    // otherwise the accept press would instantly bind the target back to A.
    for (const gamepad of navigator.getGamepads?.() ?? []) {
      if (gamepad) previousButtons.set(gamepad.index, gamepadButtons(gamepad));
    }

    const pollGamepads = () => {
      if (finished) return;

      for (const gamepad of navigator.getGamepads?.() ?? []) {
        if (!gamepad) continue;

        const current = gamepadButtons(gamepad);
        const previous = previousButtons.get(gamepad.index);
        if (!previous) {
          previousButtons.set(gamepad.index, current);
          continue;
        }

        for (let index = 0; index < current.length; index += 1) {
          if (current[index] && !previous[index]) {
            const physicalButton = physicalButtonFromGamepadIndex(index);
            if (physicalButton) {
              complete(physicalButton);
              return;
            }
          }
        }

        previousButtons.set(gamepad.index, current);
      }

      frame = window.requestAnimationFrame(pollGamepads);
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    frame = window.requestAnimationFrame(pollGamepads);

    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.cancelAnimationFrame(frame);
    };
  }, [listeningButtonId, platformId]);

  const mappingLabel = isListening
    ? 'Press a button…'
    : selectedButton && mappedPhysicalButton
      ? `${selectedButton.label} ← ${mappedPhysicalButton.label}`
      : 'Not assigned';

  return (
    <div
      ref={roomRef}
      className="remap-room"
      style={roomStyle}
      aria-label={`Button mapping for ${layout.name}`}
    >
      <div className="remap-room__wash" aria-hidden="true" />
      <main className="remap-room__workspace">
        {/* Decluttered by request: the pads ARE the explanation. Only the
            profile chip survives from the old header. */}
        <header className="remap-header remap-header--minimal">
          <div className="remap-header__profile glass">
            <span className="remap-header__profile-dot" aria-hidden="true" />
            Profile · Default
          </div>
        </header>

        <section className="remap-stage" aria-label="Controller diagrams">
          <article className="remap-pad-card glass glass--strong">
            <header className="remap-pad-card__header">
              <h2>{XBOX_LAYOUT.shortName}</h2>
            </header>
            <div className="remap-pad-canvas">
              <ControllerDiagram
                layout={XBOX_LAYOUT}
                activeButtonId={mappedPhysicalId}
                listening={isListening}
                label={`Xbox controller${mappedPhysicalButton ? `, ${mappedPhysicalButton.spokenLabel} mapped` : ''}`}
              />
            </div>
          </article>

          <div
            className={`remap-connection${isListening ? ' is-listening' : ''}`}
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="remap-connection__line" aria-hidden="true" />
            <div className="remap-connection__label glass">
              <span className="remap-connection__value">{mappingLabel}</span>
            </div>
            <span className="remap-connection__line" aria-hidden="true" />
          </div>

          <article className="remap-pad-card remap-pad-card--emulated glass glass--strong">
            <header className="remap-pad-card__header">
              <h2>{layout.shortName}</h2>
            </header>
            <div className="remap-pad-canvas remap-pad-canvas--interactive">
              <ControllerDiagram
                layout={layout}
                activeButtonId={displayedButtonId}
                listening={isListening}
                label={`${layout.name}${selectedButton ? `, ${selectedButton.spokenLabel} selected` : ''}`}
              />
              <div className="remap-focus-layer" aria-label="Remappable buttons">
                {layout.buttons.map((button, index) => (
                  <PadFocusTarget
                    key={button.id}
                    platformId={platformId}
                    button={button}
                    autoFocus={index === 0}
                    listening={listeningButtonId === button.id}
                    onAccept={beginListening}
                    onFocused={setSelectedButtonId}
                  />
                ))}
              </div>
            </div>
          </article>
        </section>

        <footer className="remap-footer remap-footer--minimal">
          <div className="remap-footer__hints" aria-label="Button hints">
            {isListening ? (
              <span className="remap-hint">
                <kbd>Esc</kbd>
                Cancel
              </span>
            ) : (
              <>
                <span className="remap-hint">
                  <kbd>A</kbd>
                  Rebind
                </span>
                <span className="remap-hint">
                  <kbd>B</kbd>
                  Done
                </span>
              </>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
