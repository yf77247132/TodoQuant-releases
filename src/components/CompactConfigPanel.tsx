
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Plus, ListChecks, PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { AppConfig } from '../types/core.ts';
import type { ConditionTemplate, Order } from '../types/index.ts';
import type { DescSegment } from '../ui/ConfigSummaryRender.tsx';
import type { HistoryPosition } from './dashboard/HistoryPositionTable.tsx';
import type { LogEntry } from '../types/logs.ts';
import { Tooltip } from '../ui/Tooltip.tsx';
import DashedHint from '../ui/DashedHint.tsx';
import { useConfigManager, type BaseConfigItem } from '../hooks/useConfigManager.ts';
import { useConfigList } from '../hooks/useConfigList.ts';
import type { PlaceConfigItem } from './PlaceModule.tsx';
import type { CancelConfigItem } from './CancelModule.tsx';
import type { AmendConfigItem } from './AmendModule.tsx';
import type { CloseConfigItem } from './CloseModule.tsx';
import type { MarginConfigItem } from './MarginModule.tsx';
import ConfigCard from '../ui/ConfigCard.tsx';
import ConfigSummaryRender from '../ui/ConfigSummaryRender.tsx';
import LogViewer from '../ui/LogViewer.tsx';
import { EmptyConfigs } from '../ui/ConfigListLayout.tsx';
import BatchActionBar from '../ui/BatchActionBar.tsx';
import { Spinner } from '../ui/Spinner.tsx';
import { safeStorageGet, safeStorageSet } from '../lib/safeStorage.ts';
import { buildPlaceDescSegments } from './PlaceModule.tsx';
import { buildAmendDescSegments } from './AmendModule.tsx';
import { buildCancelDescSegments } from './CancelModule.tsx';
import { buildCloseDescSegments } from './CloseModule.tsx';
import { buildMarginDescSegments } from './MarginModule.tsx';
import StrategyCard from './diy/StrategyCard.tsx';
import ConditionCard from './diy/ConditionCard.tsx';
import QuickTradePanel from './QuickTradePanel.tsx';

const MODULE_TABS = [
  { key: 'place', i18nKey: 'nav.place', i18nKeyShort: 'nav.shortPlace', moduleName: 'place', apiPrefix: '/api/trader' },
  { key: 'trade', i18nKey: 'nav.trade', i18nKeyShort: 'nav.shortTrade', moduleName: '', apiPrefix: '' },
  { key: 'amend', i18nKey: 'nav.amend', i18nKeyShort: 'nav.shortAmend', moduleName: 'amend', apiPrefix: '/api/amend' },
  { key: 'cancel', i18nKey: 'nav.cancel', i18nKeyShort: 'nav.shortCancel', moduleName: 'cancel', apiPrefix: '/api/cancel' },
  { key: 'close', i18nKey: 'nav.close', i18nKeyShort: 'nav.shortClose', moduleName: 'close', apiPrefix: '/api/close' },
  { key: 'margin', i18nKey: 'nav.margin', i18nKeyShort: 'nav.shortMargin', moduleName: 'margin', apiPrefix: '/api/margin' },
  { key: 'diy', i18nKey: 'nav.diy', i18nKeyShort: 'nav.shortDiy', moduleName: 'diy_strategies', apiPrefix: '/api/diy/strategies' },
  { key: 'condition', i18nKey: 'nav.condition', i18nKeyShort: 'nav.shortCondition', moduleName: 'diy_conditions', apiPrefix: '/api/diy/conditions' },
  { key: 'stats', i18nKey: 'stats.todayStats', i18nKeyShort: 'stats.todayStats', moduleName: '', apiPrefix: '' },
] as const;

type TabKey = (typeof MODULE_TABS)[number]['key'];

const VALID_TAB_KEYS = new Set<string>(MODULE_TABS.map(t => t.key));

export interface CompactConfigPanelProps {
  config: Partial<AppConfig>;
  accountNames: Record<string, string>;
  accountColors: Record<string, string>;
  showToast: (message: string, type: 'success' | 'error') => void;
  onNavigateToModule: (moduleKey: string, configId?: string, action?: 'edit' | 'new') => void;
  logs: Record<string, LogEntry[]>;
  onClearLogs: (moduleKey: string) => void;
  historyPositions?: HistoryPosition[];
  historyOrders?: Order[];
  ordList?: Order[];
}

