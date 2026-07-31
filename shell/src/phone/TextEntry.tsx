/**
 * Text entry. DESIGN.md §5: text always belongs to the phone when one is
 * paired, and the TV shows it appearing live — so every keystroke goes out as
 * `{text, commit:false}` and Enter commits with `{text, commit:true}`.
 */

import { useState } from 'react';
import PadButton from './PadButton';
import { haptic } from './press';
import './TextEntry.css';

export interface TextEntryProps {
  sendText: (text: string, commit: boolean) => void;
}

export default function TextEntry({ sendText }: TextEntryProps) {
  const [value, setValue] = useState('');

  const commit = (): void => {
    if (value === '') return;
    sendText(value, true);
    setValue('');
    haptic(14);
    // Focus deliberately stays in the field: committing a search term is
    // usually followed by another one, and dropping the keyboard between them
    // makes the phone feel like it hung up on you.
  };

  return (
    <form
      className="text-entry glass"
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
    >
      <input
        className="text-entry-field"
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          // Live keystrokes — the TV mirrors what you are typing as you type.
          sendText(next, false);
        }}
        placeholder="Type for the TV…"
        aria-label="Send text to the console"
        type="text"
        inputMode="text"
        enterKeyHint="send"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="sentences"
        spellCheck={false}
        maxLength={240}
      />
      <PadButton
        className="text-entry-send"
        ariaLabel="Send"
        hapticMs={12}
        disabled={value === ''}
        onPress={commit}
      >
        ↵
      </PadButton>
    </form>
  );
}
