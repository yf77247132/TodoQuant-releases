import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import DashedHint from '../../ui/DashedHint';
import { Tooltip } from '../../ui/Tooltip.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';
import CoinIcon from '../../ui/CoinIcon.tsx';
import { useScrollChaining } from '../../hooks/useScrollChaining.ts';
import { getTickSzSync, ensureLoaded } from '../../lib/clientTickSz.ts';
import { SymbolUtils } from '../../lib/symbolUtils.ts';
import { DEFAULT_ACCOUNT_COLORS } from '../../constants/colors.ts';
import { POS_SIDE_LABELS, type PositionSide } from '../../constants/positionFields.ts';
import { FilterDropdown, fmtTickSz } from './sharedUtils.tsx';

export interface HistoryPosition {
  posId: string;
  instId: string;
  ccy: string;
  direction: 'long' | 'short';
  lever: string;
  openAvgPx: string;
  closeAvgPx: string;
  openMaxPos: string;
  closeTotalPos: string;
  realizedPnl: string;
  fee?: string;
  fundingFee?: string;
  liqPenalty?: string;
  pnl?: string;
  pnlRatio: string;
  posSide: 'long' | 'short' | 'net';
  mgnMode: 'cross' | 'isolated';
  cTime: string;
  uTime: string;
  type: string;
  typeDisplay: string;
  _account: number;
  _accountId: string;
  exchange: string;
}

interface HistoryPositionTableProps {
  positions: HistoryPosition[];
  accountNames: Record<string, string>;
  accountColors: Record<string, string>;
  accountIdNames?: Record<string, string>;
  accountIdColors?: Record<string, string>;
}

const INITIAL_RENDER_COUNT = 50;
const LOAD_MORE_STEP = 50;