function getAccountColor(
  cfg: Record<string, unknown>,
  accountColors: Record<string, string>,
  accounts: { id: string; color?: string }[],
): string | undefined {
  const accountId = String(cfg.account_id || '').trim();
  if (!accountId) return undefined;
  const acc = accounts.find(a => a.id === accountId);
  if (acc?.color) return acc.color;
  return accountColors[accountId];
}

function toIndexNameMap(accounts: { id: string; name: string; color?: string }[], accountNames: Record<string, string>): Record<number, string> {
  const map: Record<number, string> = {};
  for (const [i, acc] of accounts.entries()) {
    map[i] = accountNames[acc.id] || acc.name || `#${acc.id}`;
  }
  return map;
}

function buildDiyDesc(
  cfg: Record<string, unknown>,
  t: (key: string) => string,
): DescSegment[] {
  const segments: DescSegment[] = [];
  const actions = cfg.actions as Array<{ type: string; target_config_id?: string }> | undefined;
  const conditionTemplateId = cfg.conditionTemplateId as string | undefined;

  const ACTION_LABELS: Record<string, string> = {
    place_order: 'strategy.actionPlace',
    amend_order: 'strategy.actionAmend',
    cancel_order: 'strategy.actionCancel',
    close_pos: 'strategy.actionClose',
    prevent_margin_risk: 'strategy.actionTransfer',
    notify: 'strategy.actionNotify',
    stop_strategy: 'strategy.actionStop',
  };

  if (conditionTemplateId) {
    const shortId = conditionTemplateId.length > 16
      ? conditionTemplateId.slice(0, 16) + '...'
      : conditionTemplateId;
    segments.push({ label: t('strategy.condition'), value: `#${shortId}` });
  } else {
    segments.push({ label: t('strategy.condition'), value: t('strategy.unknown') });
  }

  segments.push({ label: t('strategy.liveTrading'), value: t('strategy.on'), style: 'gray-off' });

  if (actions && actions.length > 0) {
    const labels = actions.map(a => t(ACTION_LABELS[a.type] || 'strategy.actionDefault'));
    segments.push({ label: t('strategy.actionDefault'), value: labels.join(' + ') });
  } else {
    segments.push({ label: t('strategy.actionDefault'), value: '0' });
  }

  return segments;
}

function buildConditionDesc(
  cfg: Record<string, unknown>,
  t: (key: string) => string,
): DescSegment[] {
  const segments: DescSegment[] = [];
  const conditions = cfg.conditions as Array<{ type: string }> | undefined;
  
  segments.push({ label: t('strategy.condition'), value: conditions?.length ? String(conditions.length) : '0' });
  
  return segments;
}

function buildDescSegments(
  tabKey: TabKey,
  cfg: Record<string, unknown>,
  accountNames: Record<string, string>,
  accountColors: Record<string, string>,
  accounts: { id: string; name: string; color?: string }[],
  t: (key: string) => string,
): DescSegment[] {
  const idxNames = toIndexNameMap(accounts, accountNames);
  const idxColors: Record<number, string> = {};
  for (const [i, acc] of accounts.entries()) {
    if (acc.color) idxColors[i] = acc.color;
    else if (accountColors[acc.id]) idxColors[i] = accountColors[acc.id];
  }
  switch (tabKey) {
    case 'place': return buildPlaceDescSegments(cfg as any, idxNames, idxColors, accounts, t);
    case 'trade': return [];
    case 'amend': return buildAmendDescSegments(cfg as any, idxNames, idxColors, accounts, t);
    case 'cancel': return buildCancelDescSegments(cfg as any, idxNames, idxColors, accounts, t);
    case 'close': return buildCloseDescSegments(cfg as any, idxNames, idxColors, accounts, t);
    case 'margin': return buildMarginDescSegments(cfg as any, idxNames, idxColors, accounts, t);
    case 'diy': return buildDiyDesc(cfg, t);
    case 'condition': return buildConditionDesc(cfg, t);
    case 'stats': return [];
  }
}

