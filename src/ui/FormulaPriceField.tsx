import DashedHint from './DashedHint'
import React, { useState, useRef, useEffect } from 'react';
import { Tooltip } from './Tooltip.tsx';
import { INPUT_BASE, LABEL_BASE } from './inputStyles.ts';

interface FormulaPriceFieldProps {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  tooltip?: string;
  placeholder?: string;
  disabled?: boolean;
  preview?: string | null;
  previewError?: boolean;
  onBlur?: () => void;
  onFocus?: () => void;
  allowPercent?: boolean;
}

export default function FormulaPriceField({
  value,
  onChange,
  label,
  tooltip,
  placeholder,
  disabled = false,
  preview,
  previewError = false,
  onBlur: onBlurProp,
  onFocus: onFocusProp,
  allowPercent = false,
}: FormulaPriceFieldProps) {
  const [localVal, setLocalVal] = useState(String(value ?? ''));
  const localValRef = useRef(String(value ?? ''));
  const prevExternalRef = useRef(String(value ?? ''));

  useEffect(() => {
    const extVal = String(value ?? '');
    if (extVal !== prevExternalRef.current) {
      setLocalVal(extVal);
      localValRef.current = extVal;
      prevExternalRef.current = extVal;
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocalVal(v);
    localValRef.current = v;
    prevExternalRef.current = v;
    onChange(v);
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className={LABEL_BASE}>
          <Tooltip content={tooltip || ''}>
            <DashedHint className="cursor-help">{label}</DashedHint>
          </Tooltip>
        </label>
      )}
      <input
        type="text"
        value={localVal}
        onChange={handleChange}
        onFocus={onFocusProp}
        onBlur={onBlurProp}
        placeholder={placeholder}
        className={INPUT_BASE}
        disabled={disabled}
      />
      {preview && localVal.startsWith('=') && (
        <div
          className={`text-3xs mt-1 ${previewError ? 'text-red-400' : 'text-text-muted'}`}
        >
          {preview}
        </div>
      )}
    </div>
  );
}