const fmtTs = (ts: string | undefined): string => {
  if (!ts) return '-';
  const n = parseInt(String(ts));
  if (!Number.isFinite(n) || n <= 0) return '-';
  const d = new Date(n);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const fmtNum = (v: string | number | undefined, digits = 6): string => {
  if (v === undefined || v === null) return '-';
  const s = String(v);
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return '-';
  if (Math.abs(n) < 1e-10) return '0';
  return parseFloat(n.toFixed(digits)).toString();
};

const fmtPnl = (v: string | number | undefined): string => {
  if (v === undefined || v === null) return '-';
  const n = parseFloat(String(v));
  if (!Number.isFinite(n)) return '-';
  if (Math.abs(n) < 0.005) return '0';
  const truncated = Math.trunc(n * 100) / 100;
  if (truncated === 0) return '0';
  const s = truncated.toString();
  return n > 0 ? '+' + s : s;
};

const fmtPct = (v: string | number | undefined): string => {
  if (v === undefined || v === null) return '--';
  const n = parseFloat(String(v));
  if (!Number.isFinite(n)) return '--';
  const truncated = Math.trunc(n * 10000) / 100;
  return `${truncated.toString()}%`;
};

interface HistoryPositionRowProps {
  p: HistoryPosition;
  accLabel: string;
  color: string;
  onAccountFilter: (name: string) => void;
  onInstIdFilter: (instId: string) => void;
  onDirectionFilter: (dirLabel: string) => void;
  onTypeFilter: (typeLabel: string) => void;
  dataIdx?: number;
}

const areHistoryPositionRowPropsEqual = (prev: HistoryPositionRowProps, next: HistoryPositionRowProps) =>
  prev.p === next.p && prev.color === next.color && prev.accLabel === next.accLabel;

const HistoryPositionRow = memo(({ p, accLabel, color, onAccountFilter, onInstIdFilter, onDirectionFilter, onTypeFilter, dataIdx }: HistoryPositionRowProps) => {
  const { t } = useTranslation();
  const pnlNum = parseFloat(p.realizedPnl || '0');
  const dirLabel = t(POS_SIDE_LABELS[p.direction as PositionSide] || ('position.' + p.direction));
  const dirColor = p.direction === 'long' ? 'text-trade-green' : p.direction === 'short' ? 'text-trade-red' : 'text-text-secondary';
  const typeText = p.typeDisplay;
  const showCloseInfo = !!p.type && p.type !== '';
  return (
    <tr className="h-9 hover:bg-surface-3/50 transition-colors" data-idx={dataIdx} data-dir={p.direction}>
      <td className="px-3 py-2.5">
        <Tooltip content={t('order.clickToFilter')}>
          <DashedHint className="font-bold cursor-pointer" style={{ color }}
            onClick={() => onAccountFilter(accLabel)}
          >
            {accLabel}
          </DashedHint>
        </Tooltip>
      </td>
      <td className="px-3 py-2.5">
        <Tooltip content={t('order.clickToFilter')}>
          <DashedHint className="font-mono text-text-primary cursor-pointer inline-flex items-center gap-1.5"
            onClick={() => onInstIdFilter(p.instId)}
          >
            <CoinIcon symbol={p.instId.split('-')[0]} size={16} />
            {p.instId}
          </DashedHint>
        </Tooltip>
      </td>
      <td className="px-3 py-2.5 text-left font-mono text-text-primary">{p.lever ? `${parseInt(String(p.lever), 10)}x` : '--'}</td>
      <td className="px-3 py-2.5 text-left">
        <Tooltip content={t('order.clickToFilter')}>
          <DashedHint className={`font-bold cursor-pointer ${dirColor}`}
            onClick={() => onDirectionFilter(dirLabel)}
          >
            {dirLabel}
          </DashedHint>
        </Tooltip>
      </td>
      <td className="px-3 py-2.5 text-left font-mono text-text-primary">{fmtNum(p.openMaxPos, 6)}</td>
      <td className="px-3 py-2.5 text-left font-mono text-text-primary">{fmtNum(p.closeTotalPos, 6)}</td>
      <td className="px-3 py-2.5 text-left font-mono text-text-primary">{fmtTickSz(p.openAvgPx || 0, getTickSzSync(p.instId))}</td>
      <td className="px-3 py-2.5 text-left font-mono text-text-primary">{fmtTickSz(p.closeAvgPx || 0, getTickSzSync(p.instId))}</td>
      <td className={`px-3 py-2.5 text-left font-mono ${pnlNum > 0 ? 'text-trade-green' : pnlNum < 0 ? 'text-trade-red' : 'text-text-primary'}`}>
        {fmtPnl(p.realizedPnl)}
      </td>
      <td className={`px-3 py-2.5 text-left font-mono ${pnlNum > 0 ? 'text-trade-green' : pnlNum < 0 ? 'text-trade-red' : 'text-text-primary'}`}>
        {fmtPct(p.pnlRatio)}
      </td>
      <td className="px-3 py-2.5 text-left text-text-secondary">
        {p.mgnMode === 'cross' ? t('order.cross') : p.mgnMode === 'isolated' ? t('order.isolated') : p.mgnMode || '--'}
      </td>
      <td className="px-3 py-2.5 text-left font-mono text-text-secondary">{fmtTs(p.cTime)}</td>
      <td className="px-3 py-2.5 text-left font-mono text-text-secondary">{showCloseInfo ? fmtTs(p.uTime) : '-'}</td>
      <td className="px-3 py-2.5 text-left">
        {showCloseInfo ? (
          <Tooltip content={t('order.clickToFilter')}>
            <DashedHint className="text-text-secondary cursor-pointer"
              onClick={() => onTypeFilter(typeText)}
            >
              {typeText}
            </DashedHint>
          </Tooltip>
        ) : '-'}
      </td>
    </tr>
  );
}, areHistoryPositionRowPropsEqual);
HistoryPositionRow.displayName = 'HistoryPositionRow';

export const HistoryPositionTable = memo(({ positions, accountNames, accountColors, accountIdNames, accountIdColors }: HistoryPositionTableProps) => {
  const { t } = useTranslation();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  useScrollChaining(scrollContainerRef);

  const [renderCount, setRenderCount] = useState(INITIAL_RENDER_COUNT);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { ensureLoaded(); }, []);

  const [filters, setFilters] = useState<{
    account: string | null;
    instId: string | null;
    direction: string | null;
    type: string | null;
  }>({ account: null, instId: null, direction: null, type: null });
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  const dirLabelOf = useCallback((dir: string) => {
    return t(POS_SIDE_LABELS[(dir as PositionSide) || 'long'] || ('position.' + dir));
  }, [t]);

  const onAccountFilter = useCallback((name: string) => {
    setFilters(prev => prev.account === name ? { ...prev, account: null } : { ...prev, account: name });
  }, []);
  const onInstIdFilter = useCallback((instId: string) => {
    setFilters(prev => prev.instId && SymbolUtils.isSameSymbol(prev.instId, instId) ? { ...prev, instId: null } : { ...prev, instId });
  }, []);
  const onDirectionFilter = useCallback((dirLabel: string) => {
    setFilters(prev => prev.direction === dirLabel ? { ...prev, direction: null } : { ...prev, direction: dirLabel });
  }, []);
  const onTypeFilter = useCallback((typeLabel: string) => {
    setFilters(prev => prev.type === typeLabel ? { ...prev, type: null } : { ...prev, type: typeLabel });
  }, []);

  const filteredPositions = useMemo(() => {
    return positions.filter(p => {
      if (!p) return false;
      const accountName = (p._accountId && accountIdNames?.[p._accountId]) || accountNames[p._account] || `#${p._account}`;
      const dirLabel = dirLabelOf(p.direction);
      if (filters.account && accountName !== filters.account) return false;
      if (filters.instId && !SymbolUtils.isSameSymbol(p.instId, filters.instId)) return false;
      if (filters.direction && dirLabel !== filters.direction) return false;
      if (filters.type && p.typeDisplay !== filters.type) return false;
      return true;
    });
  }, [positions, filters, accountNames, accountIdNames, dirLabelOf]);

  const sorted = useMemo(() => {
    const arr = [...filteredPositions].sort((a, b) => {
      const tb = parseInt(b.uTime || b.cTime || '0');
      const ta = parseInt(a.uTime || a.cTime || '0');
      return tb - ta;
    });
    return arr;
  }, [filteredPositions]);

  const uniqueValues = useMemo(() => {
    const accs = new Set<string>();
    const insts = new Set<string>();
    const dirs = new Set<string>();
    const types = new Set<string>();
    positions.forEach(p => {
      if (!p) return;
      accs.add((p._accountId && accountIdNames?.[p._accountId]) || accountNames[p._account] || `#${p._account}`);
      insts.add(p.instId);
      if (p.direction) dirs.add(dirLabelOf(p.direction));
      if (p.typeDisplay) types.add(p.typeDisplay);
    });
    return { account: Array.from(accs), instId: Array.from(insts), direction: Array.from(dirs), type: Array.from(types) };
  }, [positions, accountNames, accountIdNames, dirLabelOf]);

  const visiblePositions = useMemo(() => {
    return sorted.slice(0, renderCount);
  }, [sorted, renderCount]);

  useEffect(() => {
    setRenderCount(INITIAL_RENDER_COUNT);
  }, [filters.account, filters.instId, filters.direction, filters.type]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < 100 && renderCount < sorted.length) {
      setRenderCount(prev => Math.min(prev + LOAD_MORE_STEP, sorted.length));
    }
  }, [sorted.length, renderCount]);

  const handleFilterClick = useCallback((e: React.MouseEvent<HTMLButtonElement>, field: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom, left: rect.left });
    setActiveFilter(activeFilter === field ? null : field);
  }, [activeFilter]);

  const handleSelectFilter = useCallback((field: string, value: string | null) => {
    if (field === '') {
      setActiveFilter(null);
    } else {
      setFilters(prev => ({ ...prev, [field]: value }));
      setActiveFilter(null);
    }
  }, []);

  return (
    <div className="flex flex-col">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="overflow-auto custom-scrollbar max-h-[500px]"
      >
        {sorted.length === 0 ? (
          <EmptyState
            icon={<Clock className="w-full h-full" />}
            title={t('order.noHistoryPositions')}
            minHeight="lg"
          />
        ) : (
        <table className="w-full text-left text-xs whitespace-nowrap [&_thead>tr]:!h-9 [&_tbody>tr]:!h-9 [&_tbody>tr>td]:!py-[5px] [&_th]:!py-1.5 [&_td]:leading-[17px] [&_th]:leading-[17px]">
          <thead className="bg-surface-2 text-text-tertiary sticky top-0 z-[var(--z-dropdown)]">
            <tr>
              <th className="px-3 py-2.5 font-medium">
                <FilterDropdown
                  label={t('order.account')}
                  field="account"
                  options={uniqueValues.account}
                  filters={filters}
                  activeFilter={activeFilter}
                  dropdownPos={dropdownPos}
                  onFilterClick={handleFilterClick}
                  onSelectFilter={handleSelectFilter}
                />
              </th>
              <th className="px-3 py-2.5 font-medium">
                <FilterDropdown
                  label={t('order.tradingPair')}
                  field="instId"
                  options={uniqueValues.instId}
                  filters={filters}
                  activeFilter={activeFilter}
                  dropdownPos={dropdownPos}
                  onFilterClick={handleFilterClick}
                  onSelectFilter={handleSelectFilter}
                />
              </th>
              <th className="px-3 py-2.5 font-medium text-text-tertiary text-left">{t('order.leverage')}</th>
              <th className="px-3 py-2.5 font-medium">
                <FilterDropdown
                  label={t('position.direction')}
                  field="direction"
                  options={uniqueValues.direction}
                  filters={filters}
                  activeFilter={activeFilter}
                  dropdownPos={dropdownPos}
                  onFilterClick={handleFilterClick}
                  onSelectFilter={handleSelectFilter}
                />
              </th>
              <th className="px-3 py-2.5 font-medium text-text-tertiary text-left">{t('position.openMaxPos')}</th>
              <th className="px-3 py-2.5 font-medium text-text-tertiary text-left">{t('position.closeTotalPos')}</th>
              <th className="px-3 py-2.5 font-medium text-text-tertiary text-left">{t('position.openAvgPx')}</th>
              <th className="px-3 py-2.5 font-medium text-text-tertiary text-left">{t('position.closeAvgPx')}</th>
              <th className="px-3 py-2.5 font-medium text-text-tertiary text-left">{t('position.realizedPnl')}</th>
              <th className="px-3 py-2.5 font-medium text-text-tertiary text-left">{t('position.pnlRatio')}</th>
              <th className="px-3 py-2.5 font-medium text-text-tertiary text-left">{t('position.mode')}</th>
              <th className="px-3 py-2.5 font-medium text-text-tertiary text-left">{t('position.openTime')}</th>
              <th className="px-3 py-2.5 font-medium text-text-tertiary text-left">{t('position.closeTime')}</th>
              <th className="px-3 py-2.5 font-medium">
                <FilterDropdown
                  label={t('position.closeType')}
                  field="type"
                  options={uniqueValues.type}
                  filters={filters}
                  activeFilter={activeFilter}
                  dropdownPos={dropdownPos}
                  onFilterClick={handleFilterClick}
                  onSelectFilter={handleSelectFilter}
                />
              </th>
            </tr>
          </thead>
          <tbody key={`filter-${filters.account || 'a'}-${filters.instId || 'i'}-${filters.direction || 'd'}-${filters.type || 't'}`} className="divide-y divide-subtle" data-filter-dir={filters.direction || 'all'} data-visible-count={visiblePositions.length}>
            {visiblePositions.map((p, idx) => {
              const color = (p._accountId && accountIdColors?.[p._accountId]) || accountColors[p._account] || DEFAULT_ACCOUNT_COLORS[p._account % DEFAULT_ACCOUNT_COLORS.length];
              const accLabel = (p._accountId && accountIdNames?.[p._accountId]) || accountNames[p._account] || `#${p._account}`;
              return (
                <HistoryPositionRow
                  key={`${p._accountId}-${p.posId || 'nopos'}-${p.uTime || p.cTime || idx}`}
                  p={p}
                  accLabel={accLabel}
                  color={color}
                  onAccountFilter={onAccountFilter}
                  onInstIdFilter={onInstIdFilter}
                  onDirectionFilter={onDirectionFilter}
                  onTypeFilter={onTypeFilter}
                  data-idx={idx}
                />
              );
            })}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
});

HistoryPositionTable.displayName = 'HistoryPositionTable';