function getTestMode(tabKey: TabKey, cfg: Record<string, unknown>): boolean {
  if (tabKey === 'place' || tabKey === 'trade') {
    const val = cfg.place_test_mode;
    return val !== undefined ? Boolean(val) : true;
  }
  if (tabKey === 'diy') {
    return false;
  }
  const val = cfg.test_mode;
  return val !== undefined ? Boolean(val) : true;
}

function getShortcutKey(cfg: Record<string, unknown>): string | undefined {
  const val = cfg.shortcut_key;
  return val ? String(val) : undefined;
}

const TAB_LOG_ICON: Record<TabKey, 'file-plus' | 'edit' | 'trash' | 'x-circle' | 'transfer' | 'cpu'> = {
  place: 'file-plus',
  trade: 'file-plus',
  amend: 'edit',
  cancel: 'trash',
  close: 'x-circle',
  margin: 'transfer',
  condition: 'cpu',
  diy: 'cpu',
  stats: 'cpu',
};

interface TodayStatsData {
  todayProfit: number;
  todayAvgProfit: number;
  todayOpened: number;
  todayClosed: number;
  todayOrders: number;
  todayFilled: number;
}

function todayStartMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isToday(ts: string | number | undefined | null, t0: number): boolean {
  if (ts == null || ts === '') return false;
  const v = parseInt(String(ts), 10);
  return !isNaN(v) && v >= t0;
}

function orderTimeMs(o: Order): string | undefined {
  return o.cTime || o.orderTime;
}

function computeTodayStats(
  historyPositions: HistoryPosition[] | undefined,
  historyOrders: Order[] | undefined,
  ordList: Order[] | undefined,
): TodayStatsData {
  const t0 = todayStartMs();
  const positions = historyPositions ?? [];
  const hOrders = historyOrders ?? [];
  const currentOrders = ordList ?? [];

  let todayProfit = 0;
  let closedCount = 0;
  for (const p of positions) {
    if (isToday(p.uTime, t0)) {
      todayProfit += parseFloat(p.realizedPnl || '0') || 0;
      closedCount += 1;
    }
  }
  const todayClosed = closedCount;
  const todayOpened = positions.filter(p => isToday(p.cTime, t0)).length;
  const todayAvgProfit = closedCount > 0 ? todayProfit / closedCount : 0;

  const countToday = (arr: Order[]) => arr.filter(o => isToday(orderTimeMs(o), t0)).length;
  const todayOrders = countToday(currentOrders) + countToday(hOrders);
  const todayFilled = hOrders.filter(o => isToday(orderTimeMs(o), t0) && o.state === 'filled').length;

  return { todayProfit, todayAvgProfit, todayOpened, todayClosed, todayOrders, todayFilled };
}

