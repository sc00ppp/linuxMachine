import { useRef, type CSSProperties } from 'react';
import { useConsoleStore } from '../core/store';
import { channelById } from '../core/channels';
import { useFocusable } from '../focus';
import { Glyph } from '../icons';
import { sound } from '../sound';
import { tuning } from '../motion/tuning';
import './HomeShelf.css';

/** v1 quick actions are inert — focusable + a satisfying pulse, no-op otherwise. */
const QUICK_ACTIONS_LEFT = [
  { id: 'volume', label: 'Volume', glyph: '🔊' },
  { id: 'controllers', label: 'Controllers', glyph: '🎮' },
] as const;
const QUICK_ACTIONS_RIGHT = [
  { id: 'phone', label: 'Phone', glyph: '📱' },
  { id: 'sleep', label: 'Sleep', glyph: '🌙' },
] as const;

/**
 * The universal Home overlay (DESIGN.md §4) — identical look/sound/timing no
 * matter what app is running underneath, which is the whole point ("the
 * single strongest cohesion lever we have"). Rendered by App.tsx only while
 * `shelfOpen` is true, so it closes by unmounting: there's no exit animation
 * to choreograph, only an entrance. That entrance (backdrop fade + card
 * slide-up) is driven by plain CSS `animation` keyframes fed timing values
 * from `tuning`, which keeps this component's only "self-contained on mount"
 * requirement trivially true.
 */
export function HomeShelf() {
  const runningChannel = useConsoleStore((s) => s.runningChannel);
  const channel = runningChannel ? channelById(runningChannel) : undefined;

  const handleResume = () => {
    useConsoleStore.getState().closeShelf();
    sound.play('shelfClose');
  };

  const handleQuit = () => {
    sound.play('back');
    useConsoleStore.getState().requestReturn();
  };

  const resume = useFocusable({
    id: 'shelf-resume',
    scope: 'shelf',
    onAccept: handleResume,
    autoFocus: true,
  });
  const quit = useFocusable({ id: 'shelf-quit', scope: 'shelf', onAccept: handleQuit });

  return (
    <div
      className="home-shelf"
      style={
        {
          '--shelf-open-ms': `${tuning.shelfOpenMs}ms`,
          '--shelf-ease': tuning.shelfEase,
        } as CSSProperties
      }
    >
      <div className="home-shelf__backdrop" aria-hidden="true" />

      <div className="home-shelf__card">
        <div className="home-shelf__flank home-shelf__flank--left">
          {QUICK_ACTIONS_LEFT.map((a) => (
            <QuickChip key={a.id} {...a} />
          ))}
        </div>

        <div
          className="home-shelf__app-card"
          style={{ '--accent': channel?.accent ?? 'var(--text-dim)' } as CSSProperties}
        >
          <div className="home-shelf__accent-strip" />
          <div className="home-shelf__app-glyph" aria-hidden="true">
            {channel ? (
              <Glyph id={channel.id} fallback={channel.glyph} />
            ) : (
              <Glyph id="spark" fallback="✦" />
            )}
          </div>
          <h2 className="home-shelf__app-title">{channel?.title ?? 'Home'}</h2>
          <div className="home-shelf__app-actions">
            <button
              ref={resume.ref}
              type="button"
              className="shelf-btn shelf-btn--primary"
              data-focused={resume.focused}
              onClick={handleResume}
            >
              Resume
            </button>
            <button
              ref={quit.ref}
              type="button"
              className="shelf-btn"
              data-focused={quit.focused}
              onClick={handleQuit}
            >
              Quit to Home
            </button>
          </div>
        </div>

        <div className="home-shelf__flank home-shelf__flank--right">
          {QUICK_ACTIONS_RIGHT.map((a) => (
            <QuickChip key={a.id} {...a} />
          ))}
        </div>
      </div>
    </div>
  );
}

interface QuickChipProps {
  id: string;
  label: string;
  glyph: string;
}

/** Quick-action chip — Volume/Controllers/Phone/Sleep. v1: focusable, and on
 * accept (gamepad/keyboard) or click it just pulses with `tuning.popEase`;
 * no actual behavior yet. Pulse runs via WAAPI directly on the DOM node
 * (rather than a CSS animation class) so it fires identically whether
 * triggered by pointer click or by the focus manager's `accept()`, which
 * never touches the DOM's native click machinery. */
function QuickChip({ id, label, glyph }: QuickChipProps) {
  const elRef = useRef<HTMLButtonElement | null>(null);

  const pulse = () => {
    // Controllers is real now: it opens the Wii-style overlay (DESIGN.md §12)
    // on top of the shelf stack. The rest remain pulse-only placeholders.
    if (id === 'controllers') {
      sound.play('shelfOpen');
      useConsoleStore.getState().openControllers();
      return;
    }
    const el = elRef.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    el.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }],
      { duration: 260, easing: tuning.popEase },
    );
  };

  const { ref, focused } = useFocusable({ id: `shelf-${id}`, scope: 'shelf', onAccept: pulse });

  return (
    <button
      ref={(el) => {
        elRef.current = el;
        ref(el);
      }}
      type="button"
      className="quick-chip"
      data-focused={focused}
      onClick={pulse}
    >
      <span className="quick-chip__glyph" aria-hidden="true">
        <Glyph id={id} fallback={glyph} />
      </span>
      <span className="quick-chip__label">{label}</span>
    </button>
  );
}
