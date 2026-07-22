import DashedHint from '../../ui/DashedHint'
import { DividedRows } from '../../ui/Divider'
import React, { useState, useMemo, memo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Order } from '../../types/trading.ts';
import { SymbolUtils } from '../../lib/symbolUtils.ts';
import { Copy, ClipboardList } from 'lucide-react';
import { Spinner } from '../../ui/Spinner.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { Tooltip } from '../../ui/Tooltip.tsx';
import Button from '../../ui/Button.tsx';
import CompactButton from '../../ui/CompactButton.tsx';
import ConvertOrderModal, { type ConvertOrderInfo } from '../../ui/ConvertOrderModal.tsx';
import { FilterDropdown, fmt } from './sharedUtils.tsx';
import { DEFAULT_ACCOUNT_COLORS } from '../../constants/colors.ts';
import CoinIcon from '../../ui/CoinIcon.tsx';

interface OrderTableProps {
  orders: Order[];
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  accountIdNames?: Record<string, string>;
  accountIdColors?: Record<string, string>;
  onJumpToAmend: (accountId: string, _account: number, instId: string, orderType: string) => void;
  onJumpToCancel: (accountId: string, _account: number, instId: string, orderType: string) => void;
  onConvertOrder?: (order: ConvertOrderInfo) => void;
  removeOrder?: (orderId: string) => void;
  showToast: (message: string, type: 'success' | 'error') => void;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>, selectedOrders: Order[]) => void;
  emptyIcon?: React.ReactNode;
}

interface OrderRowProps {
  o: Order;
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  accountIdNames?: Record<string, string>;
  accountIdColors?: Record<string, string>;
  onJumpToAmend: (accountId: string, _account: number, instId: string, orderType: string) => void;
  onJumpToCancel: (accountId: string, _account: number, instId: string, orderType: string) => void;
  onConvertOrder?: (order: ConvertOrderInfo) => void;
  removeOrder?: (orderId: string) => void;
  showToast: (message: string, type: 'success' | 'error') => void;
  onFilterByAccount?: (accountName: string) => void;
  onFilterByInstId?: (instId: string) => void;
  onFilterByType?: (type: string) => void;
  rowKey: string;
  isSelected: boolean;
  onToggleSelect: (key: string) => void;
}

const areOrderRowPropsEqual = (prev: OrderRowProps, next: OrderRowProps) => {
  if (prev.o !== next.o) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.onJumpToAmend !== next.onJumpToAmend) return false;
  if (prev.onJumpToCancel !== next.onJumpToCancel) return false;
  if (prev.onConvertOrder !== next.onConvertOrder) return false;
  if (prev.removeOrder !== next.removeOrder) return false;
  if (prev.showToast !== next.showToast) return false;
  if (prev.onFilterByAccount !== next.onFilterByAccount) return false;
  if (prev.onFilterByInstId !== next.onFilterByInstId) return false;
  if (prev.onFilterByType !== next.onFilterByType) return false;
  if (prev.onToggleSelect !== next.onToggleSelect) return false;

  const accountIdx = prev.o._account;
  const prevAccId = prev.o._accountId;
  const nextAccId = next.o._accountId;
  if (prevAccId !== nextAccId) return false;
  if (prevAccId) {
    if (prev.accountIdNames?.[prevAccId] !== next.accountIdNames?.[nextAccId]) return false;
    if (prev.accountIdColors?.[prevAccId] !== next.accountIdColors?.[nextAccId]) return false;
  }

  return (
    prev.accountNames[accountIdx] === next.accountNames[accountIdx] &&
    prev.accountColors[accountIdx] === next.accountColors[accountIdx]
  );
};

const ORDER_TYPE_DISPLAY_MAP: Record<string, string> = {
  '市价委托': 'order.typeMarket',
  '限价委托': 'order.typeLimit',
  '限价-Post only': 'order.typePostOnly',
  '限价-FOK': 'order.typeFok',
  '限价-IOC': 'order.typeIoc',
  '计划委托': 'order.typeConditional',
  '单向止盈止损': 'order.typeSingleTPSL',
  '双向止盈止损': 'order.typeOco',
  '移动止盈止损': 'order.typeTrailingStop',
  '追逐限价': 'order.typeChase',
  '时间加权委托': 'order.typeTwap',
  '止损限价': 'order.typeStopLimit',
  '止盈限价': 'order.typeTakeProfitLimit',
  '止损市价': 'order.typeStopMarket',
  '止盈市价': 'order.typeTakeProfitMarket',
  '止损委托': 'order.typeStopLoss',
  '止盈委托': 'order.typeTakeProfit',
  '跟踪止损市价': 'order.typeTrailingStopMarket',
  '止损子单 (OTO)': 'order.typeOtoStopLoss',
};