function TodayStats({ stats }: { stats: TodayStatsData }) {
  const { t } = useTranslation();
  const fmtMoney = (n: number) => n.toFixed(2);
  const profitColor = stats.todayProfit >= 0 ? 'text-trade-green' : 'text-trade-red';
  const avgColor = stats.todayAvgProfit >= 0 ? 'text-trade-green' : 'text-trade-red';

  const cards = [
    { label: t('stats.todayProfit'), value: fmtMoney(stats.todayProfit), color: profitColor, tip: t('stats.todayProfitTip') },
    { label: t('stats.todayAvgProfit'), value: fmtMoney(stats.todayAvgProfit), color: avgColor, tip: t('stats.todayAvgProfitTip') },
    { label: t('stats.todayOpened'), value: String(stats.todayOpened), color: 'text-text-primary', tip: t('stats.todayOpenedTip') },
    { label: t('stats.todayClosed'), value: String(stats.todayClosed), color: 'text-text-primary', tip: t('stats.todayClosedTip') },
    { label: t('stats.todayOrders'), value: String(stats.todayOrders), color: 'text-text-primary', tip: t('stats.todayOrdersTip') },
    { label: t('stats.todayFilled'), value: String(stats.todayFilled), color: 'text-text-primary', tip: t('stats.todayFilledTip') },
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2">
      <div className="grid grid-cols-2 gap-2">
        {cards.map((card, idx) => (
          <div key={idx} className="bg-surface-2 border border-border-subtle rounded px-3 py-2">
            <div className="text-xs text-text-tertiary mb-0.5">
              {card.tip ? (
                <Tooltip content={card.tip}>
                  <DashedHint className="cursor-help">{card.label}</DashedHint>
                </Tooltip>
              ) : card.label}
            </div>
            <div className={`text-lg font-semibold ${card.color}`}>{card.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CompactConfigPanel({
  config,
  accountNames,
  accountColors,
  showToast,
  onNavigateToModule,
  logs,
  onClearLogs,
  historyPositions,
  historyOrders,
  ordList,
}: CompactConfigPanelProps) {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const saved = safeStorageGet<string>('compact-config-active-tab', 'place');
    return VALID_TAB_KEYS.has(saved) ? (saved as TabKey) : 'place';
  });

  const [logVisible, setLogVisible] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [autoOpenLog, setAutoOpenLog] = useState(config.autoOpenLog ?? false);
  const autoOpenLogRef = useRef(autoOpenLog);
  useEffect(() => { autoOpenLogRef.current = autoOpenLog; }, [autoOpenLog]);

  useEffect(() => {
    if (config.autoOpenLog !== undefined) {
      setAutoOpenLog(config.autoOpenLog);
    }
  }, [config.autoOpenLog]);

  useEffect(() => {
    const VALID_DRAWER_KEYS = new Set<TabKey>(['place', 'close', 'margin']);
    const handler = (e: Event) => {
      if (!autoOpenLogRef.current) return;
      const detail = (e as CustomEvent).detail;
      const rawKey = detail?.moduleKey as string | undefined;
      const shouldOpen = (rawKey && VALID_DRAWER_KEYS.has(rawKey as TabKey)) || detail?.force;
      if (shouldOpen) {
        if (rawKey && VALID_TAB_KEYS.has(rawKey)) setActiveTab(rawKey as TabKey);
        setLogVisible(true);
      }
    };
    window.addEventListener('open-log-drawer', handler);
    return () => window.removeEventListener('open-log-drawer', handler);
  }, []);

  const handleAutoOpenLogChange = useCallback((checked: boolean) => {
    setAutoOpenLog(checked);
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoOpenLog: checked })
    }).catch(() => {});
  }, []);

  const handleTabChange = useCallback((key: TabKey) => {
    setActiveTab(key);
    safeStorageSet('compact-config-active-tab', key);
    setLogVisible(false);
  }, []);

  const currentTab = MODULE_TABS.find(tab => tab.key === activeTab)!;

  const accounts = useMemo(() => config.accounts ?? [], [config.accounts]);

  const {
    configs,
    runningMap,
    handleStart,
    handleStop,
    handleDelete,
    handleDuplicate,
    handlePin,
    batchMode,
    setBatchMode,
    selectedIds,
    toggleSelect,
    selectAll,
    deselectAll,
    handleBatchStart,
    handleBatchStop,
    isLoading,
  } = useConfigManager<BaseConfigItem>({
    moduleName: currentTab.moduleName,
    apiPrefix: currentTab.apiPrefix,
    toRequestBody: () => ({}),
    onShowToast: showToast,
    onStartSuccess: () => {
      window.dispatchEvent(new CustomEvent('open-log-drawer', { detail: { moduleKey: currentTab.key } }));
    },
  });

  const placeConfigs = useConfigList<PlaceConfigItem>('place', '/api/trader');
  const cancelConfigs = useConfigList<CancelConfigItem>('cancel', '/api/cancel');
  const amendConfigs = useConfigList<AmendConfigItem>('amend', '/api/amend');
  const closeConfigs = useConfigList<CloseConfigItem>('close', '/api/close');
  const marginConfigs = useConfigList<MarginConfigItem>('margin', '/api/margin');
  const conditionManager = useConfigList<ConditionTemplate>('diy_conditions', '/api/diy/conditions');

  const indexAccountNames = useMemo(() => config.accountNames || {}, [config.accountNames]);
  const indexAccountColors = useMemo(() => config.accountColors || {}, [config.accountColors]);
  const diyAccounts = useMemo(() =>
    (config.accounts || []).map((a, idx: number) => ({ id: a.id, name: a.name, color: (config.accountColors || {})[idx] })),
    [config.accounts, config.accountColors]
  );

  const handleEdit = useCallback((configId: string) => {
    window.dispatchEvent(new CustomEvent('open-config-modal', {
      detail: { action: 'edit', configId, moduleKey: activeTab }
    }));
  }, [activeTab]);

  const handleNewInPlace = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-config-modal', {
      detail: { action: 'new', moduleKey: activeTab }
    }));
  }, [activeTab]);

  const handleStartAutoOpen = useCallback(async (configId: string) => {
    const success = await handleStart(configId);
    if (success && autoOpenLog) {
      setLogVisible(true);
      setAutoScroll(true);
    }
  }, [handleStart, autoOpenLog]);

  const currentLogs = useMemo(() => logs[activeTab] ?? [], [logs, activeTab]);

  const isModuleRunning = useMemo(() => Object.values(runningMap).some(Boolean), [runningMap]);

  const stats = useMemo(() => computeTodayStats(historyPositions, historyOrders, ordList),
    [historyPositions, historyOrders, ordList]);

  return (
    <div className="relative flex h-full w-full">
      <div className={`flex flex-col h-full w-full bg-surface-2 rounded-2xl border border-border-default`}>
        <div className="flex border-b border-border-subtle shrink-0 overflow-x-auto">
          {MODULE_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key as TabKey)}
              className={`
                px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors
                ${activeTab === tab.key
                  ? 'text-brand-yellow border-b-2 border-brand-yellow'
                  : 'text-text-tertiary hover:text-text-secondary border-b-2 border-transparent'
                }
              `}
            >
              {t(tab.i18nKeyShort)}
            </button>
          ))}
        </div>

        {activeTab !== 'trade' && activeTab !== 'condition' && activeTab !== 'stats' && (
        <div className="flex items-center justify-between px-3 py-2 shrink-0 border-b border-border-subtle">
          <button
            onClick={handleNewInPlace}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-secondary hover:text-brand-yellow hover:bg-surface-4 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('common.new')}
          </button>
          <div className="flex items-center gap-2">
            {!logVisible && (
              <button
                onClick={() => { setLogVisible(true); setAutoScroll(true); }}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-tertiary hover:text-brand-yellow hover:bg-surface-4 transition-colors"
                title={`${t(currentTab.i18nKey)} - ${t('common.logs')}`}
              >
                <PanelRightOpen className="w-3.5 h-3.5" />
                {t('common.logs')}
              </button>
            )}
            <button
              onClick={() => setBatchMode(!batchMode)}
              className={`
                flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors
                ${batchMode
                  ? 'text-brand-yellow bg-brand-yellow/10'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-4'
                }
              `}
            >
              <ListChecks className="w-3.5 h-3.5" />
              {t('batch.mode')}
            </button>
          </div>
        </div>
        )}
        
        {activeTab === 'condition' && (
        <div className="flex items-center justify-between px-3 py-2 shrink-0 border-b border-border-subtle">
          <button
            onClick={handleNewInPlace}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-secondary hover:text-brand-yellow hover:bg-surface-4 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('common.new')}
          </button>
        </div>
        )}

        {activeTab === 'trade' ? (
          <QuickTradePanel
            accounts={accounts.map(a => ({ id: a.id, name: a.name, color: a.color, exchange: a.exchange }))}
            accountNames={accountNames}
            showToast={showToast}
          />
        ) : activeTab === 'stats' ? (
          <TodayStats stats={stats} />
        ) : (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-text-tertiary">
              <Spinner size="md" className="mb-2 text-brand-yellow" />
              <span className="text-xs">{t('common.loading')}</span>
            </div>
          )}

          {!isLoading && batchMode && (
            <BatchActionBar
              selectedCount={selectedIds.size}
              totalCount={configs.length}
              onSelectAll={selectAll}
              onDeselectAll={deselectAll}
              onBatchStart={handleBatchStart}
              onBatchStop={handleBatchStop}
              onExitBatchMode={() => setBatchMode(false)}
            />
          )}

          {!isLoading && configs.length > 0 && (
            <div className="space-y-2">
              {configs.map(cfg => {
                const rawCfg = cfg as Record<string, unknown>;
                const accountColor = getAccountColor(rawCfg, accountColors, accounts);
                const segments = buildDescSegments(
                  activeTab,
                  rawCfg,
                  accountNames,
                  accountColors,
                  accounts,
                  t,
                );

                if (activeTab === 'diy') {
                  const strategy = rawCfg as any;
                  return (
                    <StrategyCard
                      key={cfg.id}
                      strategy={strategy}
                      conditionTemplates={conditionManager.configs}
                      placeConfigs={placeConfigs.configs}
                      cancelConfigs={cancelConfigs.configs}
                      amendConfigs={amendConfigs.configs}
                      closeConfigs={closeConfigs.configs}
                      marginConfigs={marginConfigs.configs}
                      accountNames={indexAccountNames as unknown as Record<number, string>}
                      accountColors={indexAccountColors as unknown as Record<number, string>}
                      accounts={diyAccounts}
                      isSelected={false}
                      onEdit={() => handleEdit(cfg.id)}
                      onDuplicate={() => handleDuplicate(cfg.id)}
                      onPin={handlePin}
                      onDelete={() => handleDelete(cfg.id)}
                      onStart={() => handleStartAutoOpen(cfg.id)}
                      onStop={() => handleStop(cfg.id)}
                      allStrategies={configs as any}
                      batchMode={batchMode}
                      isBatchSelected={selectedIds.has(cfg.id)}
                      onToggleSelect={() => toggleSelect(cfg.id)}
                    />
                  );
                }

                if (activeTab === 'condition') {
                  const template = rawCfg as any;
                  return (
                    <ConditionCard
                      key={cfg.id}
                      template={template}
                      accountNames={accountNames}
                      accountColors={accountColors}
                      accounts={diyAccounts}
                      onEdit={() => handleEdit(cfg.id)}
                      onDuplicate={() => handleDuplicate(cfg.id)}
                      onPin={handlePin}
                      onDelete={() => handleDelete(cfg.id)}
                      batchMode={false}
                      isBatchSelected={false}
                      onToggleSelect={() => {}}
                    />
                  );
                }

                return (
                  <ConfigCard
                    key={cfg.id}
                    name={cfg.name || '未命名'}
                    isRunning={runningMap[cfg.id] || false}
                    testMode={getTestMode(activeTab, rawCfg)}
                    shortcutKey={getShortcutKey(rawCfg)}
                    instId={rawCfg.inst_id as string | undefined}
                    onEdit={() => handleEdit(cfg.id)}
                    onDelete={() => handleDelete(cfg.id)}
                    onStart={() => handleStartAutoOpen(cfg.id)}
                    onStop={() => handleStop(cfg.id)}
                    onDuplicate={() => handleDuplicate(cfg.id)}
                    onPin={() => handlePin(cfg.id)}
                    batchMode={batchMode}
                    isBatchSelected={selectedIds.has(cfg.id)}
                    onToggleSelect={() => toggleSelect(cfg.id)}
                  >
                    <ConfigSummaryRender
                      segments={segments}
                      accountColor={accountColor}
                    />
                  </ConfigCard>
                );
              })}
            </div>
          )}

          {!isLoading && configs.length === 0 && (
            <EmptyConfigs
              label={t(currentTab.i18nKey)}
              onAdd={handleNewInPlace}
            />
          )}
        </div>
        )}
      </div>

      {logVisible && createPortal(
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setLogVisible(false)}
          />
          <div className="fixed right-0 top-0 bottom-0 w-[480px] max-w-[90vw] bg-surface-2 border-l border-border-default shadow-2xl z-[var(--z-modal)] flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default shrink-0">
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer hover:text-text-primary">
                <input
                  type="checkbox"
                  checked={autoOpenLog}
                  onChange={(e) => handleAutoOpenLogChange(e.target.checked)}
                  className="rounded border-border-default bg-white/5 text-brand-yellow focus:ring-focus-ring cursor-pointer"
                />
                {t('common.autoOpenLog')}
              </label>
              <button
                onClick={() => setLogVisible(false)}
                className="p-1 rounded hover:bg-surface-4 text-text-tertiary hover:text-text-primary transition-colors"
                title={t('common.close')}
              >
                <PanelRightClose className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <LogViewer
                logs={currentLogs}
                title={`${t(currentTab.i18nKey)} - ${t('common.logs')}`}
                icon={TAB_LOG_ICON[activeTab]}
                running={isModuleRunning}
                autoScroll={autoScroll}
                onAutoScrollChange={setAutoScroll}
                onClearLogs={() => onClearLogs(activeTab)}
                height="h-full"
                accountNames={accountNames}
                accountColors={accountColors}
              />
            </div>
          </div>
        </>
        , document.body
      )}
    </div>
  );
}
