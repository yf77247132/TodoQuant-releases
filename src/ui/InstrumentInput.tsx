import DashedHint from './DashedHint'
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Tooltip } from './Tooltip.tsx';
import { INPUT_BASE, LABEL_BASE } from './inputStyles.ts';
import { getFavoriteInstruments, type FavoriteInstrument } from '../lib/favoriteInstruments.ts';

interface InstrumentInputProps {
  value: string;
  defaultValue: string;
  onChange: (value: string) => void;
  label?: string;
  tooltip?: string;
  className?: string;
  placeholder?: string;
  exchange?: string;
  allowEmpty?: boolean;
}

interface Instrument {
  instId: string;
  instType: string;
  baseCcy: string;
  quoteCcy: string;
  state: string;
}

export default function InstrumentInput({
  value,
  defaultValue,
  onChange,
  label,
  tooltip,
  className = '',
  placeholder,
  exchange = 'OKX',
  allowEmpty = false,
}: InstrumentInputProps) {
  const { t } = useTranslation();
  const [localValue, setLocalValue] = useState<string>(value ?? '');
  const valueRef = useRef(value ?? '');
  const [suggestions, setSuggestions] = useState<Instrument[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalValue(value ?? '');
    valueRef.current = value ?? '';
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const inWrapper = wrapperRef.current?.contains(event.target as Node);
      const inDropdown = dropdownRef.current?.contains(event.target as Node);
      if (!inWrapper && !inDropdown) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const fetchSuggestions = async (query: string) => {
    if (!query) {
      setSuggestions([]);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/instruments/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.ok && Array.isArray(data.data)) {
        setSuggestions(data.data);
      } else {
        setSuggestions([]);
      }
    } catch (e) {
      if (controller.signal.aborted) {
        return;
      }
      console.error('Failed to fetch instruments', e);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalValue(val);
    valueRef.current = val;
    onChange(val);

    if (val) {
      setShowDropdown(true);
      fetchSuggestions(val);
    } else {
      setSuggestions(getFavoriteInstruments(exchange).map(f => ({
        instId: f.instId,
        instType: f.instType,
        baseCcy: f.instId.split('-')[0] || '',
        quoteCcy: f.instId.split('-')[1] || '',
        state: 'live',
      })));
      setShowDropdown(true);
    }
  };

  const handleBlur = () => {
    if (allowEmpty) return;
    blurTimeoutRef.current = setTimeout(() => {
      if (valueRef.current === '') {
        setLocalValue(defaultValue);
        valueRef.current = defaultValue;
        onChange(defaultValue);
      }
    }, 200);
  };

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
    };
  }, []);

  const handleSelect = (instId: string) => {
    setLocalValue(instId);
    valueRef.current = instId;
    onChange(instId);
    setShowDropdown(false);
  };

  return (
    <>
      <div className={`space-y-2 relative ${className}`} ref={wrapperRef}>
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
          type="text"
          value={localValue}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          onFocus={() => {
            if (localValue) {
              setShowDropdown(true);
              fetchSuggestions(localValue);
            } else {
              setSuggestions(getFavoriteInstruments(exchange).map(f => ({
                instId: f.instId,
                instType: f.instType,
                baseCcy: f.instId.split('-')[0] || '',
                quoteCcy: f.instId.split('-')[1] || '',
                state: 'live',
              })));
              setShowDropdown(true);
            }
          }}
          className={INPUT_BASE}
        />
      </div>
      {showDropdown && suggestions.length > 0 && inputRef.current && createPortal(
        <ul
          ref={dropdownRef}
          className="fixed z-[1000] max-h-60 overflow-auto bg-dropdown-bg border border-border-default rounded-md shadow-lg"
          style={{
            left: inputRef.current.getBoundingClientRect().left,
            top: inputRef.current.getBoundingClientRect().bottom + 4,
            width: inputRef.current.getBoundingClientRect().width,
          }}
        >
          {!localValue && (
            <li className="px-3 py-1.5 text-2xs text-text-tertiary uppercase tracking-wider border-b border-border-subtle">
              {t('ui.instrumentInput.favorites')}
            </li>
          )}
          {suggestions.map((inst) => (
            <li
              key={inst.instId}
              className="px-3 py-2 text-sm text-gray-300 hover:bg-brand-blue/20 hover:text-text-primary cursor-pointer transition-colors"
              onClick={() => handleSelect(inst.instId)}
            >
              <div className="flex justify-between items-center">
                <span className="font-medium">{inst.instId}</span>
                <span className="text-xs text-gray-500">
                  {inst.instType === 'SPOT' ? t('ui.instrumentInput.spot') : inst.instType === 'SWAP' ? t('ui.instrumentInput.swap') : inst.instType}
                </span>
              </div>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}