const OrderRow = memo(({ o, accountNames, accountColors, accountIdNames, accountIdColors, onJumpToAmend, onJumpToCancel, onConvertOrder, removeOrder, showToast, onFilterByAccount, onFilterByInstId, onFilterByType, rowKey, isSelected, onToggleSelect }: OrderRowProps) => {
  const { t } = useTranslation();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fmtPrice = (val: string | number | undefined | null, instId: string) => {
    const strVal = String(val ?? '');
    if (strVal === '-1' || val === -1) return t('order.priceMarket');
    return fmt(strVal || '', instId);
  };

  const handleCancelSingle = async () => {
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch('/api/order/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: o._accountId || '',
          _account: o._account,
          instId: o.instId,
          ordId: o.ordId,
          algoId: o.algoId,
          tdMode: o.tdMode,
        })
      });
      const data = await res.json();
      if (!data.ok) {
        const errMsg = data.data?.msg || data.error || t('order.cancelFailed');
        setError(errMsg);
        showToast(errMsg, 'error');
        setTimeout(() => setError(null), 3000);
      } else {
        showToast(t('order.cancelSuccess'), 'success');
        removeOrder?.(o.ordId || o.algoId || `${o._account}-${o.instId}`);
      }
    } catch (e) {
      console.error('撤单异常:', e);
      setError(t('order.networkError'));
      showToast(t('order.networkError'), 'error');
      setTimeout(() => setError(null), 3000);
    } finally {
      setCancelling(false);
    }
  };

  const isBuy = o.side === 'buy';
  let sz = parseFloat(o.sz || '0');
  const isBinance = o.exchange === 'BINANCE';
  if (!isBinance && SymbolUtils.isSameSymbol(o.instId, 'ETH-USDT-SWAP')) sz = sz / 10;
  
  const color = (o._accountId && accountIdColors?.[o._accountId]) || accountColors[o._account] || DEFAULT_ACCOUNT_COLORS[o._account % DEFAULT_ACCOUNT_COLORS.length];
  
  return (
    <>
    <tr
      className={`hover:bg-surface-3/50 transition-colors group ${isSelected ? 'bg-brand-yellow/5' : ''}`}
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
        <Tooltip content={t('order.clickToFilter')}>
          <DashedHint className="font-bold cursor-pointer"
            style={{ color }}
            onClick={(e) => { e.stopPropagation(); onFilterByAccount?.((o._accountId && accountIdNames?.[o._accountId]) || accountNames[o._account] || `#${o._account}`); }}
          >
            {(o._accountId && accountIdNames?.[o._accountId]) || accountNames[o._account] || `#${o._account}`}
          </DashedHint>
        </Tooltip>
      </td>
      <td className="px-3 py-2">
        <Tooltip content={t('order.clickToFilter')}>
          <DashedHint className="font-mono text-text-primary cursor-pointer inline-flex items-center gap-1.5"
            onClick={(e) => { e.stopPropagation(); onFilterByInstId?.(o.instId); }}
          >
            <CoinIcon symbol={o.instId.split("-")[0]} size={16} />
            {o.instId}
          </DashedHint>
        </Tooltip>
      </td>
      <td className="px-3 py-2 text-text-secondary">
        {o.tdMode === 'cross' ? t('order.cross') : o.tdMode === 'isolated' ? t('order.isolated') : o.tdMode === 'cash' ? t('order.cash') : (o.tdMode || '-')}
      </td>
      <td className="px-3 py-2 font-mono text-text-primary">
        {o.lever ? `${o.lever}x` : '-'}
      </td>
      <td className="px-3 py-2">
        <Tooltip content={t('order.clickToFilter')}>
          <DashedHint className="text-text-secondary cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onFilterByType?.(o.orderTypeDisplay || o.ordType); }}
          >
            {t(ORDER_TYPE_DISPLAY_MAP[o.orderTypeDisplay || o.ordType] || ('order.typeRaw.' + (o.orderTypeDisplay || o.ordType)))}
          </DashedHint>
        </Tooltip>
      </td>
      <td className="px-3 py-2">
        <span className={`font-bold ${isBuy ? 'text-trade-green' : 'text-trade-red'}`}>
          {isBuy ? t('order.buy') : t('order.sell')}
        </span>
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {fmt(sz, o.instId)}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {fmt(o.triggerPrice || '', o.instId)}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {o.ordType === 'market' ? t('order.priceMarket') : (o.orderPrice === '-' ? '-' : fmtPrice(o.orderPrice, o.instId))}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {(() => {
          const hasMoveStop = o.callbackRatio || o.callbackSpread || o.activePx;
          if (hasMoveStop) {
            const ap = o.activePx && o.activePx !== '-' ? fmt(o.activePx, o.instId) : null;
            if (o.callbackRatio && o.callbackRatio !== '-') {
              const ratio = parseFloat(String(o.callbackRatio));
              const ratioText = !isNaN(ratio) ? `${ratio * 100}%` : String(o.callbackRatio);
              return ap ? `${ratioText} (${ap})` : ratioText;
            }
            if (o.callbackSpread && o.callbackSpread !== '-') {
              const spread = fmt(o.callbackSpread, o.instId);
              return ap ? `${spread} (${ap})` : spread;
            }
            return ap || '-';
          }
          return fmtPrice(o.otoTpPrice ?? o.tpPrice, o.instId);
        })()}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {fmtPrice(o.otoSlPrice ?? o.slPrice, o.instId)}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-secondary">
        {o.orderTime ? (() => {
          const date = new Date(parseInt(o.orderTime));
          const m = String(date.getMonth() + 1).padStart(2, '0');
          const d = String(date.getDate()).padStart(2, '0');
          const h = String(date.getHours()).padStart(2, '0');
          const min = String(date.getMinutes()).padStart(2, '0');
          const s = String(date.getSeconds()).padStart(2, '0');
          return `${m}/${d} ${h}:${min}:${s}`;
        })() : '-'}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-tertiary">
        {(() => {
          const fullId = o.ordId || o.algoId;
          if (!fullId) return '-';
          const displayId = fullId.length > 10 ? `${fullId.slice(0, 3)}...${fullId.slice(-3)}` : fullId;
          
          return (
            <div className="flex items-center gap-1.5">
              <Tooltip content={fullId}>
                <DashedHint className="cursor-help">
                  {displayId}
                </DashedHint>
              </Tooltip>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(fullId).then(() => {
                    showToast(t('order.copied'), 'success');
                  }).catch(() => {
                  });
                }}
                className="p-1 rounded hover:bg-white/10 text-text-muted hover:text-text-secondary transition-all active:scale-90"
                title={t('order.copyId')}
              >
                <Copy size={12} strokeWidth={2} />
              </button>
            </div>
          );
        })()}
      </td>
      <td className={`pr-1.5 pl-1.5 py-1.5 text-right w-0 sticky right-0 z-10 transition-colors ${
        isSelected 
          ? 'bg-surface-2 group-hover:bg-surface-3 after:absolute after:inset-0 after:bg-brand-yellow/5' 
          : 'bg-surface-0 group-hover:bg-surface-3'
      }`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-2">
          {onConvertOrder && (
            <CompactButton
              onClick={() => {
                if (o.exchange?.toLowerCase() === 'binance') {
                  showToast(t('convert.binanceNotSupported'), 'error');
                  return;
                }
                onConvertOrder({
                  ordId: o.ordId,
                  algoId: o.algoId,
                  instId: o.instId,
                  side: o.side,
                  sz: o.sz,
                  ordType: o.ordType,
                  tdMode: o.tdMode,
                  posSide: o.posSide,
                  _accountId: o._accountId,
                  _account: o._account,
                  exchange: o.exchange,
                });
              }}
            >
              {t('convert.button')}
            </CompactButton>
          )}
          <CompactButton
            onClick={() => onJumpToAmend(o._accountId || '', o._account, o.instId, o.orderTypeDisplay || o.ordType)}
          >
            {t('order.batchAmend')}
          </CompactButton>
          <CompactButton
            onClick={() => onJumpToCancel(o._accountId || '', o._account, o.instId, o.orderTypeDisplay || o.ordType)}
          >
            {t('order.batchCancel')}
          </CompactButton>
          <CompactButton
            variant="danger"
            className={`${error ? 'bg-trade-red/20 border border-trade-red' : ''} ${cancelling ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={handleCancelSingle}
            disabled={cancelling}
          >
            {cancelling ? <Spinner size="xs" /> : (error ? error : t('order.cancel'))}
          </CompactButton>
        </div>
      </td>
    </tr>
  </>
  );
}, areOrderRowPropsEqual);

OrderRow.displayName = 'OrderRow';

export const getOrderRowKey = (o: Order, i: number) =>
  `${o._accountId || o._account}-${o.ordId || o.algoId || `${o.instId}-${o.orderTime || i}`}`;

const ROW_HEIGHT = 40;
const OVERSCAN = 5;
const SCROLL_CONTAINER_MAX_H = 500;

export const OrderTable: React.FC<OrderTableProps> = memo(({ orders, accountNames, accountColors, accountIdNames, accountIdColors, onJumpToAmend, onJumpToCancel, onConvertOrder, removeOrder, showToast, selectedIds: controlledSelectedIds, onSelectionChange, emptyIcon }) => {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<{
    account: string | null;
    instId: string | null;
    side: string | null;
    type: string | null;
  }>({
    account: null,
    instId: null,
    side: null,
    type: null,
  });

  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (!o) return false;
      const accountName = (o._accountId && accountIdNames?.[o._accountId]) || accountNames[o._account] || `#${o._account}`;
      const orderType = o.orderTypeDisplay || o.ordType;
      
      if (filters.account && accountName !== filters.account) return false;
      if (filters.instId && !SymbolUtils.isSameSymbol(o.instId, filters.instId)) return false;
      if (filters.side && (o.side === 'buy' ? t('order.buy') : o.side === 'sell' ? t('order.sell') : o.side) !== filters.side) return false;
      if (filters.type && orderType !== filters.type) return false;
      return true;
    });
  }, [orders, filters, accountNames, accountIdNames, t]);

  const uniqueValues = useMemo(() => {
    const accs = new Set<string>();
    const insts = new Set<string>();
    const sides = new Set<string>();
    const types = new Set<string>();

    orders.forEach(o => {
      if (!o) return;
      accs.add((o._accountId && accountIdNames?.[o._accountId]) || accountNames[o._account] || `#${o._account}`);
      insts.add(o.instId);
      sides.add(o.side === 'buy' ? t('order.buy') : o.side === 'sell' ? t('order.sell') : o.side);
      const type = o.orderTypeDisplay || o.ordType;
      if (type) types.add(type);
    });

    return {
      account: Array.from(accs),
      instId: Array.from(insts),
      side: Array.from(sides),
      type: Array.from(types),
    };
  }, [orders, accountNames, accountIdNames, t]);

  const needVirtualScroll = filteredOrders.length > 60;
  const totalHeight = filteredOrders.length * ROW_HEIGHT;

  const viewportHeight = SCROLL_CONTAINER_MAX_H;
  const startIndex = needVirtualScroll
    ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    : 0;
  const endIndex = needVirtualScroll
    ? Math.min(filteredOrders.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN)
    : filteredOrders.length;
  const visibleOrders = needVirtualScroll
    ? filteredOrders.slice(startIndex, endIndex)
    : filteredOrders;
  const offsetY = startIndex * ROW_HEIGHT;

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
  }, []);

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

  const handleFilterByAccount = useCallback((accountName: string) => {
    setFilters(prev => {
      if (prev.account === accountName) {
        return { ...prev, account: null };
      }
      return { ...prev, account: accountName };
    });
    setActiveFilter(null);
  }, []);

  const handleFilterByInstId = useCallback((instId: string) => {
    setFilters(prev => {
      if (prev.instId === instId) {
        return { ...prev, instId: null };
      }
      return { ...prev, instId };
    });
    setActiveFilter(null);
  }, []);

  const handleFilterByType = useCallback((type: string) => {
    setFilters(prev => {
      if (prev.type === type) {
        return { ...prev, type: null };
      }
      return { ...prev, type };
    });
    setActiveFilter(null);
  }, []);

  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(new Set());
  const selectedIds = controlledSelectedIds ?? internalSelectedIds;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const handleToggleSelect = useCallback((key: string) => {
    setInternalSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      const selectedOrders = filteredOrders.filter((o, i) => next.has(getOrderRowKey(o, i)));
      onSelectionChange?.(next, selectedOrders);
      return next;
    });
  }, [filteredOrders, onSelectionChange]);

  const handleSelectAll = useCallback(() => {
    const allKeys = new Set(filteredOrders.map((o, i) => getOrderRowKey(o, i)));
    setInternalSelectedIds(allKeys);
    onSelectionChange?.(allKeys, [...filteredOrders]);
  }, [filteredOrders, onSelectionChange]);

  const handleDeselectAll = useCallback(() => {
    setInternalSelectedIds(new Set());
    onSelectionChange?.(new Set(), []);
  }, [onSelectionChange]);

  useEffect(() => {
    setInternalSelectedIds(prev => {
      const validKeys = new Set(filteredOrders.map((o, i) => getOrderRowKey(o, i)));
      const cleaned = new Set([...prev].filter(k => validKeys.has(k)));
      if (cleaned.size !== prev.size) {
        const selectedOrders = filteredOrders.filter((o, i) => cleaned.has(getOrderRowKey(o, i)));
        onSelectionChange?.(cleaned, selectedOrders);
        return cleaned;
      }
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 filteredOrders 变化时清理，onSelectionChange 不应触发重算
  }, [filteredOrders]);

  useEffect(() => {
    onSelectionChangeRef.current?.(new Set(), []);
  }, []);

  const isAllSelected = selectedIds.size > 0 && selectedIds.size === filteredOrders.length;
  const isPartialSelected = selectedIds.size > 0 && selectedIds.size < filteredOrders.length;

  useEffect(() => {
    const el = headerCheckboxRef.current;
    if (el) el.indeterminate = isPartialSelected;
  }, [isPartialSelected]);

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon ?? <ClipboardList className="w-full h-full" />}
        title={t('order.noOrders')}
        minHeight="lg"
      />
    );
  }

  return (
    <div className="flex flex-col">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="overflow-auto custom-scrollbar max-h-[500px]"
      >
        <table className="w-full text-left text-xs whitespace-nowrap">
        <thead className="bg-surface-2 text-text-tertiary sticky top-0 z-[var(--z-dropdown)]">
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
            <th className="px-3 py-2 font-medium">
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
            <th className="px-3 py-2 font-medium text-text-tertiary">{t('order.mode')}</th>
            <th className="px-3 py-2 font-medium text-text-tertiary">{t('order.leverage')}</th>
            <th className="px-3 py-2 font-medium text-left">
              <FilterDropdown
                label={t('order.type')}
                field="type"
                options={uniqueValues.type}
                filters={filters}
                activeFilter={activeFilter}
                dropdownPos={dropdownPos}
                onFilterClick={handleFilterClick}
                onSelectFilter={handleSelectFilter}
                tooltip={t('common.orderTypeMapping')}
                formatOption={(val) => t(ORDER_TYPE_DISPLAY_MAP[val] || ('order.typeRaw.' + val))}
              />
            </th>
            <th className="px-3 py-2 font-medium">
              <FilterDropdown 
                label={t('order.direction')} 
                field="side" 
                options={uniqueValues.side}
                filters={filters}
                activeFilter={activeFilter}
                dropdownPos={dropdownPos}
                onFilterClick={handleFilterClick}
                onSelectFilter={handleSelectFilter}
              />
            </th>
            <th className="px-3 py-2 font-medium text-left">
              <Tooltip content={t('order.quantityTooltip')}>
                <DashedHint className="cursor-help">{t('order.quantity')}</DashedHint>
              </Tooltip>
            </th>
            <th className="px-3 py-2 font-medium text-left">{t('order.triggerPrice')}</th>
            <th className="px-3 py-2 font-medium text-left">{t('order.orderPrice')}</th>
            <th className="px-3 py-2 font-medium text-left">
              <Tooltip content={t('order.tpPriceMoveStopTooltip')}>
                <DashedHint className="cursor-help">{t('order.tpPrice')}</DashedHint>
              </Tooltip>
            </th>
            <th className="px-3 py-2 font-medium text-left">{t('order.slPrice')}</th>
            <th className="px-3 py-2 font-medium text-left">{t('order.orderTime')}</th>
            <th className="px-3 py-2 font-medium text-left">{t('order.orderId')}</th>
            <th className="bg-surface-2 pr-1.5 pl-1.5 py-2 font-medium text-right w-0 sticky right-0 z-20">{t('order.action')}</th>
          </tr>
        </thead>
        <DividedRows>
          {needVirtualScroll ? (
            <tr style={{ height: offsetY }}>
              <td colSpan={15} />
            </tr>
          ) : null}
          {visibleOrders.map((o, i) => {
            const rowKey = getOrderRowKey(o, i);
            return (
              <OrderRow
                key={rowKey}
                o={o}
                accountNames={accountNames}
                accountColors={accountColors}
                accountIdNames={accountIdNames}
                accountIdColors={accountIdColors}
                onJumpToAmend={onJumpToAmend}
                onJumpToCancel={onJumpToCancel}
                onConvertOrder={onConvertOrder}
                removeOrder={removeOrder}
                showToast={showToast}
                onFilterByAccount={handleFilterByAccount}
                onFilterByInstId={handleFilterByInstId}
                onFilterByType={handleFilterByType}
                rowKey={rowKey}
                isSelected={selectedIds.has(rowKey)}
                onToggleSelect={handleToggleSelect}
              />
            );
          })}
          {needVirtualScroll ? (
            <tr style={{ height: Math.max(0, totalHeight - offsetY - visibleOrders.length * ROW_HEIGHT) }}>
              <td colSpan={15} />
            </tr>
          ) : null}
        </DividedRows>
      </table>
      </div>
    </div>
  );
});

OrderTable.displayName = 'OrderTable';
