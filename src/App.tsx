import './i18n';
import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Wallet, FilePlus2, Edit3, Trash2, XCircle, ArrowLeftRight, Cpu, Key, Activity, CircleDollarSign, Settings, MessageCircle, ArrowLeft, ArrowRight, RefreshCcw, TrendingUp } from 'lucide-react';

import { Tooltip } from './ui/Tooltip.tsx';
import Button from './ui/Button.tsx';
import { useTradingData } from './hooks/useTradingData.ts';
import { useModuleRouter } from './hooks/useModuleRouter.ts';
import { usePerformanceMonitoring } from './hooks/usePerformanceMonitoring.ts';
import { useToast } from './hooks/useToast.ts';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import type { AppConfig, LogEntry } from './types/index.ts';
import ConfigToast from './ui/ConfigToast.tsx';
import { useConfigShortcutKeys } from './hooks/useConfigShortcutKeys.ts';
import ConfirmModal from './ui/ConfirmModal.tsx';
import ConvertOrderModal, { type ConvertOrderInfo } from './ui/ConvertOrderModal.tsx';

import PlaceModule from './components/PlaceModule.tsx';
import AmendModule from './components/AmendModule.tsx';
import CancelModule from './components/CancelModule.tsx';
import CloseModule from './components/CloseModule.tsx';
import MarginModule from './components/MarginModule.tsx';
import ApiKeysModule from './components/ApiKeysModule.tsx';
import { MarketAnalysisView } from './components/MarketAnalysisView.tsx';
import DIYModule from './components/DIYModule.tsx';
import MarketMonitorModule from './components/MarketMonitorModule.tsx';
import { SystemSettingsModule } from './components/SystemSettingsModule.tsx';

import { PositionsDashboard } from './components/PositionsDashboard.tsx';
import { calculateLiquidationDistance } from './lib/positionUtils.ts';

import { LogModal } from './components/dashboard/LogModal.tsx';

const fmt = (n: unknown, digits = 2) => { const v = parseFloat(String(n)); return isNaN(v) ? '--' : v.toFixed(digits); };

