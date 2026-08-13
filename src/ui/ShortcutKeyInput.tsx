import React, { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { INPUT_BASE } from './inputStyles.ts';

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

const FORBIDDEN_MODIFIER_COMBOS = [
  ['ctrl', 'alt'],
  ['ctrl', 'alt', 'shift'],
] as const;

const CODE_DISPLAY_MAP: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Space: 'Space',
};

const KEY_STORAGE_MAP: Record<string, string> = {
  ' ': 'space',
};

const DISPLAY_MAP: Record<string, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  space: 'Space',
};

function extractRegularKey(e: KeyboardEvent): string | null {
  const { code, key } = e;

  if (code.startsWith('F') && /^F\d{1,2}$/.test(code)) {
    return code.toLowerCase();
  }

  if (code.startsWith('Key') && code.length === 4) {
    return code[3].toLowerCase();
  }

  if (code.startsWith('Digit') && code.length === 6) {
    return code[5];
  }

  if (CODE_DISPLAY_MAP[code]) {
    return CODE_DISPLAY_MAP[code].toLowerCase();
  }

  if (key && key.length === 1 && !MODIFIER_KEYS.has(key)) {
    return KEY_STORAGE_MAP[key] ?? key.toLowerCase();
  }

  return null;
}

export function parseShortcutKey(e: KeyboardEvent): string | null {
  if (e.key === 'Backspace' || e.key === 'Delete') {
    return '';
  }

  if (e.key === 'Escape') {
    return null;
  }

  const regularKey = extractRegularKey(e);
  if (!regularKey) {
    return null;
  }

  const parts: string[] = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');

  const partSet = new Set(parts);
  for (const forbidden of FORBIDDEN_MODIFIER_COMBOS) {
    if (forbidden.every(k => partSet.has(k))) {
      return null;
    }
  }

  parts.push(regularKey);
  return parts.join('+');
}

export function formatShortcutKey(key: string): string {
  if (!key) return '';
  return key
    .split('+')
    .map(part => {
      if (DISPLAY_MAP[part]) return DISPLAY_MAP[part];
      if (/^f\d{1,2}$/.test(part)) return part.toUpperCase();
      if (part.length === 1) return part.toUpperCase();
      return part;
    })
    .join('+');
}

export function shortcutKeyToBadge(key: string): string {
  return formatShortcutKey(key);
}

interface ShortcutKeyInputProps {
  value: string;
  onChange: (value: string) => void;
  conflictMsg?: string;
  className?: string;
}

export default function ShortcutKeyInput({
  value,
  onChange,
  conflictMsg,
  className = '',
}: ShortcutKeyInputProps) {
  const { t } = useTranslation();
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFocus = useCallback(() => {
    setListening(true);
  }, []);

  const handleBlur = useCallback(() => {
    setListening(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!listening) return;

      e.preventDefault();
      e.stopPropagation();

      const result = parseShortcutKey(e.nativeEvent);

      if (e.key === 'Escape') {
        setListening(false);
        inputRef.current?.blur();
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        onChange('');
        setListening(false);
        inputRef.current?.blur();
        return;
      }

      if (result === null) return;

      onChange(result);
      setListening(false);
      inputRef.current?.blur();
    },
    [listening, onChange],
  );

  const displayValue = listening ? '' : formatShortcutKey(value);

  return (
    <div className={`w-full ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={displayValue}
        readOnly
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={listening ? t('common.shortcutKeyListening') : t('common.shortcutKeyPlaceholder')}
        className={[
          INPUT_BASE,
          'font-mono cursor-pointer select-none',
          listening
            ? 'bg-brand-yellow/10 border-brand-yellow/30'
            : '',
        ].join(' ')}
      />
      {conflictMsg && (
        <p className="text-2xs text-trade-red mt-1">{conflictMsg}</p>
      )}
    </div>
  );
}
