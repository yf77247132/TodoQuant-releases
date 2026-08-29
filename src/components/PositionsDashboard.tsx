import React, { useState, useCallback, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck, Wallet, FileText, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ensureLoaded } from '../lib/clientTickSz.ts';
import { StatCard } from './dashboard/StatCard.tsx';
import { AccountTable } from './dashboard/AccountTable.tsx';
import { PositionTable } from './dashboard/PositionTable.tsx';
import { OrderTable } from './dashboard/OrderTable.tsx';
import type { ConvertOrderInfo } from '../ui/ConvertOrderModal.tsx';
import { Account, Position, Order, AppConfig } from '../types/index.ts';
import ConfigHeader from '../ui/ConfigHeader.tsx';
import Button from '../ui/Button.tsx';
import CancelOnCloseToggle from '../ui/CancelOnCloseToggle.tsx';
import BatchClosePnl from '../ui/BatchClosePnl.tsx';
import { useCancelOnClosePref } from '../hooks/useCancelOnClosePref.ts';

interface PositionsDashboardProps {
  totalValuation: number;
  totalUpl: number;
  riskyCount: number;
  accList: Account[];
  posList: Position[];
  ordList: Order[];
  filteredPos: Position[];
  filteredOrders: Order[];
  config: Partial<AppConfig>;
  liqRules?: Record<number, { val: number, op: string }[]>;
  marginGuardedAccounts?: Set<number>;
  accountNames: Record<string, string>;
  accountColors: Record<string, string>;
  accountIdNames: Record<string, string>;
  accountIdColors: Record<string, string>;
  accountIdExchanges: Record<string, string>;
  accountExchanges: Record<string, string>;
  fundingRates?: Record<string, { rate: string; displayText: string }>;
  changeTodayMap?: Record<string, string>;
  wsStatus: Record<string, unknown>;
  reconnecting: boolean;
  handleReconnectAll: () => void;
  fmt: (n: unknown, digits?: number) => string;
  onJumpToMargin: (accountId: string, instId: string) => void;
  onJumpToDIY?: (tab: 'strategies' | 'conditions') => void;
  onJumpToAmend: (accountId: string, _account: number, instId: string, orderType: string) => void;
  onJumpToCancel: (accountId: string, _account: number, instId: string, orderType: string) => void;
  onConvertOrder?: (order: ConvertOrderInfo) => void;
  removeOrder?: (orderId: string) => void;
  showToast: (message: string, type: 'success' | 'error') => void;
  isActive?: boolean;
  onAddFirstAccount?: () => void;
  privacyMode?: boolean;
  onTogglePrivacyMode?: () => void;
}

export const PositionsDashboard: React.FC<PositionsDashboardProps> = memo(({
  totalValuation,
  totalUpl,
  riskyCount,
  config,
  accList,
  ordList,
  filteredPos,
  filteredOrders,
  liqRules,
  marginGuardedAccounts,
  accountNames,
  accountColors,
  accountIdNames,
  accountIdColors,
  accountIdExchanges,
  accountExchanges,
  wsStatus,
  reconnecting,
  handleReconnectAll,
  fmt,
  onJumpToMargin,
  onJumpToDIY,
  onJumpToAmend,
  onJumpToCancel,
  onConvertOrder,
  removeOrder,
  showToast,
  isActive = true,
  onAddFirstAccount,
  privacyMode = false,
  onTogglePrivacyMode,
  fundingRates,
  changeTodayMap,
}) => {
  const { t } = useTranslation();

  const { cancelOnClosePref, setCancelOnClosePrefAndPersist, cancelPendingOrdersForPositions } = useCancelOnClosePref();

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
    if (isActive) {
      setSelectedPositionIds(new Set());
      setSelectedPositions([]);
      setSelectedOrderIds(new Set());
      setSelectedOrders([]);
    }
  }, [isActive]);

  useEffect(() => { ensureLoaded(); }, []);

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
            if (!p._accountId) {
              console.warn('[batchClose] 跳过空 accountId 的持仓:', p.instId);
              return false;
            }
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
          const orders = selectedOrders.map(o => ({
            accountId: o._accountId || '',
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

  if (!isActive) return <div className="flex flex-col flex-1" />;
  return (
    <div className="flex flex-col space-y-6 animate-in fade-in duration-500 pb-8">
      <div className="grid grid-cols-3 md:grid-cols-3 gap-4 shrink-0">
        <div className="bg-surface-2 border border-border-default rounded-2xl p-4 flex flex-col shadow-sm">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider">{t('dashboard.stats.totalValuation')}</span>
            <button
              onClick={onTogglePrivacyMode}
              className="text-text-tertiary hover:text-text-secondary transition-colors"
              title={privacyMode ? t('common.showData') : t('common.hideData')}
            >
              {privacyMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <span className={`text-xl font-bold text-brand-yellow`}>{privacyMode ? '****' : fmt(totalValuation, 2)}</span>
        </div>
        <StatCard label={t('dashboard.stats.totalUpl')} value={privacyMode ? '****' : `${totalUpl >= 0 ? '+' : ''}${fmt(totalUpl, 2)}`} color={totalUpl > 0 ? 'text-trade-green' : totalUpl < 0 ? 'text-trade-red' : ''} />
        <StatCard label={t('dashboard.stats.liqWarning')} value={riskyCount} color={riskyCount > 0 ? 'text-trade-red' : ''} />
      </div>

      <div className="flex-1 flex flex-col gap-6 xl:min-h-0">
        <div className="flex flex-col space-y-4 shrink-0">
          <ConfigHeader
            icon={ShieldCheck}
            iconColor="text-brand-blue"
            title={t('dashboard.section.accountStatus')}
            subtitle={accList.length.toString()}
            actions={
              <Button
                onClick={handleReconnectAll}
                disabled={reconnecting}
                className="disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${reconnecting ? 'animate-spin' : ''}`} strokeWidth={2} />
                {t('dashboard.action.reconnect')}
              </Button>
            }
          />
          <div className="bg-surface-2 border border-border-default rounded-2xl shadow-sm overflow-hidden flex flex-col">
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
            />
          </div>
        </div>

        <div className="flex flex-col space-y-4 shrink-0">
          <ConfigHeader
            icon={Wallet}
            iconColor="text-brand-yellow"
            title={t('dashboard.section.currentPositions')}
            subtitle={filteredPos.length.toString()}
            actions={
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
            }
          />

          <div className="bg-surface-2 border border-border-default rounded-2xl shadow-sm overflow-hidden flex flex-col">
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
              privacyMode={privacyMode}
              fundingRates={fundingRates}
              changeTodayMap={changeTodayMap}
            />
          </div>
        </div>

        <div className="flex flex-col space-y-4">
          <ConfigHeader
            icon={FileText}
            iconColor="text-brand-blue"
            title={t('dashboard.section.currentOrders')}
            subtitle={ordList.length.toString()}
            actions={
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
            }
          />

          <div className="bg-surface-2 border border-border-default rounded-2xl shadow-sm overflow-hidden flex flex-col">
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
            />
          </div>
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

PositionsDashboard.displayName = 'PositionsDashboard';
