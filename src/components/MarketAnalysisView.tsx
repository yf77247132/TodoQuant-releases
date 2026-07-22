
import React, { memo, useCallback } from 'react';
import TradingViewModule from './TradingViewModule.tsx';
import CompactConfigPanel from './CompactConfigPanel.tsx';
import { BottomDataPanel } from './BottomDataPanel.tsx';
import DraggableSplitter from '../ui/DraggableSplitter.tsx';
import type { Account, Position, Order, AppConfig, LogEntry } from '../types/index.ts';
import type { ConvertOrderInfo } from '../ui/ConvertOrderModal.tsx';

interface MarketAnalysisViewProps {
  isActive: boolean;
  positions: Position[];
  accountNames: Record<string, string>;
  accountColors: Record<string, string>;
  accountIdNames: Record<string, string>;
  accountIdColors: Record<string, string>;
  liqRules?: Record<number, { val: number; op: string }[]>;
  guardedAccounts?: Set<number>;
  config: Partial<AppConfig>;
  updateConfig: (newConfig: Partial<AppConfig>) => Promise<boolean>;
  onJumpToMargin: (accountId: string, instId: string) => void;
  onJumpToDIY: (tab: 'strategies' | 'conditions') => void;
  showToast: (message: string, type: 'success' | 'error') => void;

  accList: Account[];
  posList: Position[];
  ordList: Order[];
  filteredPos: Position[];
  filteredOrders: Order[];
  accountIdExchanges: Record<string, string>;
  accountExchanges: Record<string, string>;
  wsStatus: Record<string, unknown>;
  reconnecting: boolean;
  handleReconnectAll: () => void;
  fmt: (n: unknown, digits?: number) => string;
  onJumpToAmend: (accountId: string, _account: number, instId: string, orderType: string) => void;
  onJumpToCancel: (accountId: string, _account: number, instId: string, orderType: string) => void;
  onConvertOrder?: (order: ConvertOrderInfo) => void;
  removeOrder?: (orderId: string) => void;
  onAddFirstAccount?: () => void;
  privacyMode?: boolean;
  fundingRates?: Record<string, { rate: string; displayText: string }>;

  onNavigateToModule: (moduleKey: string, configId?: string, action?: 'edit' | 'new') => void;

  moduleLogs: Record<string, LogEntry[]>;
  onClearModuleLog: (moduleKey: string) => void;
}

export const MarketAnalysisView: React.FC<MarketAnalysisViewProps> = memo(({
  isActive,
  positions: _positions,
  accountNames,
  accountColors,
  accountIdNames,
  accountIdColors,
  liqRules,
  guardedAccounts,
  config,
  updateConfig,
  onJumpToMargin,
  onJumpToDIY,
  showToast,

  accList,
  posList,
  ordList,
  filteredPos,
  filteredOrders,
  accountIdExchanges,
  accountExchanges,
  wsStatus,
  reconnecting: _reconnecting,
  handleReconnectAll: _handleReconnectAll,
  fmt,
  onJumpToAmend,
  onJumpToCancel,
  onConvertOrder,
  removeOrder,
  onAddFirstAccount,
  privacyMode,
  fundingRates,

  onNavigateToModule,
  moduleLogs,
  onClearModuleLog,
}) => {
  const handleNavigateToModule = useCallback((moduleKey: string, configId?: string, action?: 'edit' | 'new') => {
    onNavigateToModule(moduleKey, configId, action);
  }, [onNavigateToModule]);

  return (
    <div className="h-[calc(100vh-100px)] flex flex-col">
      <DraggableSplitter
        storageKey="market-view-vsplit"
        defaultRatio={0.5}
        minRatio={0.3}
        maxRatio={0.85}
        direction="horizontal"
        allowOverflow
        className="w-full flex-1 min-h-0"
      >
        <DraggableSplitter
          storageKey="market-view-hsplit"
          defaultRatio={0.6}
          minRatio={0.4}
          maxRatio={0.85}
          direction="vertical"
          className="w-full h-full"
        >
          <div className="h-full min-w-0 bg-transparent border border-transparent rounded-none overflow-hidden p-0 flex flex-col">
            <TradingViewModule
              isActive={isActive}
              config={config}
              updateConfig={updateConfig}
            />
          </div>

          <div className="h-full min-w-0 bg-transparent border border-transparent rounded-none overflow-hidden flex flex-col p-0">
            <CompactConfigPanel
              config={config}
              accountNames={accountIdNames}
              accountColors={accountIdColors}
              showToast={showToast}
              onNavigateToModule={handleNavigateToModule}
              logs={moduleLogs}
              onClearLogs={onClearModuleLog}
            />
          </div>
        </DraggableSplitter>

        <div className="bg-surface-2 border border-border-default rounded-2xl overflow-hidden flex flex-col mt-0">
          <BottomDataPanel
            accList={accList}
            accountNames={accountNames}
            accountColors={accountColors}
            accountIdNames={accountIdNames}
            accountIdColors={accountIdColors}
            accountIdExchanges={accountIdExchanges}
            accountExchanges={accountExchanges}
            wsStatus={wsStatus}
            onAddFirstAccount={onAddFirstAccount}
            posList={posList}
            filteredPos={filteredPos}
            liqRules={liqRules}
            marginGuardedAccounts={guardedAccounts}
            onJumpToMargin={onJumpToMargin}
            onJumpToDIY={onJumpToDIY}
            ordList={ordList}
            filteredOrders={filteredOrders}
            onJumpToAmend={onJumpToAmend}
            onJumpToCancel={onJumpToCancel}
            onConvertOrder={onConvertOrder}
            removeOrder={removeOrder}
            showToast={showToast}
            config={config}
            fmt={fmt}
            privacyMode={privacyMode}
            fundingRates={fundingRates}
          />
        </div>
      </DraggableSplitter>
    </div>
  );
});

MarketAnalysisView.displayName = 'MarketAnalysisView';
