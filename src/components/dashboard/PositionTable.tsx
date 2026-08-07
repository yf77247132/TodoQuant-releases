import DashedHint from '../../ui/DashedHint'
import { DividedRows } from '../../ui/Divider'
import React, { useState, useMemo, memo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Position } from '../../types/trading.ts';
import { SymbolUtils } from '../../lib/symbolUtils.ts';
import { Spinner } from '../../ui/Spinner.tsx';
import { BarChart3 } from 'lucide-react';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { Tooltip } from '../../ui/Tooltip.tsx';
import { POS_SIDE_LABELS, type PositionSide } from '../../constants/positionFields.ts';
import { calculateLiquidationDistance } from '../../lib/positionUtils.ts';
import { jumpToTvChart } from '../../lib/tvSymbolRequest.ts';
import { getTickSzSync, ensureLoaded } from '../../lib/clientTickSz.ts';
import { FilterDropdown, fmt, fmtTickSz, fmtPct } from './sharedUtils.tsx';
import { DEFAULT_ACCOUNT_COLORS } from '../../constants/colors.ts';
import { useToast } from '../../hooks/useToast.ts';
import ConfigToast from '../../ui/ConfigToast.tsx';
import Button from '../../ui/Button.tsx';
import CompactButton from '../../ui/CompactButton.tsx';
import CoinIcon from '../../ui/CoinIcon.tsx';

interface PositionTradeModalProps {
  position: Position;
  onClose: () => void;
  onConfirm: (params: {
    action: 'close' | 'open';
    priceType: 'market' | 'limit';
    px?: string;
    sz: string;
  }) => Promise<void>;
}