const NavItem = React.memo(({ id, icon: Icon, label, activeModule, onClick, isCollapsed }: { id: string, icon: React.ComponentType<{ className?: string, strokeWidth?: number }>, label: string, activeModule: string, onClick: (id: string) => void, isCollapsed: boolean }) => {
  const content = (
    <button
      onClick={() => onClick(id)}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all mb-1 ${
        activeModule === id
          ? 'bg-brand-yellow text-black shadow-lg shadow-brand-yellow/20'
          : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
      } ${isCollapsed ? 'justify-center px-2' : ''}`}
    >
      <Icon className="w-5 h-5 shrink-0" strokeWidth={2} />
      {!isCollapsed && <span className="truncate">{label}</span>}
    </button>
  );

  return isCollapsed ? (
    <Tooltip content={label} className="w-full">
      {content}
    </Tooltip>
  ) : content;
});
NavItem.displayName = 'NavItem';

export default function App() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast, showToast } = useToast();

  usePerformanceMonitoring(2000);
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reasonStr = String(event.reason);
      const reasonMsg = event.reason?.message ? String(event.reason.message) : "";

      if (
        reasonStr === "Script error." ||
        reasonStr.includes("tradingview") ||
        reasonMsg === "Script error." ||
        reasonMsg.includes("tradingview") ||
        reasonMsg.includes("ResizeObserver")
      ) {
        event.preventDefault();
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  }, []);
  
  const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
    console.error('应用错误:', error, errorInfo);
  };

  const {
    positions,
    accounts,
    orders,
    logs,
    traderLogs,
    amendLogs,
    marginLogs,
    diyLogs,
    cancelLogs,
    closeLogs,
    envStatus,
    wsStatus,
    config,
    serverTimezone,
    updateConfig,
    setLogs,
    setTraderLogs,
    setAmendLogs,
    setMarginLogs,
    setDiyLogs,
    setCancelLogs,
    setCloseLogs,
    removeOrder,
    accountIdNames,
    accountIdColors,
    accountIdExchanges,
    fundingRates,
    changeTodayMap,
  } = useTradingData();

  const { shortcutConfirmModal, handleConfirmStart, handleCancelConfirm } = useConfigShortcutKeys(config, showToast);

  const { activeModule, handleSetActiveModule, handleNavigateToModule } = useModuleRouter(config);

  const [amendPreFill, setAmendPreFill] = useState<{ accountId: string; _account: number; instId: string; orderType: string } | null>(null);
  const [cancelPreFill, setCancelPreFill] = useState<{ accountId: string; _account: number; instId: string; orderType: string } | null>(null);
  const [diyPreFillTab, setDiyPreFillTab] = useState<'strategies' | 'conditions' | 'backtest' | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(config?.isSidebarCollapsed || false);
  const [autoOpenApiKeyAdd, setAutoOpenApiKeyAdd] = useState(false);

  const [privacyMode, setPrivacyMode] = useState(config?.privacyMode || false);

  useEffect(() => {
    setIsSidebarCollapsed(config?.isSidebarCollapsed || false);
  }, [config?.isSidebarCollapsed]);

  useEffect(() => {
    if (config?.privacyMode !== undefined) {
      setPrivacyMode(config.privacyMode);
    }
  }, [config?.privacyMode]);

  const handleAddFirstAccount = React.useCallback(() => {
    handleSetActiveModule('apikeys');
    setAutoOpenApiKeyAdd(true);
  }, [handleSetActiveModule]);

  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false);
  useEffect(() => {
    if (!window.electronAPI) return;
    const cleanups: Array<() => void> = [];
    cleanups.push(window.electronAPI.onUpdateChecking(() => {
      showToast(t('settings.checkingUpdate'), 'success');
    }));
    cleanups.push(window.electronAPI.onUpdateNotAvailable(() => {
      showToast(t('settings.alreadyLatestVersion'), 'success');
    }));
    cleanups.push(window.electronAPI.onUpdateAvailable((version) => {
      showToast(t('settings.newVersionFound', { version }), 'success');
    }));
    cleanups.push(window.electronAPI.onUpdateDownloadProgress((_percent) => {
    }));
    cleanups.push(window.electronAPI.onUpdateDownloaded(() => {
      setUpdateDownloaded(true);
      showToast(t('settings.updateDownloaded'), 'success');
    }));
    cleanups.push(window.electronAPI.onUpdateError((message) => {
      showToast(t('settings.updateCheckFailedMsg', { message }), 'error');
    }));
    return () => cleanups.forEach(fn => fn());
  }, [showToast, t]);

  const handleJumpToMargin = React.useCallback((_accountId: string, _instId: string) => {
    handleSetActiveModule('margin');
  }, [handleSetActiveModule]);

  const handleJumpToDIY = React.useCallback((tab: 'strategies' | 'conditions') => {
    setDiyPreFillTab(tab);
    handleSetActiveModule('diy');
  }, [handleSetActiveModule]);

  useEffect(() => {
    const handler = (e: Event) => {
      const moduleId = (e as CustomEvent).detail;
      if (typeof moduleId === 'string') {
        handleSetActiveModule(moduleId);
      }
    };
    window.addEventListener('navigate-module', handler);
    return () => window.removeEventListener('navigate-module', handler);
  }, [handleSetActiveModule]);

  const handleJumpToAmend = React.useCallback((accountId: string, _account: number, instId: string, orderType: string) => {
    window.dispatchEvent(new CustomEvent('open-config-modal', {
      detail: { action: 'prefill', moduleKey: 'amend', preFill: { accountId, _account, instId, orderType } },
    }));
  }, []);

  const handleJumpToCancel = React.useCallback((accountId: string, _account: number, instId: string, orderType: string) => {
    window.dispatchEvent(new CustomEvent('open-config-modal', {
      detail: { action: 'prefill', moduleKey: 'cancel', preFill: { accountId, _account, instId, orderType } },
    }));
  }, []);

  const [convertOrderOpen, setConvertOrderOpen] = useState(false);
  const [convertOrderInfo, setConvertOrderInfo] = useState<ConvertOrderInfo | null>(null);
  const handleConvertOrder = React.useCallback((order: ConvertOrderInfo) => {
    setConvertOrderInfo(order);
    setConvertOrderOpen(true);
  }, []);
  const handleConvertSuccess = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
  }, [queryClient]);

  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const handleOpenLogs = React.useCallback(() => setIsLogsOpen(true), []);

  const configAccountNames = config?.accountNames;
  const configAccountColors = config?.accountColors;
  const configAccountExchanges = config?.accountExchanges;

  const accountNames = useMemo(() => configAccountNames || {}, [configAccountNames]);
  const accountColors = useMemo(() => configAccountColors || {}, [configAccountColors]);
  const accountExchanges = useMemo(() => configAccountExchanges || {}, [configAccountExchanges]);

  const posList = useMemo(() => Object.values(positions), [positions]);
  const accList = useMemo(() => Object.values(accounts), [accounts]);
  const ordList = useMemo(() => Object.values(orders), [orders]);

  const handleReconnectAll = React.useCallback(async () => {
    const disconnectedAccounts = accList
      .map(a => a._account)
      .filter(idx => !wsStatus[idx]?.connected);

    setReconnecting(true);
    try {
      if (disconnectedAccounts.length > 0) {
        for (const idx of disconnectedAccounts) {
          const acc = accList.find(a => a._account === idx);
          const id = acc?._accountId || String(idx);
          await fetch(`/api/ws/reconnect/${id}`, { method: 'POST' });
        }
        setTimeout(() => window.location.reload(), 1500);
      } else {
        window.location.reload();
      }
    } catch (e) {
      console.error('重连失败:', e);
      showToast(t('app.reconnectFailed'), 'error');
      setReconnecting(false);
    }
  }, [accList, wsStatus, showToast, t]);

  const filteredPos = useMemo(() => {
    return [...posList].filter(p => !!p).sort((a, b) => {
      if (a._account !== b._account) return a._account - b._account;
      if (a.instId !== b.instId) return a.instId.localeCompare(b.instId);
      return (a.posSide || '').localeCompare(b.posSide || '');
    });
  }, [posList]);

  const filteredOrders = useMemo(() => {
    return [...ordList].sort((a, b) => parseInt(b.cTime || '0') - parseInt(a.cTime || '0'));
  }, [ordList]);

  const totalUpl = useMemo(() => posList.reduce((s, p) => s + (parseFloat(p.upl) || 0), 0), [posList]);
  
  const totalValuation = useMemo(() => {
    return accList.reduce((s, a) => s + (parseFloat(a?.valuation?.totalBal || '0') || 0), 0);
  }, [accList]);

  const configDiyConditions = (config as AppConfig)?.diy_conditions;
  const configAccounts = config?.accounts;

  const { liqRules, marginGuardedAccounts } = useMemo(() => {
    const diyConditions = configDiyConditions || [];
    
    const guardedAccounts = new Set<number>();
    const rules: Record<number, { val: number, op: string }[]> = {};

    for (const template of (diyConditions as Array<{ conditions?: { type: string; params: Record<string, any> }[] }>)) {
      if (!template.conditions || !Array.isArray(template.conditions)) continue;

      for (const block of template.conditions) {
        if (block.type === 'pos_liq_dist') {
          const accId = String(block.params.accountId || '').trim();
          const currentAccounts = configAccounts || [];
          const accIdx = accId ? currentAccounts.findIndex((a: any) => a.id === accId) : -1;
          if (accIdx < 0) continue;
          const t = parseFloat(block.params.dist);
          const op = block.params.operator || '<=';
          
          if (!isNaN(t)) {
            guardedAccounts.add(accIdx);
            if (!rules[accIdx]) rules[accIdx] = [];
            rules[accIdx].push({ val: t, op });
          }
        }
      }
    }

    return { 
      liqRules: rules, 
      marginGuardedAccounts: guardedAccounts
    };
  }, [configDiyConditions, configAccounts]);

  const riskyCount = useMemo(() => {
    if (marginGuardedAccounts.size === 0) return 0;

    const evaluate = (val: number, op: string, threshold: number) => {
      switch(op) {
        case '=': return val === threshold;
        case '<': return val < threshold;
        case '>': return val > threshold;
        case '<=': return val <= threshold;
        case '>=': return val >= threshold;
        default: return val <= threshold;
      }
    };

    return posList.filter(p => {
      if (!p || !marginGuardedAccounts.has(p._account)) return false;

      const diff = parseFloat(String(calculateLiquidationDistance(p)));
      if (isNaN(diff)) return false;

      const rules = liqRules[p._account] || [];
      return rules.some(r => evaluate(diff, r.op, r.val));
    }).length;
  }, [posList, liqRules, marginGuardedAccounts]);

  const hasError = useMemo(() => logs?.some(l => l && l.level === 'error' && l.category === 'SYSTEM') || false, [logs]);

  const handleClearTraderLogs = React.useCallback(() => setTraderLogs([]), [setTraderLogs]);
  const handleClearAmendLogs = React.useCallback(() => setAmendLogs([]), [setAmendLogs]);
  const handleClearMarginLogs = React.useCallback(() => setMarginLogs([]), [setMarginLogs]);
  const handleClearDiyLogs = React.useCallback(() => setDiyLogs([]), [setDiyLogs]);
  const handleClearCancelLogs = React.useCallback(() => setCancelLogs([]), [setCancelLogs]);
  const handleClearCloseLogs = React.useCallback(() => setCloseLogs([]), [setCloseLogs]);

  const handleClearAllLogs = React.useCallback(() => {
    setLogs([]);
    setTraderLogs([]);
    setAmendLogs([]);
    setMarginLogs([]);
    setDiyLogs([]);
    setCancelLogs([]);
    setCloseLogs([]);
  }, [setLogs, setTraderLogs, setAmendLogs, setMarginLogs, setDiyLogs, setCancelLogs, setCloseLogs]);

  const handleCloseLogs = React.useCallback(() => setIsLogsOpen(false), []);

  const updateConfigWithInvalidate = React.useCallback(async (newConfig: Partial<AppConfig>) => {
    try {
      const result = await updateConfig(newConfig);
      return result;
    } catch (err) {
      console.error('更新配置失败:', err);
      return false;
    }
  }, [updateConfig]);

  const toggleSidebar = React.useCallback(() => {
    const newState = !isSidebarCollapsed;
    setIsSidebarCollapsed(newState);
    updateConfigWithInvalidate({ isSidebarCollapsed: newState });
  }, [isSidebarCollapsed, updateConfigWithInvalidate]);

  return (
    <ErrorBoundary onError={handleError}>
      <div className="flex h-screen bg-bg-dark text-text-primary font-sans overflow-hidden">
      <aside className={`border-r border-border-default px-2 pt-2 pb-4 flex flex-col shrink-0 h-full transition-all duration-300 ${isSidebarCollapsed ? 'w-[65px]' : 'w-[180px]'} group`}>
        <div 
          onClick={toggleSidebar}
          className={`flex items-center gap-2 cursor-pointer mt-2 mb-4 px-2 hover:bg-white/5 py-2 rounded-xl transition-colors ${isSidebarCollapsed ? 'justify-center' : ''}`}
        >
          <div className="relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden group-hover:hidden">
            <img src="./icon.png" alt="TodoQuant" className="w-full h-full object-contain" />
          </div>
          <div className="relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden hidden group-hover:flex">
            {isSidebarCollapsed ? <ArrowRight size={16} strokeWidth={2.5} className="text-brand-yellow" /> : <ArrowLeft size={16} strokeWidth={2.5} className="text-brand-yellow" />}
          </div>

          <div className={`overflow-hidden ${isSidebarCollapsed ? 'hidden' : 'block'}`}>
             <span className="text-xl font-bold tracking-tight text-text-primary transition-opacity group-hover:hidden whitespace-nowrap">
               TodoQuant
             </span>
             <span className="text-xl font-bold tracking-tight text-text-primary transition-opacity hidden group-hover:block whitespace-nowrap">
               {t('nav.collapse')}
             </span>
          </div>
        </div>
        
        <nav className="flex-1 space-y-1 overflow-y-auto hidden-scrollbar">
          <NavItem id="market" icon={CircleDollarSign} label={t('nav.market')} activeModule={activeModule} onClick={handleSetActiveModule} isCollapsed={isSidebarCollapsed} />
          <NavItem id="monitor" icon={TrendingUp} label={t('nav.monitor')} activeModule={activeModule} onClick={handleSetActiveModule} isCollapsed={isSidebarCollapsed} />
          <NavItem id="positions" icon={Wallet} label={t('nav.positions')} activeModule={activeModule} onClick={handleSetActiveModule} isCollapsed={isSidebarCollapsed} />
          <NavItem id="place" icon={FilePlus2} label={t('nav.place')} activeModule={activeModule} onClick={handleSetActiveModule} isCollapsed={isSidebarCollapsed} />
          <NavItem id="amend" icon={Edit3} label={t('nav.amend')} activeModule={activeModule} onClick={handleSetActiveModule} isCollapsed={isSidebarCollapsed} />
          <NavItem id="cancel" icon={Trash2} label={t('nav.cancel')} activeModule={activeModule} onClick={handleSetActiveModule} isCollapsed={isSidebarCollapsed} />
          <NavItem id="close" icon={XCircle} label={t('nav.close')} activeModule={activeModule} onClick={handleSetActiveModule} isCollapsed={isSidebarCollapsed} />
          <NavItem id="margin" icon={ArrowLeftRight} label={t('nav.margin')} activeModule={activeModule} onClick={handleSetActiveModule} isCollapsed={isSidebarCollapsed} />
          <NavItem id="diy" icon={Cpu} label={t('nav.diy')} activeModule={activeModule} onClick={handleSetActiveModule} isCollapsed={isSidebarCollapsed} />
          <NavItem id="apikeys" icon={Key} label={t('nav.apikeys')} activeModule={activeModule} onClick={handleSetActiveModule} isCollapsed={isSidebarCollapsed} />
          <NavItem id="settings" icon={Settings} label={t('nav.settings')} activeModule={activeModule} onClick={handleSetActiveModule} isCollapsed={isSidebarCollapsed} />
          <NavItem id="contact" icon={MessageCircle} label={t('nav.contact')} activeModule={activeModule} onClick={handleSetActiveModule} isCollapsed={isSidebarCollapsed} />
        </nav>

        <div className="mt-auto pt-4 border-t border-border-default space-y-2 shrink-0">
          {updateDownloaded && (
            <button
              onClick={() => setShowUpdateConfirm(true)}
              className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between px-3'} py-2.5 bg-trade-green/10 border border-trade-green/20 rounded-2xl backdrop-blur-sm hover:bg-trade-green/20 transition-all group`}
            >
              <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-2'}`}>
                <RefreshCcw className="w-4 h-4 text-trade-green" />
                {!isSidebarCollapsed && (
                  <span className="text-xs font-bold text-trade-green">{t('settings.installUpdateNow')}</span>
                )}
              </div>
            </button>
          )}
          <button
            onClick={handleOpenLogs}
            title={isSidebarCollapsed ? (hasError ? t('nav.systemError') : t('nav.systemNormal')) : undefined}
            className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between px-3'} py-2.5 bg-surface-2 border border-border-default rounded-2xl hover:bg-surface-3 transition-all shadow-sm group`}
          >
            <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-2'}`}>              <div className={`w-2 h-2 rounded-full ${hasError ? 'bg-trade-red shadow-[0_0_8px_color-mix(in_srgb,var(--color-trade-red)_50%,transparent)]' : 'bg-trade-green shadow-[0_0_8px_color-mix(in_srgb,var(--color-trade-green)_50%,transparent)]'}`}></div>              {!isSidebarCollapsed && (
                <span className={`text-xs font-bold ${hasError ? 'text-trade-red' : 'text-text-secondary'}`}>
                  {hasError ? t('nav.systemError') : t('nav.systemNormal')}
                </span>
              )}
            </div>
            {!isSidebarCollapsed && <Activity className="w-4 h-4 text-brand-yellow group-hover:scale-110 transition-transform" strokeWidth={2} />}
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar">
          
          <div className={`flex flex-col flex-1 p-6 ${activeModule === 'positions' ? '' : 'hidden'}`}>
            <PositionsDashboard
              totalValuation={totalValuation}
              totalUpl={totalUpl}
              riskyCount={riskyCount}
              accList={accList}
              posList={posList}
              ordList={ordList}
              filteredPos={filteredPos}
              filteredOrders={filteredOrders}
              config={config}
              liqRules={liqRules}
              removeOrder={removeOrder}
              showToast={showToast}
              isActive={activeModule === 'positions'}
              privacyMode={privacyMode}
              onTogglePrivacyMode={() => {
                const next = !privacyMode;
                setPrivacyMode(next);
                updateConfig({ privacyMode: next } as Partial<AppConfig>);
              }}
              marginGuardedAccounts={marginGuardedAccounts}
              accountNames={accountNames}
              accountColors={accountColors}
              accountIdNames={accountIdNames}
              accountIdColors={accountIdColors}
              accountIdExchanges={accountIdExchanges}
              accountExchanges={accountExchanges}
              fundingRates={fundingRates}
              changeTodayMap={changeTodayMap}
              wsStatus={wsStatus}
              reconnecting={reconnecting}
              handleReconnectAll={handleReconnectAll}
              fmt={fmt}
              onJumpToMargin={handleJumpToMargin}
              onJumpToDIY={handleJumpToDIY}
              onJumpToAmend={handleJumpToAmend}
              onJumpToCancel={handleJumpToCancel}
              onConvertOrder={handleConvertOrder}
              onAddFirstAccount={handleAddFirstAccount}
            />
          </div>

          <div className={`flex flex-col flex-1 p-4 ${activeModule === 'market' ? '' : 'hidden'}`}>
            <MarketAnalysisView
              isActive={activeModule === 'market'}
              positions={filteredPos}
              accountNames={accountNames}
              accountColors={accountColors}
              accountIdNames={accountIdNames}
              accountIdColors={accountIdColors}
              liqRules={liqRules}
              guardedAccounts={marginGuardedAccounts}
              config={config}
              updateConfig={updateConfigWithInvalidate}
              onJumpToMargin={handleJumpToMargin}
              onJumpToDIY={handleJumpToDIY}
              showToast={showToast}
              accList={accList}
              posList={posList}
              privacyMode={privacyMode}
              ordList={ordList}
              filteredPos={filteredPos}
              filteredOrders={filteredOrders}
              accountIdExchanges={accountIdExchanges}
              accountExchanges={accountExchanges}
              wsStatus={wsStatus}
              reconnecting={reconnecting}
              handleReconnectAll={handleReconnectAll}
              fmt={fmt}
              onJumpToAmend={handleJumpToAmend}
              onJumpToCancel={handleJumpToCancel}
              onConvertOrder={handleConvertOrder}
              removeOrder={removeOrder}
              onAddFirstAccount={handleAddFirstAccount}
              fundingRates={fundingRates}
              changeTodayMap={changeTodayMap}
              onNavigateToModule={handleNavigateToModule}
              moduleLogs={{
                place: traderLogs,
                amend: amendLogs,
                cancel: cancelLogs,
                close: closeLogs,
                margin: marginLogs,
                diy: diyLogs,
              }}
              onClearModuleLog={(moduleKey) => {
                const clearFn: Record<string, () => void> = {
                  place: handleClearTraderLogs,
                  amend: handleClearAmendLogs,
                  cancel: handleClearCancelLogs,
                  close: handleClearCloseLogs,
                  margin: handleClearMarginLogs,
                  diy: handleClearDiyLogs,
                };
                clearFn[moduleKey]?.();
              }}
            />
          </div>

          <div className={`flex flex-col flex-1 min-h-0 p-6 ${activeModule === 'monitor' ? '' : 'hidden'}`}>
            <MarketMonitorModule />
          </div>

          <div className={`flex flex-col flex-1 min-h-0 p-6 ${activeModule === 'place' ? '' : 'hidden'}`}>
            <PlaceModule
              config={config}
              logs={traderLogs}
              onClearLogs={handleClearTraderLogs}
              accountNames={config.accountNames || {}}
              accountColors={config.accountColors || {}}
              showToast={showToast}
              serverTimezone={serverTimezone}
              isActive={activeModule === 'place'}
              positions={posList}
            />
          </div>

          <div className={`flex flex-col flex-1 min-h-0 p-6 ${activeModule === 'amend' ? '' : 'hidden'}`}>
            <AmendModule
              config={config}
              logs={amendLogs}
              onClearLogs={handleClearAmendLogs}
              accountNames={config.accountNames || {}}
              accountColors={config.accountColors || {}}
              preFill={amendPreFill}
              showToast={showToast}
              onClearPreFill={() => setAmendPreFill(null)}
              onCancelBack={() => {}}
              serverTimezone={serverTimezone}
              isActive={activeModule === 'amend'}
            />
          </div>

          <div className={`flex flex-col flex-1 min-h-0 p-6 ${activeModule === 'cancel' ? '' : 'hidden'}`}>
            <CancelModule
              config={config}
              logs={cancelLogs}
              onClearLogs={handleClearCancelLogs}
              accountNames={config.accountNames || {}}
              accountColors={config.accountColors || {}}
              preFill={cancelPreFill}
              showToast={showToast}
              onClearPreFill={() => setCancelPreFill(null)}
              onCancelBack={() => {}}
              serverTimezone={serverTimezone}
              isActive={activeModule === 'cancel'}
            />
          </div>

          <div className={`flex flex-col flex-1 min-h-0 p-6 ${activeModule === 'close' ? '' : 'hidden'}`}>
            <CloseModule
              config={config}
              logs={closeLogs}
              onClearLogs={handleClearCloseLogs}
              accountNames={config.accountNames || {}}
              accountColors={config.accountColors || {}}
              showToast={showToast}
              serverTimezone={serverTimezone}
              isActive={activeModule === 'close'}
            />
          </div>

          <div className={`flex flex-col flex-1 min-h-0 p-6 ${activeModule === 'margin' ? '' : 'hidden'}`}>
            <MarginModule
              config={config}
              logs={marginLogs}
              onClearLogs={handleClearMarginLogs}
              accountNames={config.accountNames || {}}
              accountColors={config.accountColors || {}}
              showToast={showToast}
              serverTimezone={serverTimezone}
              isActive={activeModule === 'margin'}
            />
          </div>

          <div className={`flex flex-col flex-1 min-h-0 p-6 ${activeModule === 'diy' ? '' : 'hidden'}`}>
            <DIYModule
              config={config}
              logs={diyLogs}
              onClearLogs={handleClearDiyLogs}
              showToast={showToast}
              serverTimezone={serverTimezone}
              preFillTab={diyPreFillTab}
              onClearPreFillTab={() => setDiyPreFillTab(null)}
              isActive={activeModule === 'diy'}
            />
          </div>

          <div className={`flex flex-col flex-1 min-h-0 p-6 ${activeModule === 'apikeys' ? '' : 'hidden'}`}>
            <ApiKeysModule autoOpenAdd={autoOpenApiKeyAdd} onAutoOpenHandled={() => setAutoOpenApiKeyAdd(false)} isActive={activeModule === 'apikeys'} />
          </div>

          <div className={`flex flex-col flex-1 min-h-0 p-6 ${activeModule === 'settings' ? '' : 'hidden'}`}>
            <SystemSettingsModule
              config={config}
              updateConfig={updateConfigWithInvalidate}
              isActive={activeModule === 'settings'}
              accountColors={config.accountColors || {}}
            />
          </div>

          <div className={`flex flex-col flex-1 min-h-0 p-6 ${activeModule === 'contact' ? '' : 'hidden'}`}>
            <div className="flex flex-col items-center h-full gap-8">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-text-primary">{t('contact.title')}</h1>
                <p className="mt-2 text-sm text-text-tertiary">{t('contact.description')}</p>
              </div>

              <div className="flex flex-wrap justify-center gap-6 max-w-2xl">
                <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-surface-2 border border-border-default min-w-[240px] shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-brand-yellow">BINANCE</span>
                  </div>
                  <img src="./qr-binance.png" alt={t('contact.binanceQrAlt')} className="w-64 h-64 rounded-xl bg-white p-2" />
                  <span className="text-xs text-text-tertiary">{t('contact.binanceScan')}</span>
                </div>

                <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-surface-2 border border-border-default min-w-[240px] shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-brand-yellow">OKX</span>
                  </div>
                  <img src="./qr-okx.png" alt={t('contact.okxQrAlt')} className="w-64 h-64 rounded-xl bg-white p-2" />
                  <span className="text-xs text-text-tertiary">{t('contact.okxScan')}</span>
                </div>
              </div>

              <h2 className="text-base font-semibold text-text-secondary">{t('contact.contactUs')}</h2>

              <div className="flex flex-wrap justify-center gap-3">
                <button
                  onClick={() => {
                    const url = 'https://x.com/TodoQuant';
                    if (window.electronAPI?.openExternal) {
                      window.electronAPI.openExternal(url);
                    } else {
                      window.open(url, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-surface-3 hover:bg-surface-4 transition-all group"
                >
                  <svg className="w-5 h-5 text-text-secondary group-hover:text-text-primary transition-colors" viewBox="0 0 25 24" fill="currentColor">
                    <path d="M16.5944 5H19.0361L13.7028 11.1309L20 19.4444H15.0522L11.1968 14.4049L6.76305 19.4444H4.32129L10.0402 12.8963L4 5H9.07631L12.5783 9.62222L16.5944 5ZM15.7269 17.9679H17.0763L8.33735 6.38025H6.85944L15.7269 17.9679Z" />
                  </svg>
                  <span className="text-sm font-medium text-text-secondary group-hover:text-text-primary transition-colors">{t('contact.twitter')}</span>
                </button>

                <button
                  onClick={() => {
                    const url = 'https://t.me/+VTWkTJI1I4U0NmRl';
                    if (window.electronAPI?.openExternal) {
                      window.electronAPI.openExternal(url);
                    } else {
                      window.open(url, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-surface-3 hover:bg-surface-4 transition-all group"
                >
                  <svg className="w-5 h-5 text-[#26A5E4] group-hover:text-[#3db9ed] transition-colors" viewBox="0 0 17 16" fill="currentColor">
                    <path d="M2.84154 8.0247C2.87139 8.00977 2.90126 7.99558 2.93037 7.98214C3.4364 7.74772 3.94915 7.52822 4.46115 7.30873C4.48876 7.30873 4.53502 7.27662 4.56115 7.26617C4.6007 7.249 4.64027 7.23258 4.67982 7.21541C4.75595 7.18256 4.83208 7.15045 4.90747 7.1176C5.05972 7.05265 5.21122 6.98771 5.36348 6.92275C5.66725 6.79285 5.97101 6.66295 6.27478 6.5323C6.88231 6.27249 7.49061 6.01192 8.09814 5.75211C8.70567 5.4923 9.31395 5.23175 9.92148 4.97194C10.529 4.71213 11.1373 4.45158 11.7448 4.19177C12.3524 3.93196 12.9607 3.67141 13.5682 3.4116C13.7033 3.35337 13.8496 3.26677 13.9944 3.24138C14.116 3.21973 14.2347 3.17793 14.3571 3.15479C14.5892 3.11074 14.8452 3.09282 15.0676 3.18913C15.1445 3.22272 15.2154 3.26975 15.2743 3.32873C15.5565 3.60795 15.5169 4.06635 15.4572 4.45905C15.0415 7.196 14.6258 9.9337 14.2093 12.6706C14.1526 13.0462 14.075 13.4583 13.7786 13.6957C13.5279 13.8965 13.1711 13.9189 12.8614 13.8338C12.5516 13.7479 12.2785 13.568 12.0105 13.3911C10.8992 12.655 9.78714 11.9188 8.67582 11.1827C8.41161 11.008 8.11755 10.7796 8.12053 10.4623C8.12203 10.2711 8.23621 10.1009 8.35264 9.94936C9.31843 8.68914 10.7119 7.82312 11.7486 6.62113C11.8948 6.45166 12.0098 6.14557 11.809 6.04777C11.6896 5.98954 11.5523 6.06866 11.4433 6.14406C10.073 7.09595 8.70343 8.04858 7.33312 9.00046C6.88606 9.31104 6.41735 9.63057 5.87848 9.70672C5.39633 9.77541 4.9112 9.64103 4.44473 9.50365C4.05364 9.38868 3.66328 9.27072 3.27443 9.14903C3.06769 9.08483 2.85423 9.01539 2.69451 8.86981C2.53479 8.72423 2.443 8.47937 2.53928 8.28526C2.59973 8.16356 2.71691 8.08667 2.84006 8.02395L2.84154 8.0247Z" />
                  </svg>
                  <span className="text-sm font-medium text-text-secondary group-hover:text-text-primary transition-colors">{t('contact.telegram')}</span>
                </button>

                <button
                  onClick={() => {
                    const url = 'https://discord.gg/p3UGyD5kGw';
                    if (window.electronAPI?.openExternal) {
                      window.electronAPI.openExternal(url);
                    } else {
                      window.open(url, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-surface-3 hover:bg-surface-4 transition-all group"
                >
                  <svg className="w-5 h-5 text-[#5865F2] group-hover:text-[#7289da] transition-colors" viewBox="0 0 25 24" fill="currentColor">
                    <path d="M21.2273 5.45428C21.2273 5.45428 18.7258 3.4961 15.7727 3.27246L15.5065 3.80537C18.176 4.45937 19.4011 5.39428 20.6818 6.54519C18.4744 5.41828 16.2964 4.36337 12.5 4.36337C8.70364 4.36337 6.52564 5.41828 4.31818 6.54519C5.59891 5.39428 7.05636 4.35464 9.49345 3.80537L9.22727 3.27246C6.12909 3.56428 3.77273 5.45428 3.77273 5.45428C3.77273 5.45428 0.979455 9.50482 0.5 17.4543C3.31455 20.7014 7.59091 20.727 7.59091 20.727L8.48545 19.5357C6.96691 19.0077 5.25418 18.0657 3.77273 16.3634C5.53891 17.6997 8.20455 19.0906 12.5 19.0906C16.7955 19.0906 19.4611 17.6997 21.2273 16.3634C19.7464 18.0657 18.0336 19.0077 16.5145 19.5357L17.4091 20.727C17.4091 20.727 21.6855 20.7014 24.5 17.4543C24.0205 9.50482 21.2273 5.45428 21.2273 5.45428ZM8.95455 15.2725C7.89964 15.2725 7.04545 14.2961 7.04545 13.0906C7.04545 11.8852 7.89964 10.9088 8.95455 10.9088C10.0095 10.9088 10.8636 11.8852 10.8636 13.0906C10.8636 14.2961 10.0095 15.2725 8.95455 15.2725ZM16.0455 15.2725C14.9905 15.2725 14.1364 14.2961 14.1364 13.0906C14.1364 11.8852 14.9905 10.9088 16.0455 10.9088C17.1004 10.9088 17.9545 11.8852 17.9545 13.0906C17.9545 14.2961 17.1004 15.2725 16.0455 15.2725Z" />
                  </svg>
                  <span className="text-sm font-medium text-text-secondary group-hover:text-text-primary transition-colors">Discord</span>
                </button>

                <button
                  onClick={() => {
                    const url = 'https://www.reddit.com/user/TodoQuant1/';
                    if (window.electronAPI?.openExternal) {
                      window.electronAPI.openExternal(url);
                    } else {
                      window.open(url, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-surface-3 hover:bg-surface-4 transition-all group"
                >
                  <svg className="w-5 h-5 text-[#FF4500] group-hover:text-[#FF6A33] transition-colors" viewBox="0 0 25 24" fill="currentColor">
                    <path d="M23.6563 10.4234C23.357 9.06528 22.1167 8.18473 20.8866 8.45634C20.4673 8.54857 20.1061 8.7646 19.8207 9.06022C18.1649 7.85753 15.9042 7.06289 13.3795 6.91255L14.5882 1.87943L18.1737 2.73724C18.2331 3.71759 19.0452 4.49453 20.0404 4.49453C21.0356 4.49453 21.9121 3.65568 21.9121 2.62227C21.9121 1.58886 21.0735 0.75 20.0404 0.75C19.2915 0.75 18.6461 1.19091 18.348 1.82763L14.4581 0.896551C14.1525 0.823278 13.8456 1.01151 13.7711 1.31724L12.4336 6.88729C9.61718 6.90245 7.07609 7.71731 5.25238 9.02233C5.16271 8.93895 5.06673 8.86188 4.9619 8.79366C3.89975 8.11525 2.43218 8.51572 1.68451 9.68683C0.936832 10.8592 1.19069 12.3588 2.25284 13.0372C2.31599 13.0776 2.3804 13.113 2.44608 13.1458C2.40314 13.4074 2.3804 13.6739 2.3804 13.943C2.3804 17.8404 6.91571 21 12.5106 21C18.1056 21 22.6409 17.8404 22.6409 13.943C22.6409 13.6701 22.6169 13.401 22.5727 13.137C23.4353 12.6355 23.9051 11.5427 23.6588 10.4234H23.6563ZM7.31607 12.3083C7.31607 11.4201 8.03596 10.7 8.92382 10.7C9.81168 10.7 10.5316 11.4201 10.5316 12.3083C10.5316 13.1964 9.81168 13.9165 8.92382 13.9165C8.03596 13.9165 7.31607 13.1964 7.31607 12.3083ZM16.2452 17.3856C15.7514 17.8341 14.3874 18.8801 12.3907 18.8991C12.373 18.8991 12.354 18.8991 12.3363 18.8991C10.3131 18.8991 8.93139 17.8429 8.42747 17.3856C8.26581 17.2391 8.25445 16.9889 8.40095 16.8285C8.54745 16.6668 8.79752 16.6554 8.95792 16.8019C9.39617 17.2012 10.6074 18.1272 12.3831 18.1108C14.1095 18.0943 15.2879 17.1911 15.7148 16.8032C15.8764 16.6567 16.1252 16.668 16.2717 16.8297C16.4182 16.9914 16.4069 17.2403 16.2452 17.3869V17.3856ZM16.0507 13.9165C15.1629 13.9165 14.443 13.1964 14.443 12.3083C14.443 11.4201 15.1629 10.7 16.0507 10.7C16.9386 10.7 17.6585 11.4201 17.6585 12.3083C17.6585 13.1964 16.9386 13.9165 16.0507 13.9165Z" />
                  </svg>
                  <span className="text-sm font-medium text-text-secondary group-hover:text-text-primary transition-colors">{t('contact.reddit')}</span>
                </button>

                <button
                  onClick={() => {
                    const url = 'https://www.youtube.com/@TudoQuant';
                    if (window.electronAPI?.openExternal) {
                      window.electronAPI.openExternal(url);
                    } else {
                      window.open(url, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-surface-3 hover:bg-surface-4 transition-all group"
                >
                  <svg className="w-5 h-5 text-[#FF0000] group-hover:text-[#FF3333] transition-colors" viewBox="0 0 25 24" fill="currentColor">
                    <path d="M23.9985 5.6445C23.7225 4.60357 22.9092 3.78376 21.8766 3.50555C20.005 3 12.5 3 12.5 3C12.5 3 4.99503 3 3.12336 3.50555C2.09077 3.7838 1.27752 4.60357 1.0015 5.6445C0.5 7.53125 0.5 12.0171 0.5 12.0171C0.5 12.0171 0.5 16.5029 1.0015 18.3897C1.27752 19.4306 2.09077 20.2162 3.12336 20.4945C4.99503 21 12.5 21 12.5 21C12.5 21 20.005 21 21.8766 20.4945C22.9092 20.2162 23.7225 19.4306 23.9985 18.3897C24.5 16.5029 24.5 12.0171 24.5 12.0171C24.5 12.0171 24.5 7.53125 23.9985 5.6445ZM10.0454 15.5912V8.44302L16.3181 12.0172L10.0454 15.5912Z" />
                  </svg>
                  <span className="text-sm font-medium text-text-secondary group-hover:text-text-primary transition-colors">{t('contact.youtube')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <LogModal
        isOpen={isLogsOpen}
        onClose={handleCloseLogs}
        logs={logs}
        envStatus={envStatus}
        hasError={hasError}
        onClear={handleClearAllLogs}
        timezone={serverTimezone}
      />
      
      {showUpdateConfirm && (
        <div className="fixed inset-0 z-[var(--z-toast)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={() => setShowUpdateConfirm(false)}>
          <div className="bg-surface-2 border border-border-default rounded-2xl p-6 max-w-sm w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-text-secondary mb-2">{t('settings.confirmAction')}</h3>
            <p className="text-sm text-text-secondary mb-4">{t('settings.confirmInstallUpdate')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="md" className="rounded-xl" onClick={() => setShowUpdateConfirm(false)}>{t('common.cancel')}</Button>
              <Button variant="primary" size="md" className="rounded-xl" onClick={async () => {
                setShowUpdateConfirm(false);
                try {
                  if (window.electronAPI) await window.electronAPI.restartAndUpdate();
                } catch {
                  showToast(t('settings.installUpdateFailed'), 'error');
                }
              }}>{t('common.confirm')}</Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!shortcutConfirmModal?.isOpen}
        title={t('shortcut.confirmTitle')}
        message={t('shortcut.confirmMessage', {
          module: shortcutConfirmModal ? t(`nav.${shortcutConfirmModal.moduleId}`) : '',
          name: shortcutConfirmModal?.configName || '',
        })}
        onClose={handleCancelConfirm}
        onConfirm={handleConfirmStart}
      />

      <ConvertOrderModal
        open={convertOrderOpen}
        order={convertOrderInfo}
        onClose={() => setConvertOrderOpen(false)}
        onSuccess={handleConvertSuccess}
        showToast={showToast}
      />

      {toast && <ConfigToast message={toast.message} type={toast.type} />}
      </div>
    </ErrorBoundary>
  );
}
