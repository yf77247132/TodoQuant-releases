import React, { useState, useEffect, useRef } from 'react';
import { INPUT_BASE, LABEL_BASE } from './inputStyles.ts';

interface TextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  defaultValue: string;
  onChange: (value: string) => void;
  label?: string;
  containerClassName?: string;
}

export default function TextInput({
  value,
  defaultValue,
  onChange,
  label,
  className = '',
  containerClassName = '',
  placeholder,
  ...props
}: TextInputProps) {
  const [localValue, setLocalValue] = useState<string>(value ?? '');
  const localValueRef = useRef<string>(value ?? '');
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalValue(value ?? '');
    localValueRef.current = value ?? '';
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    localValueRef.current = e.target.value;
    onChange(e.target.value);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    blurTimeoutRef.current = setTimeout(() => {
      if (localValueRef.current === '') {
        setLocalValue(defaultValue);
        onChange(defaultValue);
      }
    }, 100);
    props.onBlur?.(e);
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
    <div className={`${label ? 'space-y-2' : ''} ${containerClassName}`}>
      {label && <label className={LABEL_BASE}>{label}</label>}
      <input
        type="text"
        value={localValue}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={`${INPUT_BASE} ${className}`}
        {...props}
      />
    </div>
  );
}
