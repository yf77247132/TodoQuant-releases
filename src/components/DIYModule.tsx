import React, { useCallback, useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Plus, Activity, List, ListChecks, LineChart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ConfigHeader from '../ui/ConfigHeader.tsx';
import ConfigListLayout, { EmptyConfigs } from '../ui/ConfigListLayout.tsx';
import LogViewer from '../ui/LogViewer.tsx';
import { useModuleState } from '../hooks/useModuleState.ts';
import { useConfigManager } from '../hooks/useConfigManager.ts';
import { useConfigList } from '../hooks/useConfigList.ts';
import Button from '../ui/Button.tsx';
import ConditionTemplateModal from './diy/ConditionTemplateModal.tsx';
import StrategyModal from './diy/StrategyModal.tsx';
import StrategyCard from './diy/StrategyCard.tsx';
import BacktestPanel, { BacktestRunParams } from './diy/BacktestPanel.tsx';
import BacktestReportArea from './diy/BacktestReportArea.tsx';
import ConditionCard from './diy/ConditionCard.tsx';
import BatchActionBar from '../ui/BatchActionBar.tsx';
import { LogEntry } from '../types/logs.ts';
import type { DIYStrategy, ConditionTemplate, AppConfig, ExchangeAccount } from '../types/index.ts';
import type { FtBacktestResultDetail } from '../types/freqtrade.ts';
import { buildSpecFromConditions } from '../freqtrade/buildSpecFromConditions.ts';
import { okxPairToFtPair } from '../freqtrade/strategyGenerator.ts';
import { PlaceConfigItem } from './PlaceModule.tsx';
import { CancelConfigItem } from './CancelModule.tsx';
import { AmendConfigItem } from './AmendModule.tsx';
import { CloseConfigItem } from './CloseModule.tsx';
import { MarginConfigItem } from './MarginModule.tsx';
import { BINANCE_YELLOW } from '../constants/colors.ts';

interface DIYModuleProps {
  config: Partial<AppConfig>;
  logs: LogEntry[];
  onClearLogs: () => void;
  serverTimezone?: string;
  preFillTab?: 'strategies' | 'conditions' | 'backtest' | null;
  onClearPreFillTab?: () => void;
  showToast: (message: string, type: 'success' | 'error') => void;
  isActive?: boolean;
}

export default React.memo(function DIYModule({ config, logs, onClearLogs, serverTimezone: propServerTimezone, preFillTab, onClearPreFillTab, showToast: onShowToast, isActive = true }: DIYModuleProps) {
  const { t } = useTranslation();
  const [activeSubTab, setActiveSubTab] = useState<'strategies' | 'conditions' | 'backtest'>('strategies');

  React.useEffect(() => {
    if (preFillTab) {
      setActiveSubTab(preFillTab);
      onClearPreFillTab?.();
    }
  }, [preFillTab, onClearPreFillTab]);

  const [isConditionModalOpen, setIsConditionModalOpen] = useState(false);
  const [isStrategyModalOpen, setIsStrategyModalOpen] = useState(false);
  const [editingCondition, setEditingCondition] = useState<ConditionTemplate | null>(null);
  const [editingStrategy, setEditingStrategy] = useState<DIYStrategy | null>(null);

  const {
    autoScroll,
    setAutoScroll,
  } = useModuleState(config, logs, () => {}, false, 'diy');

  const {
    handleDuplicate: conditionHandleDuplicate,
    batchMode: conditionBatchMode,
    setBatchMode: setConditionBatchMode,
    selectedIds: conditionSelectedIds,
    toggleSelect: conditionToggleSelect,
    ...conditionManager
  } = useConfigManager<ConditionTemplate>({
    moduleName: 'diy_conditions',
    apiPrefix: '/api/diy/conditions',
    onShowToast: onShowToast,
    pollInterval: 10000,
    toRequestBody: (formData) => ({
      name: formData.name,
      exchange: formData.exchange,
      timeframe: formData.timeframe,
      conditions: formData.conditions,
    })
  });

  const {
    selectedConfigId,
    setSelectedConfigId,
    getFilteredLogs,
    ...strategyRest
  } = useConfigManager<DIYStrategy>({
    moduleName: 'diy_strategies',
    apiPrefix: '/api/diy/strategies',
    onShowToast: onShowToast,
    pollInterval: 10000,
    toRequestBody: (formData) => ({
      name: formData.name,
      conditionTemplateId: formData.conditionTemplateId,
      actions: formData.actions,
      testMode: formData.testMode,
      shortcut_key: formData.shortcut_key || '',
      auto_start: !!formData.auto_start,
      freqtradeSpec: formData.freqtradeSpec,
    })
  });
  const strategyManager = strategyRest;

  React.useEffect(() => {
    const handler = (e: Event) => {
      const { action, configId, moduleKey } = (e as CustomEvent).detail || {};
      if (moduleKey === 'diy') {
        if (action === 'new') {
          setEditingStrategy(null);
          setIsStrategyModalOpen(true);
        } else if (action === 'edit' && configId) {
          const strategy = strategyManager.configs.find(c => c.id === configId);
          if (strategy) {
            setEditingStrategy(strategy);
            setIsStrategyModalOpen(true);
          }
        }
      } else if (moduleKey === 'condition') {
        if (action === 'new') {
          setEditingCondition(null);
          setIsConditionModalOpen(true);
        } else if (action === 'edit' && configId) {
          const template = conditionManager.configs.find(c => c.id === configId);
          if (template) {
            setEditingCondition(template);
            setIsConditionModalOpen(true);
          }
        }
      }
    };
    window.addEventListener('open-config-modal', handler);
    return () => window.removeEventListener('open-config-modal', handler);
  }, [strategyManager.configs, conditionManager.configs]);

  const placeManager = useConfigList<PlaceConfigItem>('place', '/api/trader');
  const cancelManager = useConfigList<CancelConfigItem>('cancel', '/api/cancel');
  const amendManager = useConfigList<AmendConfigItem>('amend', '/api/amend');
  const closeManager = useConfigList<CloseConfigItem>('close', '/api/close');
  const marginManager = useConfigList<MarginConfigItem>('margin', '/api/margin');

  const accountNames = useMemo(() => config.accountNames || {}, [config.accountNames]);
  const accountColors = useMemo(() => config.accountColors || {}, [config.accountColors]);
  const diyAccounts = useMemo(() =>
    (config.accounts || []).map((a: ExchangeAccount, idx: number) => ({ id: a.id, name: a.name, color: (config.accountColors || {})[idx] })),
    [config.accounts, config.accountColors]
  );
  const accountIdToName = useMemo(() => {
    const map: Record<string, string> = {};
    (config.accounts || []).forEach((a: ExchangeAccount) => {
      if (a.id) map[a.id] = a.name;
    });
    return map;
  }, [config.accounts]);
  const accountIdToColor = useMemo(() => {
    const map: Record<string, string> = {};
    (config.accounts || []).forEach((a: ExchangeAccount, idx: number) => {
      if (a.id) map[a.id] = (config.accountColors || {})[idx] || BINANCE_YELLOW;
    });
    return map;
  }, [config.accounts, config.accountColors]);

  const filteredLogs = useMemo(() => getFilteredLogs(logs), [logs, getFilteredLogs]);

  const handleSaveCondition = async (template: ConditionTemplate) => {
    try {
      await conditionManager.handleSave(template, editingCondition?.id || null);
      setIsConditionModalOpen(false);
      setEditingCondition(null);
    } catch (e) {
      console.error('保存条件模板失败:', e);
    }
  };

  const handleSaveStrategy = async (strategy: DIYStrategy) => {
    try {
      await strategyManager.handleSave(strategy, editingStrategy?.id || null);
      setIsStrategyModalOpen(false);
      setEditingStrategy(null);
    } catch (e) {
      console.error('保存策略失败:', e);
    }
  };

  const handleEditCondition = useCallback((template: ConditionTemplate) => {
    const fixedConditions = (template.conditions || []).map(c => ({
      ...c,
      params: c.params?.accountId && diyAccounts.find(a => a.id === c.params.accountId)
        ? c.params
        : { ...c.params, accountId: diyAccounts[0]?.id || '' },
    }));
    setEditingCondition({ ...template, conditions: fixedConditions });
    setIsConditionModalOpen(true);
  }, [diyAccounts]);

  const handleDeleteCondition = useCallback((id: string) => {
    conditionManager.handleDelete(id);
  }, [conditionManager]);

  const handleEditStrategy = useCallback((strategy: DIYStrategy) => {
    setEditingStrategy(strategy);
    setIsStrategyModalOpen(true);
  }, []);

  const handleDeleteStrategy = useCallback((id: string) => {
    strategyManager.handleDelete(id);
  }, [strategyManager]);

  const [btReportPhase, setBtReportPhase] = useState<'idle' | 'detecting' | 'downloading' | 'running' | 'done' | 'error'>('idle');
  const [btResult, setBtResult] = useState<FtBacktestResultDetail | null>(null);
  const [btErrorMsg, setBtErrorMsg] = useState('');
  const [lastBtParams, setLastBtParams] = useState<BacktestRunParams | null>(null);

  const btLiveOnlyCount = useMemo(() => {
    const entry = conditionManager.configs.find(c => c.id === lastBtParams?.entryConditions?.[0]?.id);
    return 0;
  }, [lastBtParams]);

  const getApiBase = async (): Promise<string> => {
    if (window.electronAPI) {
      const port = await window.electronAPI.getBackendPort();
      return `http://localhost:${port}`;
    }
    return '';
  };

  useEffect(() => {
    const loadLast = async () => {
      const sid = localStorage.getItem('bt_lastStrategyId');
      if (!sid) return;
      try {
        const base = await getApiBase();
        if (!base) return;
        const res = await fetch(`${base}/api/freqtrade/backtest/last/${encodeURIComponent(sid)}`);
        const data = await res.json();
        if (data.ok && data.data) {
          setBtResult(data.data as FtBacktestResultDetail);
          setBtReportPhase('done');
        }
      } catch {  }
    };
    loadLast();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBtRun = useCallback(async (params: BacktestRunParams) => {
    setLastBtParams(params);
    setBtResult(null);
    setBtErrorMsg('');

    setBtReportPhase('detecting');
    try {
      const base = await getApiBase();
      const detectRes = await fetch(`${base}/api/freqtrade/detect`);
      const detectData = await detectRes.json();
      if (!detectData.found) {
        setBtReportPhase('error');
        setBtErrorMsg('未检测到 freqtrade，请先安装并配置环境');
        return;
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setBtReportPhase('error');
      setBtErrorMsg(`检测 freqtrade 失败: ${err.message}`);
      return;
    }

    setBtReportPhase('downloading');
    try {
      const dlBase = await getApiBase();
      const dlRes = await fetch(`${dlBase}/api/freqtrade/download-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange: params.exchange,
          pairWhitelist: params.pairs,
          timeframes: [params.resolvedTimeframe],
          fromDate: params.fromDateString,
          toDate: params.toDateString,
          tradingMode: params.spec?.tradingMode ?? 'futures',
        }),
      });
      const dlData = await dlRes.json();
      if (!dlData.ok) {
        setBtReportPhase('error');
        setBtErrorMsg(`K 线数据下载失败: ${dlData.error || '未知错误'}`);
        return;
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setBtReportPhase('error');
      setBtErrorMsg(`K 线数据下载请求失败: ${err.message}`);
      return;
    }

    setBtReportPhase('running');
    try {
      const base = await getApiBase();
      const res = await fetch(`${base}/api/freqtrade/backtest/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange: params.exchange,
          pairWhitelist: params.pairs,
          strategyName: params.ftStrategyName,
          timeframe: params.resolvedTimeframe,
          fromDate: params.fromDateString,
          toDate: params.toDateString,
          stakeAmount: params.stakeAmount,
          maxOpenTrades: params.maxOpenTrades,
          enableProtections: false,
          dryRunWallet: params.dryRunWallet,
          strategySpec: params.spec || undefined,
          timezone: params.timezone,
          tradingDirection: params.direction,
          skipDownload: true,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setBtReportPhase('error');
        setBtErrorMsg(data.error || '回测启动失败');
        return;
      }
      if (data.result) {
        setBtResult(data.result);
        try {
          const sid = params.spec?.id || params.ftStrategyName || '';
          if (sid) {
            await fetch(`${base}/api/freqtrade/backtest/save`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ strategyId: sid, result: data.result }),
            });
            localStorage.setItem('bt_lastStrategyId', sid);
          }
        } catch {  }
      }
      setBtReportPhase('done');
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setBtReportPhase('error');
      setBtErrorMsg(`回测请求失败: ${err.message}`);
    }
  }, []);

  const handleBtRetry = useCallback(() => {
    if (lastBtParams) {
      handleBtRun(lastBtParams);
    }
  }, [lastBtParams, handleBtRun]);

  const handleStartStrategy = useCallback(async (id: string) => {
    strategyManager.handleStart(id);

    const strategy = strategyManager.configs.find((s) => s.id === id);
    console.log('[Freqtrade Live] 启动检查', { id, hasSpec: !!strategy?.freqtradeSpec, strategyKeys: strategy ? Object.keys(strategy) : 'no strategy' });

    let liveSpec: typeof strategy.freqtradeSpec | null = null;
    if (strategy?.conditionTemplateId) {
      const template = conditionManager.configs.find(t => t.id === strategy.conditionTemplateId);
      if (template) {
        const rebuilt = buildSpecFromConditions(
          strategy.id, strategy.name, template.conditions, template.timeframe || '1m'
        );
        liveSpec = rebuilt;
      }
    }

    if (liveSpec) {
      try {
        const placeAction = strategy.actions.find(a => a.type === 'place_order');
        const placeConfig = placeAction?.targetConfigId
          ? placeManager.configs.find(c => c.id === placeAction.targetConfigId)
          : null;
        const instId = (placeConfig as Record<string, unknown>)?.inst_id as string || '';
        const mainPair = instId
          ? okxPairToFtPair(instId)
          : 'BTC/USDT:USDT';
        const specPairs = new Set<string>([mainPair]);
        for (const cond of liveSpec!.entry.children) {
          if (cond.pair) specPairs.add(cond.pair);
        }
        for (const cond of liveSpec!.exit.children) {
          if (cond.pair) specPairs.add(cond.pair);
        }
        const pairWhitelist = Array.from(specPairs);

        const base = await getApiBase();
        const res = await fetch(`${base}/api/freqtrade/live/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            processSpec: {
              id: strategy.id,
              name: strategy.name,
              exchange: (liveSpec as any)._exchange || 'okx',
              pairWhitelist,
              timeframe: liveSpec.timeframe,
              stakeAmount: 100,
              stakeCurrency: 'USDT',
              maxOpenTrades: 3,
              dryRunWallet: 1000,
            },
            strategySpec: liveSpec,
            _conditions: strategy?.conditionTemplateId ? conditionManager.configs.find(t => t.id === strategy.conditionTemplateId)?.conditions : undefined,
            oktsPort: window.electronAPI ? (await window.electronAPI.getBackendPort()) : 3000,
          }),
        });
        const data = await res.json();
        if (!data.ok) {
          console.error('[Freqtrade Live] 启动失败:', data.error);
          onShowToast(t('diy.freqtrade.startFailed', { name: strategy.name, error: data.error }), 'error');
        } else {
          onShowToast(t('diy.freqtrade.startSuccess', { name: strategy.name }), 'success');
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error('[Freqtrade Live] 启动异常:', e);
        onShowToast(t('diy.freqtrade.startError', { name: strategy.name, error: errMsg }), 'error');
      }
    }
  }, [strategyManager, placeManager, onShowToast, t]);

  const handleStopStrategy = useCallback(async (id: string) => {
    strategyManager.handleStop(id);

    try {
      const base = await getApiBase();
      await fetch(`${base}/api/freqtrade/live/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId: id }),
      });
    } catch {
    }
  }, [strategyManager]);

  const strategyModal = isStrategyModalOpen ? (
    <StrategyModal
      isOpen={isStrategyModalOpen}
      onClose={() => {
        setIsStrategyModalOpen(false);
        setEditingStrategy(null);
      }}
      onSave={handleSaveStrategy}
      onSaveAndStart={async (strategy) => {
        await strategyManager.handleSave(strategy, editingStrategy?.id || null);
        setIsStrategyModalOpen(false);
        setEditingStrategy(null);
        if (strategy.id) {
          await strategyManager.handleStart(strategy.id);
          strategyManager.fetchConfigs();
        }
      }}
      initialData={editingStrategy}
      conditionTemplates={conditionManager.configs}
      placeConfigs={placeManager.configs}
      amendConfigs={amendManager.configs}
      cancelConfigs={cancelManager.configs}
      closeConfigs={closeManager.configs}
      preventMarginConfigs={marginManager.configs}
      accountNames={accountNames as unknown as Record<number, string>}
      accountColors={accountColors as unknown as Record<number, string>}
      accounts={diyAccounts}
      defaultEmail={config.default_email}
      allStrategies={strategyManager.configs}
      showToast={onShowToast}
    />
  ) : null;

  const conditionModal = isConditionModalOpen ? (
    <ConditionTemplateModal
      isOpen={isConditionModalOpen}
      onClose={() => {
        setIsConditionModalOpen(false);
        setEditingCondition(null);
      }}
      onSave={handleSaveCondition}
      initialData={editingCondition}
      accountNames={accountNames as unknown as Record<string, string>}
      accountColors={accountColors as unknown as Record<string, string>}
      accounts={diyAccounts}
    />
  ) : null;

  if (!isActive) return createPortal(<>{strategyModal}{conditionModal}</>, document.body);
  return (
    <div className="h-full flex flex-col relative">
      <ConfigHeader
        icon={Bot}
        iconColor="text-brand-blue"
        title={t('nav.diy')}
        subtitle={t('diy.ui.subtitle')}
        actions={
          activeSubTab === 'backtest' ? null : (
            (activeSubTab === 'strategies' ? strategyManager.configs : conditionManager.configs).length > 0 && (
              <Button
                className={(activeSubTab === 'strategies' ? strategyManager.batchMode : conditionBatchMode) ? 'bg-brand-blue/20 text-brand-blue' : ''}
                onClick={() => {
                  if (activeSubTab === 'strategies') {
                    strategyManager.setBatchMode(!strategyManager.batchMode);
                  } else {
                    setConditionBatchMode(!conditionBatchMode);
                  }
                }}
              >
                <ListChecks className="w-3.5 h-3.5" />
                {(activeSubTab === 'strategies' ? strategyManager.batchMode : conditionBatchMode) ? t('batch.exitMode') : t('batch.mode')}
              </Button>
            )
          )
        }
      />

      <div className="flex-1 flex flex-col min-h-0 pt-0">
        <ConfigListLayout
          logPanel={
            activeSubTab === 'backtest'
              ? <BacktestReportArea
                  phase={btReportPhase}
                  result={btResult}
                  liveOnlyCount={0}
                  errorMsg={btErrorMsg}
                  onRetry={handleBtRetry}
                  timerangeFrom={lastBtParams?.fromDateString}
                  timerangeTo={lastBtParams?.toDateString}
                />
              : <LogViewer
                  logs={filteredLogs}
                  title={selectedConfigId ? t('diy.ui.logTitleSelected', { name: strategyManager.configs.find(c => c.id === selectedConfigId)?.name || '' }) : t('diy.ui.logTitle')}
                  icon="cpu"
                  running={strategyManager.hasAnyRunning}
                  autoScroll={autoScroll}
                  onAutoScrollChange={setAutoScroll}
                  onClearLogs={onClearLogs}
                  accountNames={accountNames as unknown as Record<string, string>}
                  accountColors={accountColors as unknown as Record<string, string>}
                  timezone={propServerTimezone}
                />
          }
        >
          <div className="sticky top-0 z-10 flex items-center justify-between py-0 mb-2 bg-surface-0 border-b border-border-subtle">
            <div className="flex items-center gap-1 p-1 bg-surface-3 rounded-xl border border-border-subtle shrink-0 w-fit">
              <button
                onClick={() => setActiveSubTab('strategies')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeSubTab === 'strategies'
                    ? 'bg-brand-blue text-text-primary shadow-lg shadow-brand-blue/20'
                    : 'text-text-tertiary hover:text-text-primary hover:bg-white/5'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                {t('diy.strategiesTab')}
              </button>
              <button
                onClick={() => setActiveSubTab('conditions')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeSubTab === 'conditions'
                    ? 'bg-brand-yellow text-black shadow-lg shadow-brand-yellow/20'
                    : 'text-text-tertiary hover:text-text-primary hover:bg-white/5'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                {t('diy.conditionsTab')}
              </button>
              <button
                onClick={() => setActiveSubTab('backtest')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeSubTab === 'backtest'
                    ? 'bg-trade-green text-black shadow-lg shadow-trade-green/20'
                    : 'text-text-tertiary hover:text-text-primary hover:bg-white/5'
                }`}
              >
                <LineChart className="w-3.5 h-3.5" />
                {t('diy.backtestTab')}
              </button>
            </div>

            {activeSubTab === 'strategies' ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setEditingStrategy(null);
                  setIsStrategyModalOpen(true);
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                {t('diy.addStrategy')}
              </Button>
            ) : activeSubTab === 'conditions' ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setEditingCondition(null);
                  setIsConditionModalOpen(true);
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                {t('diy.createCondition')}
              </Button>
            ) : null}
          </div>

          {activeSubTab === 'strategies' && (
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-0 space-y-3">
              {strategyManager.batchMode && (
                <BatchActionBar
                  selectedCount={strategyManager.selectedIds.size}
                  totalCount={strategyManager.configs.length}
                  onSelectAll={strategyManager.selectAll}
                  onDeselectAll={strategyManager.deselectAll}
                  onBatchStart={strategyManager.handleBatchStart}
                  onBatchStop={strategyManager.handleBatchStop}
                  onExitBatchMode={() => strategyManager.setBatchMode(false)}
                />
              )}
              {strategyManager.configs.length === 0 ? (
                <EmptyConfigs
                  label={t('diy.noStrategies')}
                  onAdd={() => {
                    setEditingStrategy(null);
                    setIsStrategyModalOpen(true);
                  }}
                />
              ) : (
                strategyManager.configs.map(strategy => (
                  <StrategyCard
                    key={strategy.id}
                    strategy={strategy}
                    conditionTemplates={conditionManager.configs}
                    placeConfigs={placeManager.configs}
                    cancelConfigs={cancelManager.configs}
                    amendConfigs={amendManager.configs}
                    closeConfigs={closeManager.configs}
                    marginConfigs={marginManager.configs}
                    accountNames={accountNames as unknown as Record<number, string>}
                    accountColors={accountColors as unknown as Record<number, string>}
                    accounts={diyAccounts}
                    isSelected={selectedConfigId === strategy.id}
                    onClick={() => setSelectedConfigId(selectedConfigId === strategy.id ? null : strategy.id)}
                    onEdit={handleEditStrategy}
                    onDuplicate={() => strategyManager.handleDuplicate(strategy.id)}
                    batchMode={strategyManager.batchMode}
                    isBatchSelected={strategyManager.selectedIds.has(strategy.id)}
                    onToggleSelect={() => strategyManager.toggleSelect(strategy.id)}
                    onPin={strategyManager.handlePin}
                    onDelete={handleDeleteStrategy}
                    onStart={handleStartStrategy}
                    onStop={handleStopStrategy}
                    allStrategies={strategyManager.configs}
                  />
                ))
              )}
            </div>
          )}

          {activeSubTab === 'conditions' && (
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-0 space-y-4">
              {conditionManager.configs.length === 0 ? (
                <EmptyConfigs
                  label={t('diy.noConditions')}
                  onAdd={() => {
                    setEditingCondition(null);
                    setIsConditionModalOpen(true);
                  }}
                />
              ) : (
                conditionManager.configs.map(template => (
                  <ConditionCard
                    key={template.id}
                    template={template}
                    accountNames={accountIdToName}
                    accountColors={accountIdToColor}
                    accounts={diyAccounts}
                    onEdit={handleEditCondition}
                    onDuplicate={() => conditionHandleDuplicate(template.id)}
                    batchMode={conditionBatchMode}
                    isBatchSelected={conditionSelectedIds.has(template.id)}
                    onToggleSelect={() => conditionToggleSelect(template.id)}
                    onPin={conditionManager.handlePin}
                    onDelete={handleDeleteCondition}
                  />
                ))
              )}
            </div>
          )}

          {activeSubTab === 'backtest' && (
            <div className="flex-1 min-h-0">
              <BacktestPanel
                conditionTemplates={conditionManager.configs}
                timezone={propServerTimezone}
                onRunBacktest={handleBtRun}
              />
            </div>
          )}
        </ConfigListLayout>
      </div>

      {strategyModal}
      {conditionModal}
    </div>
  );
});
