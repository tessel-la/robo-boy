import React, { useState } from 'react';
import type { InputHTMLAttributes } from 'react';

/** Splits a comma-separated list: items trimmed, empty ones dropped. */
export const parseCommaList = (text: string): string[] =>
  text.split(',').map(item => item.trim()).filter(Boolean);

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((item, index) => item === b[index]);

type CommaListInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string[];
  onChange: (items: string[]) => void;
};

/**
 * A text field for a comma-separated list. It shows the text as typed, so a separator or a space survives until
 * the next item is written, and reports the parsed list on every change. Re-rendering the list from the array
 * instead would drop a trailing comma on each keystroke, leaving no way to type a second item.
 */
export default function CommaListInput({ value, onChange, ...input }: CommaListInputProps) {
  const [text, setText] = useState(() => value.join(', '));
  // A list set elsewhere (a preset, a reset) replaces the text; the echo of what is being typed does not.
  if (!sameList(parseCommaList(text), parseCommaList(value.join(',')))) {
    setText(value.join(', '));
  }
  return (
    <input
      {...input}
      type="text"
      value={text}
      onChange={event => {
        setText(event.target.value);
        onChange(parseCommaList(event.target.value));
      }}
    />
  );
}
