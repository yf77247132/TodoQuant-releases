import DashedHint from '../../ui/DashedHint'
import React, { memo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Filter } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../../ui/Tooltip.tsx';

export interface FilterDropdownProps {
  label: string;
  field: string;
  options: string[];
  filters: Record<string, string | null>;
  activeFilter: string | null;
  dropdownPos: { top: number; left: number };
  onFilterClick: (e: React.MouseEvent<HTMLButtonElement>, field: string) => void;
  onSelectFilter: (field: string, value: string | null) => void;
  tooltip?: string;
  formatOption?: (value: string) => string;
}

export const FilterDropdown = memo<FilterDropdownProps>(({
  label,
  field,
  options,
  filters,
  activeFilter,
  dropdownPos,
  onFilterClick,
  onSelectFilter,
  tooltip,
  formatOption,
}) => {
  const { t } = useTranslation();
  const labelEl = tooltip ? (
    <Tooltip content={tooltip}>
      <DashedHint className="cursor-help">{label}</DashedHint>
    </Tooltip>
  ) : (
    <>{label}</>
  );
  return (
  <div className="relative inline-block group">
    <button
      onClick={(e) => onFilterClick(e, field)}
      className={`flex items-center gap-1 hover:text-text-primary transition-colors py-1 ${filters[field] ? 'text-brand-yellow' : ''}`}
    >
      {labelEl}
      {filters[field] ? <Filter size={10} strokeWidth={2} /> : <ChevronDown size={10} strokeWidth={2} />}
    </button>

    {activeFilter === field && createPortal(
      <>
        <div className="fixed inset-0 z-[var(--z-modal)]" onMouseDown={(e) => { if (e.target === e.currentTarget) onSelectFilter('', null); }} />
        <div
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            zIndex: 101,
          }}
          className="mt-1 w-36 bg-dropdown-hover border border-border-default rounded-md shadow-2xl py-1 flex flex-col max-h-[160px] overflow-y-auto custom-scrollbar"
        >
          <button
            onClick={() => onSelectFilter(field, null)}
            className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-2xs text-text-secondary transition-colors"
          >
            {t('dashboard.filter.all')}
          </button>
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => onSelectFilter(field, opt)}
              className={`w-full text-left px-3 py-1.5 hover:bg-white/5 text-2xs transition-colors ${filters[field] === opt ? 'text-brand-yellow font-bold bg-brand-yellow/5' : 'text-text-primary'}`}
            >
              {formatOption ? formatOption(opt) : opt}
            </button>
          ))}
        </div>
      </>,
      document.body,
    )}
  </div>
  );
});

FilterDropdown.displayName = 'FilterDropdown';

export const fmt = (n: string | number, instId?: string, maxDigits = 10, refValue?: string | number): string => {
  const s = String(n);
  const v = parseFloat(s);
  if (isNaN(v)) return '-';

  const ref = refValue ?? (s.includes('.') ? s : undefined);
  let digits = 2;
  if (ref !== undefined) {
    const refStr = String(ref);
    if (refStr.includes('.')) {
      const parts = refStr.split('.');
      digits = Math.min(parts[1].length, maxDigits);
    }
  }

  const factor = Math.pow(10, digits);
  const val = Math.floor(v * factor + 1e-10) / factor;
  const formatted = val.toFixed(digits).replace(/\.?0+$/, '');
  return formatted || '0';
};

const MAX_DIGITS = 8;
export const fmtTickSz = (n: string | number, tickSz?: string | number | null): string => {
  const s = String(n);
  const v = parseFloat(s);
  if (isNaN(v)) return '-';

  let digits = 0;
  if (tickSz !== undefined && tickSz !== null) {
    const tickStr = String(tickSz);
    if (tickStr.includes('.')) {
      digits = tickStr.split('.')[1].length;
    } else {
      digits = 0;
    }
  } else {
    digits = s.includes('.') ? Math.min(s.split('.')[1].length, MAX_DIGITS) : 0;
  }
  digits = Math.min(digits, MAX_DIGITS);

  const factor = Math.pow(10, digits);
  const val = Math.floor(v * factor + 1e-10) / factor;
  const formatted = val.toFixed(digits).replace(/\.?0+$/, '');
  return formatted || '0';
};

export const fmtPct = (n: string | number): string => {
  const v = parseFloat(String(n));
  return isNaN(v) ? '--' : `${(v * 100).toFixed(2)}%`;
};
