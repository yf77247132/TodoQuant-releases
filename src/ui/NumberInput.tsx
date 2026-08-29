import DashedHint from './DashedHint'
import React, { useState, useRef, useEffect } from 'react';
import { Tooltip } from './Tooltip.tsx';
import { INPUT_BASE, LABEL_BASE } from './inputStyles.ts';

interface NumberInputProps {
  value: string | number;
  defaultValue: string | number;
  onChange: (value: string) => void;
  label?: string;
  tooltip?: string | React.ReactNode;
  min?: number;
  max?: number;
  step?: number | string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  allowPercent?: boolean;
}

export default function NumberInput({
  value,
  defaultValue,
  onChange,
  label,
  tooltip,
  min,
  max,
  step = '0.1',
  className = '',
  placeholder,
  disabled = false,
  allowPercent = false,
}: NumberInputProps) {
  const [localValue, setLocalValue] = useState<string>(String(value ?? ''));
  const inputRef = useRef<HTMLInputElement>(null);
  const localValueRef = useRef<string>(String(value ?? ''));
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const numericValue = Number(value);
    const numericLocalValue = Number(localValue);
    
    if (value === '' && localValue !== '') {
      setLocalValue('');
      localValueRef.current = '';
    } else if (!isNaN(numericValue) && !isNaN(numericLocalValue) && numericValue !== numericLocalValue) {
      setLocalValue(String(value ?? ''));
      localValueRef.current = String(value ?? '');
    } else if (String(value) !== localValue && isNaN(numericLocalValue)) {
      setLocalValue(String(value ?? ''));
      localValueRef.current = String(value ?? '');
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const newValue = e.target.value;
    setLocalValue(newValue);
    localValueRef.current = newValue;
    onChange(newValue);
  };

  const handleBlur = () => {
    if (disabled) return;
    blurTimeoutRef.current = setTimeout(() => {
      const val = localValueRef.current;
      const isSingleValue = /^-?\d*\.?\d*%?$/.test(val);
      const isPairValue = /^-?\d*\.?\d*%?;\s*-?\d*\.?\d*%?$/.test(val);
      if (val === '' || (isNaN(Number(val)) && val !== '-' && (!allowPercent || !(isSingleValue || isPairValue)))) {
        setLocalValue(String(defaultValue));
        onChange(String(defaultValue));
        localValueRef.current = String(defaultValue);
      }
    }, 100);
  };

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
    };
  }, []);

  return (
    <div className={`space-y-2 ${className}`}>
      {label && (
        <label className={LABEL_BASE}>
          {tooltip ? (
            <Tooltip content={tooltip}>
              <DashedHint className="cursor-help">
                {label}
              </DashedHint>
            </Tooltip>
          ) : (
            label
          )}
        </label>
      )}
      <input
        ref={inputRef}
        type={allowPercent ? 'text' : 'number'}
        inputMode={allowPercent ? 'text' : 'decimal'}
        value={localValue}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        className={INPUT_BASE}
        disabled={disabled}
      />
    </div>
  );
}
