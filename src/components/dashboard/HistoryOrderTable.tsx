import DashedHint from '../../ui/DashedHint'
import { DividedRows } from '../../ui/Divider'
import React, { useState, useMemo, memo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Order } from '../../types/trading.ts';
import { SymbolUtils } from '../../lib/symbolUtils.ts';
import { Copy, Clock } from 'lucide-react';
import { Spinner } from '../../ui/Spinner.tsx';
import { Tooltip } from '../../ui/Tooltip.tsx';
import { FilterDropdown, fmt } from './sharedUtils.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { DEFAULT_ACCOUNT_COLORS } from '../../constants/colors.ts';
import CoinIcon from '../../ui/CoinIcon.tsx';

const ORDER_STATE_MAP: Record<string, string> = {
  'live': 'order.stateLive',
  'partially_filled': 'order.statePartiallyFilled',
  'filled': 'order.stateFilled',
  'canceled': 'order.stateCanceled',
  'mmp_canceled': 'order.stateMmpCanceled',
  'effective': 'order.stateEffective',
  'partially_effective': 'order.statePartiallyEffective',
  'order_failed': 'order.stateOrderFailed',
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

interface HistoryOrderTableProps {
  orders: Order[];
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  accountIdNames?: Record<string, string>;
  accountIdColors?: Record<string, string>;
  loading?: boolean;
  showToast?: (message: string, type: 'success' | 'error') => void;
}

const getHistoryRowKey = (o: Order, i: number) =>
  `${o._accountId || o._account}-${o.ordId || o.algoId || `${o.instId}-${o.orderTime || i}`}`;

const ROW_HEIGHT = 40;
const OVERSCAN = 5;
const SCROLL_CONTAINER_MAX_H = 500;

export const HistoryOrderTable: React.FC<HistoryOrderTableProps> = memo(({
  orders,
  accountNames,
  accountColors,
  accountIdNames,
  accountIdColors,
  loading = false,
  showToast,
}) => {
  const { t } = useTranslation();

  const [filters, setFilters] = useState<{
    account: string | null;
    instId: string | null;
    side: string | null;
    type: string | null;
    state: string | null;
  }>({
    account: null,
    instId: null,
    side: null,
    type: null,
    state: null,
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
      if (filters.state && o.state !== filters.state) return false;
      return true;
    });
  }, [orders, filters, accountNames, accountIdNames, t]);

  const uniqueValues = useMemo(() => {
    const accs = new Set<string>();
    const insts = new Set<string>();
    const sides = new Set<string>();
    const types = new Set<string>();
    const states = new Set<string>();

    orders.forEach(o => {
      if (!o) return;
      accs.add((o._accountId && accountIdNames?.[o._accountId]) || accountNames[o._account] || `#${o._account}`);
      insts.add(o.instId);
      sides.add(o.side === 'buy' ? t('order.buy') : o.side === 'sell' ? t('order.sell') : o.side);
      const type = o.orderTypeDisplay || o.ordType;
      if (type) types.add(type);
      if (o.state) states.add(o.state);
    });

    return {
      account: Array.from(accs),
      instId: Array.from(insts),
      side: Array.from(sides),
      type: Array.from(types),
      state: Array.from(states),
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

  const fmtTime = (ts: string | undefined) => {
    if (!ts) return '-';
    const date = new Date(parseInt(ts));
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${m}/${d} ${h}:${min}:${s}`;
  };

  const fmtPrice = (val: string | number | undefined | null, instId: string) => {
    const strVal = String(val ?? '');
    if (strVal === '-1' || val === -1) return t('order.priceMarket');
    return fmt(strVal || '', instId);
  };

  if (loading) {
    return (
      <Spinner size="lg" label={t('order.loadingHistory')} className="text-brand-yellow" />
    );
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={<Clock className="w-full h-full" />}
        title={t('order.noHistoryOrders')}
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
              <th className="px-3 py-2 font-medium text-left">{t('order.updateTime')}</th>
              <th className="px-3 py-2 font-medium text-left">
                <FilterDropdown
                  label={t('order.orderState')}
                  field="state"
                  options={uniqueValues.state}
                  filters={filters}
                  activeFilter={activeFilter}
                  dropdownPos={dropdownPos}
                  onFilterClick={handleFilterClick}
                  onSelectFilter={handleSelectFilter}
                  formatOption={(val) => t(ORDER_STATE_MAP[val] || val)}
                />
              </th>
              <th className="px-3 py-2 font-medium text-left">{t('order.orderId')}</th>
            </tr>
          </thead>
          <DividedRows>
            {needVirtualScroll ? (
              <tr style={{ height: offsetY }}>
                <td colSpan={15} />
              </tr>
            ) : null}
            {visibleOrders.map((o, i) => {
              const isBuy = o.side === 'buy';
              let sz = parseFloat(o.sz || '0');
              const isBinance = o.exchange === 'BINANCE';
              if (!isBinance && SymbolUtils.isSameSymbol(o.instId, 'ETH-USDT-SWAP')) sz = sz / 10;

              const color = (o._accountId && accountIdColors?.[o._accountId]) || accountColors[o._account] || DEFAULT_ACCOUNT_COLORS[o._account % DEFAULT_ACCOUNT_COLORS.length];

              return (
                <tr key={getHistoryRowKey(o, i)} className="hover:bg-surface-3/50 transition-colors">
                  <td className="px-3 py-2">
                    <Tooltip content={t('order.clickToFilter')}>
                      <DashedHint className="font-bold cursor-pointer"
                        style={{ color }}
                        onClick={() => setFilters(prev => prev.account === ((o._accountId && accountIdNames?.[o._accountId]) || accountNames[o._account] || `#${o._account}`) ? { ...prev, account: null } : { ...prev, account: (o._accountId && accountIdNames?.[o._accountId]) || accountNames[o._account] || `#${o._account}` })}
                      >
                        {(o._accountId && accountIdNames?.[o._accountId]) || accountNames[o._account] || `#${o._account}`}
                      </DashedHint>
                    </Tooltip>
                  </td>
                  <td className="px-3 py-2">
                    <Tooltip content={t('order.clickToFilter')}>
                      <DashedHint className="font-mono text-text-primary cursor-pointer inline-flex items-center gap-1.5"
                        onClick={() => setFilters(prev => prev.instId && SymbolUtils.isSameSymbol(prev.instId!, o.instId) ? { ...prev, instId: null } : { ...prev, instId: o.instId })}
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
                    {o.lever ? `${parseInt(String(o.lever), 10)}x` : '-'}
                  </td>
                  <td className="px-3 py-2">
                    <Tooltip content={t('order.clickToFilter')}>
                      <DashedHint className="text-text-secondary cursor-pointer"
                        onClick={() => setFilters(prev => prev.type === (o.orderTypeDisplay || o.ordType) ? { ...prev, type: null } : { ...prev, type: o.orderTypeDisplay || o.ordType })}
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
                    {fmtPrice(o.tpPrice, o.instId)}
                  </td>
                  <td className="px-3 py-2 text-left font-mono text-text-primary">
                    {fmtPrice(o.slPrice, o.instId)}
                  </td>
                  <td className="px-3 py-2 text-left font-mono text-text-secondary">
                    {fmtTime(o.orderTime)}
                  </td>
                  <td className="px-3 py-2 text-left font-mono text-text-secondary">
                    {fmtTime(o.uTime)}
                  </td>
                  <td className="px-3 py-2 text-left">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      o.state === 'filled' ? 'bg-trade-green/15 text-trade-green' :
                      o.state === 'canceled' ? 'bg-trade-red/15 text-trade-red' :
                      o.state === 'partially_filled' ? 'bg-brand-yellow/15 text-brand-yellow' :
                      'bg-surface-4 text-text-tertiary'
                    }`}>
                      {t(ORDER_STATE_MAP[o.state || ''] || o.state || '-')}
                    </span>
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
                                showToast?.(t('order.copied'), 'success');
                              }).catch(() => {});
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
                </tr>
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

HistoryOrderTable.displayName = 'HistoryOrderTable';
