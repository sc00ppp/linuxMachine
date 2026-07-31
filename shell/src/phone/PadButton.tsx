/**
 * The one touch target used by the whole phone surface — pad buttons, keypad
 * keys, chips. Centralising it means every press in the app answers the same
 * way: fires on pointer-down, taps the vibration motor, squashes, brightens.
 */

import type { CSSProperties, ReactNode } from 'react';
import { usePressRepeat } from './press';
import './PadButton.css';

export interface PadButtonProps {
  onPress: () => void;
  /** Spoken label — most buttons show a glyph only. */
  ariaLabel: string;
  className?: string;
  /** Hold-to-repeat (D-pad directions). */
  repeat?: boolean;
  hapticMs?: number;
  disabled?: boolean;
  style?: CSSProperties;
  children?: ReactNode;
}

export default function PadButton({
  onPress,
  ariaLabel,
  className,
  repeat = false,
  hapticMs,
  disabled = false,
  style,
  children,
}: PadButtonProps) {
  const { pressed, handlers } = usePressRepeat(onPress, { repeat, hapticMs, disabled });

  return (
    <button
      type="button"
      className={className ? `pad-btn ${className}` : 'pad-btn'}
      style={style}
      aria-label={ariaLabel}
      disabled={disabled}
      data-pressed={pressed ? 'true' : 'false'}
      {...handlers}
      // Pointer-down handling calls preventDefault, so no synthetic click ever
      // reaches here from a touch. `detail === 0` means the "click" came from a
      // keyboard (Enter/Space on a paired keyboard or a screen reader).
      onClick={(event) => {
        if (event.detail === 0 && !disabled) onPress();
      }}
    >
      {children}
    </button>
  );
}
