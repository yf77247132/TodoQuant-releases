import React from 'react';
import { INPUT_BASE, LABEL_BASE } from './inputStyles.ts';

interface DatePickerInputProps {
  label?: string;
  value: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
  containerClassName?: string;
}

export default function DatePickerInput({
  label,
  value,
  defaultValue,
  min,
  max,
  onChange,
  containerClassName,
}: DatePickerInputProps) {
  return (
    <div className={`space-y-2 ${containerClassName ?? ''}`}>
      {label && <label className={LABEL_BASE}>{label}</label>}
      <input
        type="date"
        value={value}
        defaultValue={defaultValue}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_BASE} !h-[37px] !rounded-[6px] appearance-none [color-scheme:dark]`}
      />
    </div>
  );
}