function PositionTradeModal({ position: p, onClose, onConfirm }: PositionTradeModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'close' | 'open'>('close');
  const [priceType, setPriceType] = useState<'market' | 'limit'>('market');
  const [px, setPx] = useState(() => p.markPx || '');
  const [sz, setSz] = useState('100%');
  const [loading, setLoading] = useState(false);

  const isLong = p.posSide === 'long' || (p.posSide === 'net' && parseFloat(p.pos || '0') > 0);
  const posQty = Math.abs(parseFloat(p.pos || '0'));
  const isCloseTab = activeTab === 'close';

  const handleConfirm = async () => {
    if (priceType === 'limit' && (!px || parseFloat(px) <= 0)) return;
    setLoading(true);
    try {
      await onConfirm({ action: activeTab, priceType, px: priceType === 'limit' ? px : undefined, sz });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-confirm)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-surface-2 border border-border-default rounded-2xl p-6 w-[400px] space-y-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-1 bg-surface-1 border border-border-subtle rounded-xl p-1">
          <button
            onClick={() => { setActiveTab('close'); setPriceType('market'); setPx(p.markPx || ''); setSz('100%'); }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
              isCloseTab ? 'bg-trade-red/80 text-white shadow-sm' : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {t('position.closeTitle')}
          </button>
          <button
            onClick={() => { setActiveTab('open'); setPriceType('market'); setPx(p.markPx || ''); setSz('100%'); }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
              !isCloseTab ? 'bg-trade-green/80 text-black shadow-sm' : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {t('position.openTitle')}
          </button>
        </div>

        <div className="flex items-center gap-3 bg-surface-1 border border-border-subtle rounded-xl px-4 py-3">
          <CoinIcon symbol={p.instId.split("-")[0]} size={18} />
          <span className="text-sm text-text-secondary">{p.instId}</span>
          <span className={`text-sm font-bold ${isLong ? 'text-trade-green' : 'text-trade-red'}`}>
            {isLong ? t('position.long') : t('position.short')}
          </span>
          <span className="text-sm text-text-primary font-mono">{fmt(posQty, p.instId)}</span>
          <span className="text-2xs text-text-muted ml-auto">
            {isCloseTab ? (isLong ? '→ sell' : '→ buy') : (isLong ? '→ buy' : '→ sell')}
          </span>
        </div>

        <div className="space-y-2">
          <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider">{t('position.priceType')}</label>
          <div className="flex gap-2">
            <button
              onClick={() => setPriceType('market')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${
                priceType === 'market' ? 'bg-brand-yellow text-black' : 'bg-surface-4 text-text-secondary hover:bg-surface-5'
              }`}
            >
              {t('position.marketPrice')}
            </button>
            <button
              onClick={() => setPriceType('limit')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${
                priceType === 'limit' ? 'bg-brand-blue text-text-primary' : 'bg-surface-4 text-text-secondary hover:bg-surface-5'
              }`}
            >
              {t('position.limitPrice')}
            </button>
          </div>
        </div>

        {priceType === 'limit' && (
          <div className="space-y-2">
            <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider">{t('position.limitPriceLabel')}</label>
            <input
              type="text"
              inputMode="decimal"
              value={px}
              onChange={(e) => setPx(e.target.value)}
              placeholder={p.markPx || '0'}
              className="w-full bg-surface-1 border border-border-default hover:border-border-strong focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/20 rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none font-mono transition-all"
            />
            {p.markPx && (
              <p className="text-2xs text-text-muted">
                {t('position.markPriceHint')}
                <DashedHint
                  onClick={() => setPx(p.markPx!)}
                  className="text-text-tertiary border-white/20 hover:text-text-secondary hover:border-white cursor-pointer font-mono ml-1"
                >
                  {p.markPx}
                </DashedHint>
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider">{t(isCloseTab ? 'position.closeQty' : 'position.openQty')}</label>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="text"
              value={sz}
              onChange={(e) => setSz(e.target.value)}
              placeholder="100%"
              className="flex-1 bg-surface-1 border border-border-default hover:border-border-strong focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/20 rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none font-mono transition-all"
            />
            {['10%', '30%', '50%', '100%'].map(pct => (
              <button
                key={pct}
                onClick={() => setSz(pct)}
                className={`px-2.5 py-2 rounded-lg text-xs font-bold transition-colors ${
                  sz === pct ? 'bg-brand-yellow text-black' : 'bg-surface-4 text-text-secondary hover:bg-surface-5'
                }`}
              >
                {pct}
              </button>
            ))}
          </div>
          <p className="text-2xs text-text-muted">{t(isCloseTab ? 'position.qtyTip' : 'position.qtyTipOpen')}</p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="md" className="rounded-xl" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="outline"
            size="md"
            className={`rounded-xl !border-transparent ${
              isCloseTab
                ? '!bg-trade-red/10 text-trade-red hover:!bg-trade-red/20'
                : '!bg-trade-green/10 text-trade-green hover:!bg-trade-green/20'
            }`}
            onClick={handleConfirm}
            disabled={loading || (priceType === 'limit' && (!px || parseFloat(px) <= 0))}
          >
            {loading && <Spinner size="xs" />}
            {isCloseTab ? t('position.confirmClose') : t('position.confirmOpen')}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface PositionTableProps {
  positions: Position[];
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  accountIdNames?: Record<string, string>;
  accountIdColors?: Record<string, string>;
  liqRules?: Record<number, { val: number, op: string }[]>;
  guardedAccounts?: Set<number>;
  onJumpToMargin: (accountId: string, instId: string) => void;
  onJumpToDIY?: (tab: 'strategies' | 'conditions') => void;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>, selectedPositions: Position[]) => void;
  privacyMode?: boolean;
  fundingRates?: Record<string, { rate: string; displayText: string }>;
  changeTodayMap?: Record<string, string>;
  emptyIcon?: React.ReactNode;
}

const evaluateRisk = (val: number, op: string, threshold: number) => {
  switch(op) {
    case '=': return val === threshold;
    case '<': return val < threshold;
    case '>': return val > threshold;
    case '<=': return val <= threshold;
    case '>=': return val >= threshold;
    default: return val <= threshold;
  }
};

const isPositionSide = (value: string): value is PositionSide =>
  value === 'long' || value === 'short' || value === 'net';

export const getPositionRowKey = (p: Position, i: number) =>
  `${p._accountId || p._account}-${p.instId}-${p.posSide}-${p.posId || i}`;

const PositionRow = memo(({ p, accountNames, accountColors, accountIdNames, accountIdColors, liqRules, guardedAccounts, onJumpToMargin: _onJumpToMargin, onJumpToDIY, onConfirmClose, onOpenCloseModal, onReverse, privacyMode, isSelected, onToggleSelect, rowKey, fundingRate, changeToday, isClosing }: {
  p: Position;
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  accountIdNames?: Record<string, string>;
  accountIdColors?: Record<string, string>;
  liqRules?: Record<number, { val: number, op: string }[]>;
  guardedAccounts?: Set<number>;
  onJumpToMargin: (accountId: string, instId: string) => void;
  onJumpToDIY?: (tab: 'strategies' | 'conditions') => void;
  onConfirmClose: (p: Position, setClosing: (v: boolean) => void) => void;
  onOpenCloseModal: (rowKey: string) => void;
  onReverse: (p: Position) => void;
  privacyMode?: boolean;
  isSelected: boolean;
  onToggleSelect: (key: string) => void;
  rowKey: string;
  fundingRate?: string;
  changeToday?: string;
  isClosing?: boolean;
}) => {
  const { t } = useTranslation();
  const [closing, setClosing] = useState(false);
  const mask = (v: string) => privacyMode ? '****' : v;

  const handleCloseClick = () => {
    onConfirmClose(p, setClosing);
  };

  const isLong = p.posSide === 'long' || (p.posSide === 'net' && parseFloat(p.pos || '0') > 0);
  const isShort = p.posSide === 'short' || (p.posSide === 'net' && parseFloat(p.pos || '0') < 0);
  const isNet = p.posSide === 'net';
  
  const posSideText = isNet 
    ? (parseFloat(p.pos || '0') > 0 ? t('position.long') : parseFloat(p.pos || '0') < 0 ? t('position.short') : t('position.net'))
    : ((isPositionSide(p.posSide) ? t(POS_SIDE_LABELS[p.posSide]) : undefined) || (isLong ? t('position.long') : t('position.short')));
  
  const posSideColor = isLong ? 'text-trade-green' : (isShort ? 'text-trade-red' : 'text-text-secondary');
  
  let distLiq = '-';
  let distLiqNum = 0;
  
  const upl = parseFloat(p.upl) || 0;
  const color = (p._accountId && accountIdColors?.[p._accountId]) || accountColors[p._account] || DEFAULT_ACCOUNT_COLORS[p._account % DEFAULT_ACCOUNT_COLORS.length];
  
  const diff = calculateLiquidationDistance(p);
  if (diff !== null) {
    distLiq = fmt(diff, p.instId);
    distLiqNum = diff;
  }
  
  const isGuarded = !guardedAccounts || guardedAccounts.has(p._account);
  const rules = liqRules?.[p._account] || [];
  
  const isRisky = isGuarded && distLiq !== '-' && rules.some(r => evaluateRisk(distLiqNum, r.op, r.val));

  return (
    <tr
      className={`hover:bg-surface-3/50 transition-colors group ${isSelected ? 'bg-brand-yellow/5' : ''} ${isClosing ? 'opacity-40 pointer-events-none' : ''}`}
      onClick={() => onToggleSelect(rowKey)}
    >
      <td className="px-3 py-2 w-[40px]" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(rowKey)}
          className="rounded border-border-default bg-surface-1 text-brand-yellow focus:ring-focus-ring focus:ring-offset-0 cursor-pointer"
        />
      </td>
      <td className="px-3 py-2">
        <span className="font-bold" style={{ color }}>
          {(p._accountId && accountIdNames?.[p._accountId]) || accountNames[p._account] || `#${p._account}`}
        </span>
      </td>
      <td className="px-3 py-2 font-mono text-text-primary">
        <Tooltip content={t('position.clickToChart')}>
          <DashedHint
            as="button"
            type="button"
            className="cursor-pointer flex items-center gap-1.5"
            onClick={(e) => { e.stopPropagation(); jumpToTvChart(p.instId); }}
          >
            <CoinIcon symbol={p.instId.split("-")[0]} size={16} />
            {p.instId}
          </DashedHint>
        </Tooltip>
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {mask(p.lever ? `${p.lever}x` : '--')}
      </td>
      <td className="px-3 py-2 text-left">
        <Tooltip content={t('position.clickToReverse')}>
          <DashedHint as="button" type="button"
            onClick={(e) => { e.stopPropagation(); onReverse(p); }}
            className={`cursor-pointer font-bold hover:border-current ${posSideColor}`}
          >
            {posSideText}
          </DashedHint>
        </Tooltip>
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        <Tooltip content={t('position.clickToTrade')}>
          <DashedHint
            as="button"
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenCloseModal(rowKey); }}
            className="cursor-pointer"
          >
            {mask(fmt(Math.abs(parseFloat(p.pos || '0')), p.instId))}
          </DashedHint>
        </Tooltip>
      </td>
      <td className="px-3 py-2 text-left font-mono">
        <span className={fundingRate && fundingRate !== '--' ? 'text-text-primary' : 'text-text-muted'}>
          {mask(fundingRate || '--')}
        </span>
      </td>
      <td className="px-3 py-2 text-left font-mono">
        <span className={(() => {
          if (!changeToday || changeToday === '--') return 'text-text-muted';
          const v = parseFloat(String(changeToday));
          return isNaN(v) ? 'text-text-muted' : v > 0 ? 'text-trade-green' : v < 0 ? 'text-trade-red' : 'text-text-muted';
        })()}>{mask(changeToday && changeToday !== '--' ? parseFloat(String(changeToday)).toFixed(2) + '%' : '--')}
        </span>
      </td>
      <td className="px-3 py-2 text-left font-mono text-brand-yellow">
        {fmt(p.markPx || 0, p.instId)}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {mask(fmtTickSz(p.avgPx || 0, getTickSzSync(p.instId)))}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {mask(fmt(p.liqPx || 0, p.instId, 10, p.markPx))}
      </td>
      <td className="px-3 py-2 text-left font-mono">
        <Tooltip content={t('position.clickToConditions')}>
          <DashedHint as="button" type="button"
            onClick={(e) => { e.stopPropagation(); onJumpToDIY?.('conditions'); }}
            className={`cursor-pointer font-bold hover:border-current ${isRisky ? 'text-trade-red animate-pulse' : 'text-trade-green'}`}
          >
            {mask(distLiq === '-' ? '-' : '+' + fmt(diff, p.instId, 10, p.markPx))}
          </DashedHint>
        </Tooltip>
      </td>
      <td className="px-3 py-2 text-left font-mono">
        <span className={`font-bold ${upl >= 0 ? 'text-trade-green' : 'text-trade-red'}`}>
          {mask(`${upl >= 0 ? '+' : ''}${parseFloat(String(upl)).toFixed(2)}`)}
        </span>
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-secondary">
        {mask(fmtPct(p.uplRatio))}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {mask(parseFloat(String(p.mgnMode === 'cross' ? p.imr : p.margin || 0)).toFixed(2))}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-secondary">
        {mask(fmtPct(p.mgnRatio || 0))}
      </td>
      <td className="px-3 py-2 text-left text-text-secondary">
        {p.mgnMode === 'cross' ? t('position.cross') : p.mgnMode === 'isolated' ? t('position.isolated') : p.mgnMode || '--'}
      </td>
      <td className={`pr-1.5 pl-1.5 py-1.5 text-right w-0 sticky right-0 z-10 transition-colors ${
        isSelected 
          ? 'bg-surface-2 group-hover:bg-surface-3 after:absolute after:inset-0 after:bg-brand-yellow/5' 
          : 'bg-surface-0 group-hover:bg-surface-3'
      }`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1.5">
          <CompactButton
            onClick={() => onOpenCloseModal(rowKey)}
          >
            {t('position.positionBtn')}
          </CompactButton>
          <CompactButton
            onClick={() => onReverse(p)}
          >
            {t('position.reverseBtn')}
          </CompactButton>
          <CompactButton
            variant="danger"
            className={closing ? 'opacity-50 cursor-not-allowed' : ''}
            onClick={handleCloseClick}
            disabled={closing}
          >
            {closing ? <Spinner size="xs" /> : t('position.closeAll')}
          </CompactButton>
        </div>
      </td>
    </tr>
  );
});

PositionRow.displayName = 'PositionRow';

export const PositionTable: React.FC<PositionTableProps> = memo(({ positions, accountNames, accountColors, accountIdNames, accountIdColors, liqRules, guardedAccounts, onJumpToMargin, onJumpToDIY, selectedIds: controlledSelectedIds, onSelectionChange, privacyMode, fundingRates, changeTodayMap, emptyIcon }) => {
  const { t } = useTranslation();
  const { toast, showToast } = useToast();
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    message: string;
    accountName: string;
    accountColor: string;
    instId: string;
    posSide: string;
    pos: string;
    onConfirm: () => void;
  } | null>(null);

  const [reverseModal, setReverseModal] = useState<{
    position: Position;
  } | null>(null);

  const [closeModalRowKey, setCloseModalRowKey] = useState<string | null>(null);

  const [closingPositionKeys, setClosingPositionKeys] = useState<Set<string>>(new Set());
  const closingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const positionsRef = useRef(positions);
  useEffect(() => { positionsRef.current = positions; }, [positions]);

  useEffect(() => {
    if (closingPositionKeys.size === 0) return;
    const staleKeys: string[] = [];
    closingPositionKeys.forEach(key => {
      const livePos = positions.find((p, i) => getPositionRowKey(p, i) === key);
      if (!livePos || parseFloat(livePos.pos || '0') === 0) {
        staleKeys.push(key);
      }
    });
    if (staleKeys.length > 0) {
      setClosingPositionKeys(prev => {
        const next = new Set(prev);
        staleKeys.forEach(k => {
          next.delete(k);
          const timer = closingTimersRef.current[k];
          if (timer) {
            clearTimeout(timer);
            delete closingTimersRef.current[k];
          }
        });
        return next;
      });
    }
  }, [positions, closingPositionKeys]);

  useEffect(() => {
    return () => {
      Object.values(closingTimersRef.current).forEach(timer => clearTimeout(timer));
      closingTimersRef.current = {};
    };
  }, []);

  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(new Set());
  const selectedIds = controlledSelectedIds ?? internalSelectedIds;

  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  useEffect(() => { ensureLoaded(); }, []);

  const handleTradeModalConfirm = useCallback(async (params: {
    action: 'close' | 'open';
    priceType: 'market' | 'limit';
    px?: string;
    sz: string;
  }) => {
    const p = closeModalRowKey
      ? positions.find((pos, i) => getPositionRowKey(pos, i) === closeModalRowKey)
      : null;
    if (!p) return;

    const isClose = params.action === 'close';
    const endpoint = isClose ? '/api/position/close-advanced' : '/api/position/open-advanced';
    const successMsg = isClose ? t('position.closeSuccess') : t('position.openSuccess');
    const failedMsg = isClose ? t('position.closeFailed') : t('position.openFailed');

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: p._accountId || '',
          instId: p.instId,
          mgnMode: p.mgnMode,
          posSide: p.posSide === 'net' ? undefined : p.posSide,
          ccy: p.ccy,
          priceType: params.priceType,
          px: params.px,
          sz: params.sz,
          posQty: String(Math.abs(parseFloat(p.pos || '0'))),
        })
      });
      const data = await res.json();
      if (data.ok) {
        showToast(successMsg, 'success');
        if (isClose && closeModalRowKey) {
          setClosingPositionKeys(prev => new Set(prev).add(closeModalRowKey));
          closingTimersRef.current[closeModalRowKey] = setTimeout(() => {
            setClosingPositionKeys(prev => {
              const next = new Set(prev);
              next.delete(closeModalRowKey);
              return next;
            });
            delete closingTimersRef.current[closeModalRowKey];
          }, 10000);
        }
      } else {
        const apiData = data.data;
        let errMsg = data.error || t('position.unknownError');
        if (apiData?.data?.[0]?.sMsg) errMsg = apiData.data[0].sMsg;
        else if (apiData?.msg) errMsg = apiData.msg;
        showToast(`${failedMsg}：${errMsg}`, 'error');
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      showToast(`${failedMsg}：${t('position.networkError')}`, 'error');
    } finally {
      setCloseModalRowKey(null);
    }
  }, [closeModalRowKey, positions, showToast, t]);

  const handleClosePosition = useCallback(async (p: Position, setClosing: (v: boolean) => void) => {
    setClosing(true);
    try {
      const res = await fetch('/api/position/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: p._accountId || '',
          instId: p.instId,
          mgnMode: p.mgnMode,
          posSide: p.posSide === 'net' ? undefined : p.posSide,
          ccy: p.ccy
        })
      });
      const data = await res.json();
      if (data.ok) {
        showToast(t('position.closeSuccess'), 'success');
        const idx = positionsRef.current.findIndex(pos =>
          pos.instId === p.instId && pos.posSide === p.posSide
          && pos._account === p._account && pos._accountId === p._accountId
        );
        const rowKey = getPositionRowKey(p, idx >= 0 ? idx : 0);
        setClosingPositionKeys(prev => new Set(prev).add(rowKey));
        closingTimersRef.current[rowKey] = setTimeout(() => {
          setClosingPositionKeys(prev => {
            const next = new Set(prev);
            next.delete(rowKey);
            return next;
          });
          delete closingTimersRef.current[rowKey];
        }, 10000);
      } else {
        showToast(`${t('position.closeFailed')}：${data.data?.msg || data.error || t('position.unknownError')}`, 'error');
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error('[PositionTable] 平仓失败:', err.message);
      showToast(`${t('position.closeFailed')}：${t('position.networkError')}`, 'error');
    } finally {
      setClosing(false);
    }
  }, [showToast, t]);

  const handleConfirmClose = useCallback((p: Position, setClosing: (v: boolean) => void) => {
    const accountName = accountNames[p._account] || String(p._account);
    const accountColor = accountColors[p._account] || DEFAULT_ACCOUNT_COLORS[p._account % DEFAULT_ACCOUNT_COLORS.length];

    setConfirmModal({
      isOpen: true,
      accountName,
      accountColor,
      instId: p.instId,
      posSide: p.posSide,
      pos: p.pos || '0',
      message: '',
      onConfirm: () => {
        setConfirmModal(null);
        handleClosePosition(p, setClosing);
      }
    });
  }, [accountNames, accountColors, handleClosePosition, t]);

  const handleReverse = useCallback(async (p: Position) => {
    try {
      const res = await fetch('/api/position/reverse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: p._accountId || '',
          instId: p.instId,
          mgnMode: p.mgnMode,
          posSide: p.posSide === 'net' ? undefined : p.posSide,
          ccy: p.ccy,
          posQty: String(Math.abs(parseFloat(p.pos || '0'))),
        })
      });
      const data = await res.json();
      if (data.ok) {
        showToast(t('position.reverseSuccess'), 'success');
      } else {
        showToast(`${t('position.reverseFailed')}：${data.error || t('position.unknownError')}`, 'error');
      }
    } catch (e: unknown) {
      showToast(`${t('position.reverseFailed')}：${t('position.networkError')}`, 'error');
    }
  }, [showToast, t]);

  const handleConfirmReverse = useCallback((p: Position) => {
    setReverseModal({ position: p });
  }, []);

  const [filters, setFilters] = useState<{
    account: string | null;
    instId: string | null;
    side: string | null;
  }>({
    account: null,
    instId: null,
    side: null,
  });

  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  const filteredPositions = useMemo(() => {
    return positions.filter(p => {
      if (!p) return false;
      const accountName = (p._accountId && accountIdNames?.[p._accountId]) || accountNames[p._account] || `#${p._account}`;
      
      if (filters.account && accountName !== filters.account) return false;
      if (filters.instId && !SymbolUtils.isSameSymbol(p.instId, filters.instId)) return false;
      if (filters.side && (t(POS_SIDE_LABELS[p.posSide as PositionSide] || ('position.' + p.posSide)) !== filters.side)) return false;
      return true;
    });
  }, [positions, filters, accountNames, accountIdNames, t]);

  const handleToggleSelect = useCallback((key: string) => {
    setInternalSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      onSelectionChange?.(next, filteredPositions.filter((p, i) => next.has(getPositionRowKey(p, i))));
      return next;
    });
  }, [filteredPositions, onSelectionChange]);

  const handleSelectAll = useCallback(() => {
    const allKeys = new Set(filteredPositions.map((p, i) => getPositionRowKey(p, i)));
    setInternalSelectedIds(allKeys);
    onSelectionChange?.(allKeys, [...filteredPositions]);
  }, [filteredPositions, onSelectionChange]);

  const handleDeselectAll = useCallback(() => {
    setInternalSelectedIds(new Set());
    onSelectionChange?.(new Set(), []);
  }, [onSelectionChange]);

  useEffect(() => {
    setInternalSelectedIds(prev => {
      const validKeys = new Set(filteredPositions.map((p, i) => getPositionRowKey(p, i)));
      const cleaned = new Set([...prev].filter(k => validKeys.has(k)));
      if (cleaned.size !== prev.size) {
        onSelectionChange?.(cleaned, filteredPositions.filter((p, i) => cleaned.has(getPositionRowKey(p, i))));
        return cleaned;
      }
      return prev;
    });
  }, [filteredPositions, onSelectionChange]);

  useEffect(() => {
    onSelectionChangeRef.current?.(new Set(), []);
  }, []);

  const isAllSelected = filteredPositions.length > 0 && filteredPositions.every((p, i) => selectedIds.has(getPositionRowKey(p, i)));
  const isPartialSelected = !isAllSelected && filteredPositions.some((p, i) => selectedIds.has(getPositionRowKey(p, i)));

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isPartialSelected;
    }
  }, [isPartialSelected]);

  const uniqueValues = useMemo(() => {
    const accs = new Set<string>();
    const insts = new Set<string>();
    const sides = new Set<string>();

    positions.forEach(p => {
      if (!p) return;
      accs.add((p._accountId && accountIdNames?.[p._accountId]) || accountNames[p._account] || `#${p._account}`);
      insts.add(p.instId);
      sides.add(t(POS_SIDE_LABELS[p.posSide as PositionSide] || ('position.' + p.posSide)));
    });

    return {
      account: Array.from(accs),
      instId: Array.from(insts),
      side: Array.from(sides),
    };
  }, [positions, accountNames, accountIdNames, t]);

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

  if (positions.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon ?? <BarChart3 className="w-full h-full" />}
        title={t('position.noPositions')}
        minHeight="md"
      />
    );
  }

  return (
    <div className="relative">
      {toast && <ConfigToast message={toast.message} type={toast.type} />}
      {confirmModal?.isOpen && createPortal(
        <div 
          className="fixed inset-0 z-[var(--z-confirm)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmModal(null); }}
        >
          <div 
            className="bg-surface-2 border border-border-default rounded-2xl p-6 w-96 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-text-secondary">{t('position.confirmTitle')}</h3>
            <p className="text-sm text-text-secondary">
              {t('position.confirmMsg')} &quot;
              <span className="font-semibold" style={{ color: confirmModal.accountColor }}>
                {confirmModal.accountName}
              </span>
              &quot;{' '}
              <span className="text-brand-blue font-semibold">
                <CoinIcon symbol={confirmModal.instId?.split("-")[0]} size={14} className="inline align-middle mr-0.5" />
                {confirmModal.instId}
              </span>
              {(() => {
                const isLong = confirmModal.posSide === 'long' || (confirmModal.posSide === 'net' && parseFloat(confirmModal.pos || '0') > 0);
                return (
                  <span className={isLong ? 'text-trade-green' : 'text-trade-red'}>
                    （{isLong ? t('position.long') : t('position.short')}）
                  </span>
                );
              })()}
              {t('position.confirmMsgEnd')}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="md" className="rounded-xl" onClick={() => setConfirmModal(null)}>{t('common.cancel')}</Button>
              <Button variant="primary" size="md" className="rounded-xl" onClick={confirmModal.onConfirm}>{t('common.confirm')}</Button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {reverseModal && (() => {
        const p = reverseModal.position;
        const accountName = (p._accountId && accountIdNames?.[p._accountId]) || accountNames[p._account] || String(p._account);
        const accountColor = accountColors[p._account] || DEFAULT_ACCOUNT_COLORS[p._account % DEFAULT_ACCOUNT_COLORS.length];
        const isLong = p.posSide === 'long' || (p.posSide === 'net' && parseFloat(p.pos || '0') > 0);
        return createPortal(
          <div
            className="fixed inset-0 z-[var(--z-confirm)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setReverseModal(null); }}
          >
            <div
              className="bg-surface-2 border border-border-default rounded-2xl p-6 w-96 space-y-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-text-secondary">{t('position.reverseConfirmTitle')}</h3>
              <p className="text-sm text-text-secondary">
                {t('position.reverseConfirmMsg')} &quot;
                <span className="font-semibold" style={{ color: accountColor }}>
                  {accountName}
                </span>
                &quot;{' '}
                <span className="text-brand-blue font-semibold">
                  <CoinIcon symbol={p.instId.split("-")[0]} size={14} className="inline align-middle mr-0.5" />
                  {p.instId}
                </span>
                <span className={isLong ? 'text-trade-green' : 'text-trade-red'}>
                  （{isLong ? t('position.long') : t('position.short')}）
                </span>
                {t('position.reverseConfirmMsgMid')}
              </p>
              <p className="text-xs text-text-muted leading-relaxed">{t('position.reverseConfirmNote')}</p>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" size="md" className="rounded-xl" onClick={() => setReverseModal(null)}>{t('common.cancel')}</Button>
                <Button
                  variant="outline"
                  size="md"
                  className={`rounded-xl !border-transparent ${
                    isLong
                      ? '!bg-trade-red/10 text-trade-red hover:!bg-trade-red/20'
                      : '!bg-trade-green/10 text-trade-green hover:!bg-trade-green/20'
                  }`}
                  onClick={() => { setReverseModal(null); handleReverse(p); }}
                >
                  {isLong ? t('position.reverseToShort') : t('position.reverseToLong')}
                </Button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}
      <div className="overflow-auto custom-scrollbar max-h-[500px]">
        <table className="w-full text-left text-xs whitespace-nowrap">
          <thead className="bg-surface-2 text-text-tertiary sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 font-medium w-[40px]">
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={() => isAllSelected ? handleDeselectAll() : handleSelectAll()}
                  className="rounded border-border-default bg-surface-1 text-brand-yellow focus:ring-focus-ring focus:ring-offset-0 cursor-pointer"
                />
              </th>
              <th className="px-3 py-2 font-medium">
                <FilterDropdown 
                  label={t('position.account')} 
                  field="account" 
                  options={uniqueValues.account}
                  filters={filters}
                  activeFilter={activeFilter}
                  dropdownPos={dropdownPos}
                  onFilterClick={handleFilterClick}
                  onSelectFilter={handleSelectFilter}
                />
              </th>
              <th className="px-3 py-2 font-medium">
                <FilterDropdown 
                  label={t('position.tradingPair')} 
                  field="instId" 
                  options={uniqueValues.instId}
                  filters={filters}
                  activeFilter={activeFilter}
                  dropdownPos={dropdownPos}
                  onFilterClick={handleFilterClick}
                  onSelectFilter={handleSelectFilter}
                />
              </th>
              <th className="px-3 py-2 font-medium text-left">{t('position.leverage')}</th>
              <th className="px-3 py-2 font-medium text-left">{t('position.direction')}</th>
              <th className="px-3 py-2 font-medium text-left">
                <Tooltip content={t('position.quantityTooltip')}>
                  <DashedHint className="cursor-help">{t('position.quantity')}</DashedHint>
                </Tooltip>
              </th>
              <th className="px-3 py-2 font-medium text-left">{t('position.fundingRate')}</th>
              <th className="px-3 py-2 font-medium text-left">{t('monitor.changeToday')}</th>
              <th className="px-3 py-2 font-medium text-left">{t('position.markPrice')}</th>
              <th className="px-3 py-2 font-medium text-left">{t('position.avgPrice')}</th>
              <th className="px-3 py-2 font-medium text-left">{t('position.liqPrice')}</th>
              <th className="px-3 py-2 font-medium text-left">
                <Tooltip content={t('position.distLiqTooltip')}>
                  <DashedHint className="cursor-help">{t('position.distLiq')}</DashedHint>
                </Tooltip>
              </th>
              <th className="px-3 py-2 font-medium text-left">{t('position.upl')}</th>
              <th className="px-3 py-2 font-medium text-left">{t('position.uplRatio')}</th>
              <th className="px-3 py-2 font-medium text-left">{t('position.margin')}</th>
              <th className="px-3 py-2 font-medium text-left">
                <Tooltip content={t('position.mgnRatioTooltip')}>
                  <DashedHint className="cursor-help">{t('position.mgnRatio')}</DashedHint>
                </Tooltip>
              </th>
              <th className="px-3 py-2 font-medium text-left">{t('position.mode')}</th>
              <th className="bg-surface-2 pr-1.5 pl-1.5 py-2 font-medium text-right w-0 sticky right-0 z-20">{t('position.action')}</th>
            </tr>
          </thead>
          <DividedRows>
            {filteredPositions.map((p, i) => {
              const rowKey = getPositionRowKey(p, i);
              return (
                <PositionRow
                  key={rowKey}
                  p={p}
                  accountNames={accountNames}
                  accountColors={accountColors}
                  accountIdNames={accountIdNames}
                  accountIdColors={accountIdColors}
                  liqRules={liqRules}
                  guardedAccounts={guardedAccounts}
                  onJumpToMargin={onJumpToMargin}
                  onJumpToDIY={onJumpToDIY}
                  onConfirmClose={handleConfirmClose}
                  onOpenCloseModal={setCloseModalRowKey}
                  onReverse={handleConfirmReverse}
                  privacyMode={privacyMode}
                  isSelected={selectedIds.has(rowKey)}
                  onToggleSelect={handleToggleSelect}
                  rowKey={rowKey}
                  fundingRate={fundingRates?.[p.instId]?.displayText || '--'}
                  changeToday={changeTodayMap?.[p.instId] || '--'}
                  isClosing={closingPositionKeys.has(rowKey)}
                />
              );
            })}
          </DividedRows>
        </table>
      </div>
      {closeModalRowKey && (() => {
        const livePos = positions.find((pos, i) => getPositionRowKey(pos, i) === closeModalRowKey);
        if (!livePos) return null;
        return createPortal(
          <PositionTradeModal
            position={livePos}
            onClose={() => setCloseModalRowKey(null)}
            onConfirm={handleTradeModalConfirm}
          />,
          document.body
        );
      })()}
    </div>
  );
});
PositionTable.displayName = 'PositionTable';
