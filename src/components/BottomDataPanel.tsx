import React, { useState, useCallback, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck, Wallet, FileText, Clock, History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DashedHint from '../ui/DashedHint';
import { AccountTable } from './dashboard/AccountTable.tsx';
import { PositionTable } from './dashboard/PositionTable.tsx';
import { OrderTable } from './dashboard/OrderTable.tsx';
import { HistoryOrderTable } from './dashboard/HistoryOrderTable.tsx';
import { HistoryPositionTable, type HistoryPosition } from './dashboard/HistoryPositionTable.tsx';
import type { ConvertOrderInfo } from '../ui/ConvertOrderModal.tsx';
import type { Account, Position, Order, AppConfig } from '../types/index.ts';
import Button from '../ui/Button.tsx';
import { Tooltip } from '../ui/Tooltip.tsx';
import CancelOnCloseToggle from '../ui/CancelOnCloseToggle.tsx';
import BatchClosePnl from '../ui/BatchClosePnl.tsx';
import { useCancelOnClosePref } from '../hooks/useCancelOnClosePref.ts';

const DATA_TABS = [
  { key: 'orders' as const, i18nKey: 'dashboard.section.currentOrders', icon: FileText },
  { key: 'positions' as const, i18nKey: 'dashboard.section.currentPositions', icon: Wallet },
  { key: 'accounts' as const, i18nKey: 'dashboard.section.accountStatus', icon: ShieldCheck },
  { key: 'history' as const, i18nKey: 'dashboard.section.historyOrders', icon: Clock },
  { key: 'historyPositions' as const, i18nKey: 'dashboard.section.historyPositions', icon: History },
];

type DataTabKey = (typeof DATA_TABS)[number]['key'];

interface BottomDataPanelProps {
  config: Partial<AppConfig>;
  accList: Account[];
  accountNames: Record<string, string>;
  accountColors: Record<string, string>;
  accountIdNames: Record<string, string>;
  accountIdColors: Record<string, string>;
  accountIdExchanges: Record<string, string>;
  accountExchanges: Record<string, string>;
  wsStatus: Record<string, unknown>;
  onAddFirstAccount?: () => void;

  posList: Position[];
  filteredPos: Position[];
  liqRules?: Record<number, { val: number; op: string }[]>;
  marginGuardedAccounts?: Set<number>;
  onJumpToMargin: (accountId: string, instId: string) => void;
  onJumpToDIY?: (tab: 'strategies' | 'conditions') => void;
  fundingRates?: Record<string, { rate: string; displayText: string }>;
  changeTodayMap?: Record<string, string>;
  historyVersion?: number;
  historyOrders?: Order[];
  historyPositions?: HistoryPosition[];

  ordList: Order[];
  filteredOrders: Order[];
  onJumpToAmend: (accountId: string, _account: number, instId: string, orderType: string) => void;
  onJumpToCancel: (accountId: string, _account: number, instId: string, orderType: string) => void;
  onConvertOrder?: (order: ConvertOrderInfo) => void;
  removeOrder?: (orderId: string) => void;

  showToast: (message: string, type: 'success' | 'error') => void;
  config: Partial<AppConfig>;
  fmt: (n: unknown, digits?: number) => string;
  privacyMode?: boolean;
}

export const BottomDataPanel: React.FC<BottomDataPanelProps> = memo(({
  config,
  accList,
  accountNames,
  accountColors,
  accountIdNames,
  accountIdColors,
  accountIdExchanges,
  accountExchanges,
  wsStatus,
  onAddFirstAccount,

  posList: _posList,
  filteredPos,
  liqRules,
  marginGuardedAccounts,
  onJumpToMargin,
  onJumpToDIY,
  fundingRates,
  changeTodayMap,
  historyVersion: _historyVersion,
  historyOrders = [],
  historyPositions = [],

  ordList: _ordList,
  filteredOrders,
  onJumpToAmend,
  onJumpToCancel,
  onConvertOrder,
  removeOrder,

  showToast,
  config: _config,
  fmt: _fmt,
  privacyMode,
}) => {
  const { t } = useTranslation();
  const { cancelOnClosePref, setCancelOnClosePrefAndPersist, cancelPendingOrdersForPositions } = useCancelOnClosePref();

  const [activeTab, setActiveTab] = useState<DataTabKey>('orders');

  const [visibleCounts, setVisibleCounts] = useState<{ orders: number | null; positions: number | null }>({ orders: null, positions: null });
  const handleOrdersVisibleCount = useCallback((n: number) => {
    setVisibleCounts(prev => (prev.orders === n ? prev : { ...prev, orders: n }));
  }, []);
  const handlePositionsVisibleCount = useCallback((n: number) => {
    setVisibleCounts(prev => (prev.positions === n ? prev : { ...prev, positions: n }));
  }, []);

  const [selectedPositionIds, setSelectedPositionIds] = useState<Set<string>>(new Set());
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [selectedPositions, setSelectedPositions] = useState<Position[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Order[]>([]);
  const [batchLoading, setBatchLoading] = useState<'close' | 'cancel' | null>(null);

  const [confirmModal, setConfirmModal] = useState<{
    type: 'close' | 'cancel';
    count: number;
    onConfirm: () => void;
  } | null>(null);

  useEffect(() => {
    setSelectedPositionIds(new Set());
    setSelectedPositions([]);
    setSelectedOrderIds(new Set());
    setSelectedOrders([]);
  }, [activeTab]);

  const handlePositionSelectionChange = useCallback((ids: Set<string>, positions: Position[]) => {
    setSelectedPositionIds(ids);
    setSelectedPositions(positions);
  }, []);

  const handleOrderSelectionChange = useCallback((ids: Set<string>, orders: Order[]) => {
    setSelectedOrderIds(ids);
    setSelectedOrders(orders);
  }, []);

  const handleBatchClose = useCallback(() => {
    if (selectedPositions.length === 0) return;
    setConfirmModal({
      type: 'close',
      count: selectedPositions.length,
      onConfirm: async () => {
        setConfirmModal(null);
        setBatchLoading('close');
        try {
          const validPositions = selectedPositions.filter(p => {
            if (!p._accountId) return false;
            return true;
          });
          if (validPositions.length === 0) {
            showToast(t('position.closeFailed'), 'error');
            setBatchLoading(null);
            return;
          }
          const positions = validPositions.map(p => ({
            accountId: p._accountId,
            instId: p.instId,
            mgnMode: p.mgnMode,
            posSide: p.posSide,
            ccy: p.ccy,
          }));
          const res = await fetch('/api/position/batch-close', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ positions }),
          });
          const data = await res.json();
          if (data.ok) {
            if (cancelOnClosePref) {
              const cancelResult = await cancelPendingOrdersForPositions(validPositions);
              if (cancelResult.count > 0) {
                showToast(
                  cancelResult.fail > 0 && cancelResult.fail < cancelResult.count
                    ? t('position.cancelOrdersOnClosePartial', { success: cancelResult.success, count: cancelResult.count, fail: cancelResult.fail })
                    : t('position.cancelOrdersOnCloseDone', { count: cancelResult.success }),
                  cancelResult.fail > 0 ? 'error' : 'success'
                );
                return;
              }
            }
            if (data.fail > 0) {
              showToast(t('position.batchCloseSuccess', { success: data.success, fail: data.fail }), 'error');
            } else {
              showToast(t('position.batchCloseAllSuccess', { count: data.success }), 'success');
            }
          } else {
            showToast(`${t('position.closeFailed')}：${data.error || t('position.unknownError')}`, 'error');
          }
        } catch (e: unknown) {
          const err = e instanceof Error ? e : new Error(String(e));
          showToast(`${t('position.closeFailed')}：${err.message}`, 'error');
        } finally {
          setBatchLoading(null);
          setSelectedPositionIds(new Set());
          setSelectedPositions([]);
        }
      },
    });
  }, [selectedPositions, cancelOnClosePref, cancelPendingOrdersForPositions, showToast, t]);

  const handleBatchCancel = useCallback(() => {
    if (selectedOrders.length === 0) return;
    setConfirmModal({
      type: 'cancel',
      count: selectedOrders.length,
      onConfirm: async () => {
        setConfirmModal(null);
        setBatchLoading('cancel');
        try {
          const validOrders = selectedOrders.filter(o => !!o._accountId);
          if (validOrders.length === 0) {
            showToast(t('order.cancelFailed'), 'error');
            setBatchLoading(null);
            return;
          }
          const orders = validOrders.map(o => ({
            accountId: o._accountId!,
            instId: o.instId,
            ordId: o.ordId,
            algoId: o.algoId,
            tdMode: o.tdMode,
          }));
          const res = await fetch('/api/order/batch-cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orders }),
          });
          const data = await res.json();
          if (data.ok) {
            if (data.fail > 0) {
              showToast(t('order.batchCancelSuccess', { success: data.success, fail: data.fail }), 'error');
            } else {
              showToast(t('order.batchCancelAllSuccess', { count: data.success }), 'success');
            }
          } else {
            showToast(`${t('order.cancelFailed')}：${data.error || data.failMsg || t('order.networkError')}`, 'error');
          }
        } catch (e: unknown) {
          const err = e instanceof Error ? e : new Error(String(e));
          showToast(`${t('order.cancelFailed')}：${err.message}`, 'error');
        } finally {
          setBatchLoading(null);
          setSelectedOrderIds(new Set());
          setSelectedOrders([]);
        }
      },
    });
  }, [selectedOrders, showToast, t]);

  const renderBatchActions = () => {
    if (activeTab === 'positions') {
      return (
        <div className="flex items-center gap-2">
          {selectedPositionIds.size > 0 && (
            <span className="text-xs text-text-secondary">
              {t('batch.selectedCount', { count: selectedPositionIds.size })}
            </span>
          )}
          <Button
            className="hover:text-trade-red"
            onClick={handleBatchClose}
            disabled={selectedPositionIds.size === 0 || batchLoading === 'close'}
          >
            {batchLoading === 'close' ? '...' : t('position.batchClose')}
          </Button>
        </div>
      );
    }
    if (activeTab === 'orders') {
      return (
        <div className="flex items-center gap-2">
          {selectedOrderIds.size > 0 && (
            <span className="text-xs text-text-secondary">
              {t('batch.selectedCount', { count: selectedOrderIds.size })}
            </span>
          )}
          <Button
            className="hover:text-trade-red"
            onClick={handleBatchCancel}
            disabled={selectedOrderIds.size === 0 || batchLoading === 'cancel'}
          >
            {batchLoading === 'cancel' ? '...' : t('order.batchCancelSelected')}
          </Button>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border-subtle shrink-0 px-0 pt-0 bg-surface-2 rounded-t-2xl">
        <div className="flex items-center">
          {DATA_TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            const count = tab.key === 'orders'
              ? (visibleCounts.orders ?? filteredOrders.length)
              : tab.key === 'positions'
                ? (visibleCounts.positions ?? filteredPos.length)
                : tab.key === 'history'
                  ? -1
                  : tab.key === 'historyPositions'
                    ? -1
                    : accList.length;
            const tipKey = tab.key === 'history'
              ? 'dashboard.section.historyOrdersTip'
              : tab.key === 'historyPositions'
                ? 'dashboard.section.historyPositionsTip'
                : null;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 h-9 text-xs font-medium transition-colors ${
                  isActive
                    ? 'text-brand-yellow border-b-2 border-brand-yellow'
                    : 'text-text-tertiary hover:text-text-secondary border-b-2 border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0 -ml-0.5" />
                {tipKey ? (
                  <Tooltip content={t(tipKey)}>
                    <DashedHint className="cursor-help leading-none">{t(tab.i18nKey)}</DashedHint>
                  </Tooltip>
                ) : t(tab.i18nKey)}
                {count > 0 && (
                  <span className="bg-white/10 text-text-secondary text-3xs px-1.5 py-0.5 rounded-full">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="pr-2">
          {renderBatchActions()}
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-0 relative">
        <div style={{ display: activeTab === 'orders' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <OrderTable
            orders={filteredOrders}
            accountNames={accountNames}
            accountColors={accountColors}
            accountIdNames={accountIdNames}
            accountIdColors={accountIdColors}
            onJumpToAmend={onJumpToAmend}
            onJumpToCancel={onJumpToCancel}
            onConvertOrder={onConvertOrder}
            removeOrder={removeOrder}
            showToast={showToast}
            selectedIds={selectedOrderIds}
            onSelectionChange={handleOrderSelectionChange}
            onVisibleCountChange={handleOrdersVisibleCount}
            emptyIcon={<FileText className="w-full h-full" />}
          />
        </div>
        <div style={{ display: activeTab === 'positions' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <PositionTable
            positions={filteredPos}
            accountNames={accountNames}
            accountColors={accountColors}
            accountIdNames={accountIdNames}
            accountIdColors={accountIdColors}
            liqRules={liqRules}
            guardedAccounts={marginGuardedAccounts}
            onJumpToMargin={onJumpToMargin}
            onJumpToDIY={onJumpToDIY}
            selectedIds={selectedPositionIds}
            onSelectionChange={handlePositionSelectionChange}
            onVisibleCountChange={handlePositionsVisibleCount}
            privacyMode={privacyMode}
            fundingRates={fundingRates}
            changeTodayMap={changeTodayMap}
            emptyIcon={<Wallet className="w-full h-full" />}
          />
        </div>
        <div style={{ display: activeTab === 'accounts' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <AccountTable
            accounts={accList}
            accountNames={accountNames}
            accountExchanges={accountExchanges}
            accountColors={accountColors}
            accountIdNames={accountIdNames}
            accountIdColors={accountIdColors}
            accountIdExchanges={accountIdExchanges}
            wsStatus={wsStatus}
            onAddFirstAccount={onAddFirstAccount}
            privacyMode={privacyMode}
            emptyIcon={<ShieldCheck className="w-full h-full" />}
          />
        </div>
        <div style={{ display: activeTab === 'history' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <HistoryOrderTable
            orders={historyOrders}
            accountNames={accountNames}
            accountColors={accountColors}
            accountIdNames={accountIdNames}
            accountIdColors={accountIdColors}
            showToast={showToast}
          />
        </div>
        <div style={{ display: activeTab === 'historyPositions' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <HistoryPositionTable
            positions={historyPositions}
            accountNames={accountNames}
            accountColors={accountColors}
            accountIdNames={accountIdNames}
            accountIdColors={accountIdColors}
          />
        </div>
      </div>

      {confirmModal && createPortal(
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
              {confirmModal.type === 'close'
                ? t('position.batchCloseConfirm', { count: confirmModal.count })
                : t('order.batchCancelConfirm', { count: confirmModal.count })}
            </p>
            {confirmModal.type === 'close' && (
              <BatchClosePnl positions={selectedPositions} livePositions={filteredPos} />
            )}
            {confirmModal.type === 'close' && (
              <CancelOnCloseToggle checked={cancelOnClosePref} onChange={setCancelOnClosePrefAndPersist} />
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="md" className="rounded-xl" onClick={() => setConfirmModal(null)}>{t('common.cancel')}</Button>
              <Button variant="primary" size="md" className="rounded-xl" onClick={confirmModal.onConfirm}>
                {confirmModal.type === 'close' ? t('position.batchClose') : t('order.batchCancelSelected')}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});

BottomDataPanel.displayName = 'BottomDataPanel';
