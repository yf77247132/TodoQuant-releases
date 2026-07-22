import DashedHint from '../ui/DashedHint'
import { Spinner } from '../ui/Spinner'
import React, { useState, useMemo, memo, useEffect, useCallback, useRef } from 'react';
import { Trash2, ListChecks } from 'lucide-react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import Switch from '../ui/Switch.tsx';
import AccountSelect from '../ui/AccountSelect.tsx';
import InstrumentInput from '../ui/InstrumentInput.tsx';
import Select from '../ui/Select.tsx';
import LogViewer from '../ui/LogViewer.tsx';
import { Tooltip } from '../ui/Tooltip.tsx';
import { LABEL_BASE } from '../ui/inputStyles.ts';
import ConfigCard from '../ui/ConfigCard.tsx';
import ConfigListLayout, { EmptyConfigs } from '../ui/ConfigListLayout.tsx';
import ConfigModal from '../ui/ConfigModal.tsx';
import ConfigHeader from '../ui/ConfigHeader.tsx';
import ConfigSummaryRender, { DescSegment } from '../ui/ConfigSummaryRender.tsx';
import BatchActionBar from '../ui/BatchActionBar.tsx';
import Button from '../ui/Button.tsx';
import { useConfigManager } from '../hooks/useConfigManager.ts';
import { useConfigModalForm } from '../hooks/useConfigModalForm.ts';
import { useShortcutKeyConflict } from '../hooks/useShortcutKeyConflict.ts';
import { createModuleSaveHandlers } from '../lib/moduleSaveHandlers.ts';
import type { LogEntry } from '../types/logs.ts';
import type { ModuleConfig } from '../types/strategy.ts';
import type { AppConfig } from '../types/index.ts';
import {
  CANCEL_ORDER_TYPE_OPTIONS,
  CANCEL_ORDER_TYPE_VALUES,
  getOrderTypeLabel,
  normalizeOrderType,
} from '../constants/orderTypes';
import { getAccountNameFromConfig } from '../lib/resolveAccount.ts';
import ShortcutKeyInput from '../ui/ShortcutKeyInput.tsx';

export interface CancelConfigItem extends ModuleConfig {
  id: string;
  name: string;
  inst_id: string;
  account_id: string;
  order_types: string[];
  side: string;
  test_mode: boolean;
}

interface CancelModuleProps {
  config: Partial<AppConfig>;
  logs: LogEntry[];
  onClearLogs: () => void;
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  preFill?: { accountId: string; _account: number; instId: string; orderType: string } | null;
  onClearPreFill?: () => void;
  onCancelBack?: () => void;
  showToast: (message: string, type: 'success' | 'error') => void;
  serverTimezone?: string;
  isActive?: boolean;
}

export function buildCancelDescSegments(
  cfg: CancelConfigItem,
  accountNames: Record<number, string>,
  _accountColors: Record<number, string>,
  accounts: Array<{ id: string; name: string }> = [],
  t: (key: string) => string = i18next.t.bind(i18next)
): DescSegment[] {
  const typeLabels = (cfg.order_types || [])
    .map(v => t(getOrderTypeLabel(v)))
    .filter(Boolean);
  const isAllTypes = (cfg.order_types || []).length >= CANCEL_ORDER_TYPE_OPTIONS.length;
  const accountName = getAccountNameFromConfig(cfg, accountNames, accounts, t);
  const instLabel = cfg.inst_id || t('cancel.desc.all');

  const segs: DescSegment[] = [
    { label: t('cancel.desc.account'), value: accountName },
    { label: t('cancel.desc.instId'), value: instLabel, style: 'value' },
    {
      label: t('cancel.desc.orderType'),
      value: isAllTypes ? t('cancel.desc.allTypes') : typeLabels.join(', '),
      style: 'value',
    },
    { label: t('cancel.desc.testMode'), value: !cfg.test_mode ? t('cancel.value.on') : t('cancel.value.off'), style: !cfg.test_mode ? 'yellow-on' : 'gray-off' },
  ];

  segs.splice(2, 0, {
    label: t('cancel.desc.side'),
    value: cfg.side === 'buy' ? t('cancel.value.sideBuy') : cfg.side === 'sell' ? t('cancel.value.sideSell') : t('cancel.option.sideAll'),
    style: cfg.side === 'buy' ? 'green' : cfg.side === 'sell' ? 'red' : 'value',
  });

  return segs;
}

export function buildCancelDescText(segments: DescSegment[]): string {
  return segments.map(s => `${s.label}: ${s.value}`).join(', ');
}

const ConfigDescription = memo(({ cfg, accountNames, accountColors, accounts, t }: {
  cfg: CancelConfigItem;
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  accounts: Array<{ id: string; name: string }>;
  t: (key: string) => string;
}) => {
  const accountId = cfg.account_id || '';
  const accIdx = accounts.findIndex(a => a.id === accountId);
  const accountColor = accIdx >= 0 ? accountColors[accIdx] : undefined;
  const segments = buildCancelDescSegments(cfg, accountNames, accountColors, accounts, t);

  return (
    <ConfigSummaryRender 
      segments={segments} 
      accountColor={accountColor} 
    />
  );
});

ConfigDescription.displayName = 'ConfigDescription';

const CancelPreviewPanel = memo(({ orders, t }: {
  orders: Array<{ instId: string; side: string; ordType: string }>;
  t: (key: string) => string;
}) => {
  if (!orders.length) {
    return (
      <div className="text-3xs text-text-muted text-center py-4">
        {t('cancel.preview.noData')}
      </div>
    );
  }

  const sideMap: Record<string, string> = { buy: t('cancel.option.sideBuy'), sell: t('cancel.option.sideSell') };

  return (
    <div className="space-y-2">
      <div className="text-3xs font-bold text-text-tertiary uppercase tracking-wider">
        {t('cancel.preview.title')}
      </div>
      <div>
        <table className="w-full text-2xs border-collapse">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="py-1 px-1 text-left text-text-tertiary font-medium w-5">#</th>
              <th className="py-1 px-1 text-left text-text-tertiary font-medium">{t('cancel.preview.instIdShort')}</th>
              <th className="py-1 px-1 text-center text-text-tertiary font-medium">{t('cancel.preview.sideShort')}</th>
              <th className="py-1 px-1 text-center text-text-tertiary font-medium">{t('cancel.preview.ordTypeShort')}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, idx) => (
              <tr key={idx} className={`${idx % 2 === 0 ? 'bg-surface-1' : ''} hover:bg-surface-3`}>
                <td className="py-1 px-1 text-text-tertiary font-medium">{idx + 1}</td>
                <td className="py-1 px-1 text-text-primary whitespace-nowrap">{o.instId}</td>
                <td className={`py-1 px-1 text-center ${o.side === 'buy' ? 'text-trade-green' : o.side === 'sell' ? 'text-trade-red' : 'text-text-secondary'}`}>
                  {sideMap[o.side] || o.side || '-'}
                </td>
                <td className="py-1 px-1 text-center text-text-secondary">{t(getOrderTypeLabel(o.ordType)) || o.ordType || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
CancelPreviewPanel.displayName = 'CancelPreviewPanel';

export default React.memo(function CancelModule({
  config,
  logs,
  onClearLogs,
  accountNames,
  accountColors,
  preFill,
  onClearPreFill,
  onCancelBack,
  showToast: onShowToast,
  serverTimezone,
  isActive = true,
}: CancelModuleProps) {
  const { t } = useTranslation();
  const accounts = useMemo(() => (config.accounts || []) as Array<{ id: string; name: string }>, [config.accounts]);
  const accountList = useMemo(() =>
    accounts.map((a, idx) => ({ id: a.id, name: a.name, color: accountColors[idx] })),
    [accounts, accountColors]
  );

  type CancelFormState = {
    name: string;
    inst_id: string;
    account_id: string;
    order_types: string[];
    side: string;
    test_mode: boolean;
    shortcut_key: string;
  };

  const {
    configs,
    runningMap,
    hasAnyRunning,
    selectedConfigId,
    setSelectedConfigId,
    getFilteredLogs,
    handleSave,
    handleDelete,
    handleDuplicate,
    batchMode,
    setBatchMode,
    selectedIds,
    toggleSelect,
    selectAll,
    deselectAll,
    handleBatchStart,
    handleBatchStop,
    handlePin,
    handleStart,
    handleStop,
    isLoading,
    fetchConfigs,
  } = useConfigManager<CancelConfigItem>({
    moduleName: 'cancel',
    apiPrefix: '/api/cancel',
    onShowToast: onShowToast,
    onStartSuccess: () => {
      window.dispatchEvent(new CustomEvent('open-log-drawer', { detail: { moduleKey: 'cancel' } }));
    },
    toRequestBody: (form) => ({
      name: form.name ?? '',
      inst_id: form.inst_id ?? '',
      account_id: form.account_id ?? '',
      order_types: form.order_types ?? [],
      side: form.side ?? '',
      test_mode: form.test_mode ?? true,
      shortcut_key: form.shortcut_key ?? '',
    }),
  });

  const {
    form,
    setForm,
    editingId,
    setEditingId,
    showModal,
    setShowModal,
    statusMsg,
    setStatusMsg,
    openNew: originalOpenNew,
    closeModal: originalCloseModal,
  } = useConfigModalForm<CancelFormState>({
    createEmptyForm: () => ({
      name: '',
      inst_id: '',
      account_id: '',
      order_types: [...CANCEL_ORDER_TYPE_VALUES],
      side: '',
      test_mode: true,
      shortcut_key: '',
    }),
    onAfterClear: onClearPreFill,
  });

  const openNew = () => {
    onClearPreFill?.();
    originalOpenNew();
  };

  const closeModal = () => {
    setIsPrefillMode(false);
    onClearPreFill?.();
    originalCloseModal();
  };

  const cancelBack = () => {
    closeModal();
    onCancelBack?.();
  };

  const [autoScroll, setAutoScroll] = useState(true);

  const { conflictMsg: shortcutKeyConflictMsg, checkConflict: checkShortcutKeyConflict, clearConflict: clearShortcutKeyConflict } = useShortcutKeyConflict(t);

  useEffect(() => {
    if (showModal) {
      if (form.shortcut_key) {
        checkShortcutKeyConflict(form.shortcut_key, editingId || undefined);
      } else {
        clearShortcutKeyConflict();
      }
    }
  }, [showModal]);

  const [previewOrders, setPreviewOrders] = useState<Array<{ instId: string; side: string; ordType: string }>>([]);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPreviewCancel = useCallback(() => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/preview-cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: form.account_id,
            instId: form.inst_id || '',
            orderTypes: form.order_types,
            side: form.side,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          setPreviewOrders(data.orders || []);
        }
      } catch {
      }
    }, 300);
  }, [form.account_id, form.inst_id, form.order_types, form.side]);

  useEffect(() => {
    if (showModal) fetchPreviewCancel();
  }, [showModal, fetchPreviewCancel]);

  useEffect(() => {
    if (!showModal) setPreviewOrders([]);
  }, [showModal]);

  useEffect(() => {
    if (showModal && !editingId && !form.account_id && accounts.length > 0) {
      setForm(prev => ({ ...prev, account_id: accounts[0].id }));
    }
  }, [showModal, editingId, form.account_id, accounts, setForm]);

  const [isPrefillMode, setIsPrefillMode] = useState(false);

  const isRunMode = !!preFill || !!isPrefillMode;

  const applyPreFill = useCallback((pf: { accountId: string; _account: number; instId: string; orderType: string }) => {
    const mappedType = normalizeOrderType(pf.orderType);
    const nextOrderTypes = mappedType && CANCEL_ORDER_TYPE_VALUES.includes(mappedType)
      ? [mappedType]
      : [...CANCEL_ORDER_TYPE_VALUES];

    setForm({
      account_id: pf.accountId || accounts[pf._account]?.id || accounts[0]?.id || '',
      inst_id: pf.instId,
      order_types: nextOrderTypes,
      side: '',
      name: t('cancel.ui.runNamePrefix', { instId: pf.instId || t('cancel.desc.all') }),
      test_mode: false,
      shortcut_key: '',
    });
    setEditingId(null);
    setStatusMsg('');
    setIsPrefillMode(true);
    setShowModal(true);
  }, [accounts, setForm, setShowModal, setStatusMsg, t]);

  useEffect(() => {
    if (preFill && !showModal) {
      applyPreFill(preFill);
    }
  }, [preFill, showModal, applyPreFill]);

  const filteredLogs = useMemo(() => getFilteredLogs(logs), [logs, getFilteredLogs]);

  const openEdit = (cfg: CancelConfigItem) => {
    onClearPreFill?.();
    setEditingId(cfg.id);
    setForm({
      name: cfg.name,
      inst_id: cfg.inst_id || '',
      account_id: (cfg.account_id && accounts.find(a => a.id === cfg.account_id)) ? cfg.account_id : (accounts[0]?.id || ''),
      order_types: cfg.order_types && cfg.order_types.length > 0 ? cfg.order_types : [...CANCEL_ORDER_TYPE_VALUES],
      side: cfg.side || '',
      test_mode: cfg.test_mode !== undefined ? cfg.test_mode : true,
      shortcut_key: cfg.shortcut_key || '',
    });
    setShowModal(true);
    setStatusMsg('');
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const { action, configId: evtConfigId, moduleKey, preFill: evtPreFill } = (e as CustomEvent).detail || {};
      if (moduleKey !== 'cancel') return;
      if (action === 'new') {
        openNew();
      } else if (action === 'edit' && evtConfigId) {
        const cfg = configs.find(c => c.id === evtConfigId);
        if (cfg) openEdit(cfg as CancelConfigItem);
      } else if (action === 'prefill' && evtPreFill) {
        applyPreFill(evtPreFill);
      }
    };
    window.addEventListener('open-config-modal', handler);
    return () => window.removeEventListener('open-config-modal', handler);
  }, [openNew, configs, applyPreFill]); // eslint-disable-line react-hooks/exhaustive-deps

  const { handleSaveConfig, handleSaveAndStart } = useMemo(() => createModuleSaveHandlers<CancelFormState>({
    handleSave,
    handleStart,
    closeModal,
    fetchConfigs,
    buildConfigData: (form: CancelFormState, ctx) => ({
      name: form.name || (ctx.editingId ? undefined : `#${Date.now().toString(16).slice(-4).toUpperCase()}`),
      inst_id: form.inst_id,
      account_id: form.account_id,
      order_types: form.order_types,
      side: form.side,
      test_mode: form.test_mode,
      shortcut_key: form.shortcut_key || '',
    }),
    isRunMode: () => isRunMode,
    handleRunMode: async (configData) => {
      try {
        setStatusMsg(t('cancel.ui.statusExecuting'));
        const res = await fetch('/api/cancel/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(configData),
        });
        const data = await res.json();
        if (data.ok) {
          closeModal();
          window.dispatchEvent(new CustomEvent('open-log-drawer', { detail: { moduleKey: 'cancel' } }));
        } else {
          setStatusMsg(t('cancel.ui.statusFailed', { error: data.error || t('cancel.ui.statusDefaultError') }));
        }
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        console.error('立即执行撤单失败:', err.message);
        setStatusMsg(t('cancel.ui.statusNetworkError'));
      }
    },
  }), [handleSave, handleStart, closeModal, fetchConfigs, isRunMode, t, setStatusMsg]);

  const toggleType = (value: string, checked: boolean) => {
    setForm(prev => ({
      ...prev,
      order_types: checked
        ? [...prev.order_types, value]
        : prev.order_types.filter(t => t !== value),
    }));
  };
  const isAllSelected = form.order_types.length >= CANCEL_ORDER_TYPE_OPTIONS.length;

  const configModalProps = {
    open: showModal,
    title: (preFill?.orderType || isPrefillMode) ? t('order.batchCancel') : (isRunMode ? t('cancel.ui.runTitle') : (editingId ? t('cancel.ui.editTitle') : t('cancel.ui.newTitle'))),
    saveLabel: isRunMode ? t('cancel.ui.runLabel') : (editingId ? t('cancel.ui.saveUpdate') : t('cancel.ui.saveConfig')),
    onClose: (preFill?.orderType || isPrefillMode) ? cancelBack : closeModal,
    onSave: () => handleSaveConfig(form, editingId),
    onSaveAndStart: !isRunMode ? () => handleSaveAndStart(form, editingId) : undefined,
    isLive: !form.test_mode,
    statusMsg,
    preview: <CancelPreviewPanel orders={previewOrders} t={t} />,
  };

  const configModalChildren = (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-3xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5">{t('cancel.form.configName')}</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder={t('cancel.form.configNamePlaceholder')}
            className="w-full bg-white/5 border border-border-default rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-focus-ring focus:ring-1 focus:ring-focus-ring transition-all"
          />
        </div>
        <div className="w-36">
          <label className={LABEL_BASE}>
            <Tooltip content={t('common.shortcutKeyTip')}>
              <DashedHint className="cursor-help">
                {t('common.shortcutKey')}
              </DashedHint>
            </Tooltip>
          </label>
          <ShortcutKeyInput
            value={form.shortcut_key || ''}
            onChange={(val) => {
              setForm(prev => ({ ...prev, shortcut_key: val }));
              checkShortcutKeyConflict(val, editingId || undefined);
            }}
            conflictMsg={shortcutKeyConflictMsg}
          />
        </div>
        <AccountSelect
          value={form.account_id}
          onChange={(v) => setForm(prev => ({ ...prev, account_id: v }))}
          accounts={accountList}
        />
        <InstrumentInput
          label={t('cancel.form.instIdLabel')}
          tooltip={t('cancel.form.instIdTooltip')}
          value={form.inst_id}
          defaultValue=""
          placeholder={t('cancel.form.instIdPlaceholder')}
          onChange={(v) => setForm(prev => ({ ...prev, inst_id: v }))}
        />
        <div className="space-y-2">
          <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5">{t('cancel.form.sideLabel')}</label>
          <Select
            value={form.side}
            onChange={(e) => setForm(prev => ({ ...prev, side: e.target.value }))}
            className={form.side === 'buy' ? '!text-trade-green' : form.side === 'sell' ? '!text-trade-red' : ''}
          >
            <option value="" className="!text-text-primary">{t('cancel.option.sideAll')}</option>
            <option value="buy" className="!text-trade-green">{t('cancel.option.sideBuy')}</option>
            <option value="sell" className="!text-trade-red">{t('cancel.option.sideSell')}</option>
          </Select>
        </div>
      </div>

      <div className="space-y-2.5">
        <label className="block text-3xs font-bold text-text-tertiary uppercase tracking-wider">
          <Tooltip content={t('common.orderTypeMapping')}>
            <DashedHint className="cursor-help">
              {t('cancel.form.orderTypeLabel')}
            </DashedHint>
          </Tooltip>
        </label>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {[
            { label: t('cancel.form.orderTypeAll'), value: 'all' },
            ...CANCEL_ORDER_TYPE_OPTIONS
          ].map((type) => (
            <label key={type.value} className="flex items-center gap-2.5 text-sm text-gray-300 cursor-pointer hover:text-text-primary select-none">
              <input
                type="checkbox"
                checked={type.value === 'all' ? isAllSelected : form.order_types.includes(type.value)}
                onChange={(e) => {
                  if (type.value === 'all') {
                    setForm(prev => ({
                      ...prev,
                      order_types: e.target.checked ? [...CANCEL_ORDER_TYPE_VALUES] : [],
                    }));
                  } else {
                    toggleType(type.value, e.target.checked);
                  }
                }}
                className="rounded border-border-default bg-white/5 text-brand-yellow focus:ring-focus-ring focus:ring-offset-0"
              />
              {typeof type.label === 'string' && type.label.startsWith('order.') ? t(type.label) : type.label}
            </label>
          ))}
        </div>
      </div>

      <Switch
        checked={!form.test_mode}
        onChange={(v) => setForm(prev => ({ ...prev, test_mode: !v }))}
        label={t('cancel.switch.testModeLabel')}
        descriptionOn={t('cancel.switch.testModeOn')}
        descriptionOff={t('cancel.switch.testModeOff')}
        colorOn="text-brand-yellow"
      />
    </>
  );

  if (!isActive) return (
    <ConfigModal {...configModalProps}>
      {configModalChildren}
    </ConfigModal>
  );
  return (
    <div className="h-full flex flex-col relative">
      <ConfigHeader
        icon={Trash2}
        iconColor="text-trade-red"
        title={preFill?.orderType ? t('order.batchCancel') : t('nav.cancel')}
        subtitle={t('cancel.ui.subtitle')}
        addLabel={t('cancel.ui.addLabel')}
        onAdd={openNew}
        actions={
          configs.length > 0 && (
            <Button
              className={batchMode ? 'bg-brand-blue/20 text-brand-blue' : ''}
              onClick={() => setBatchMode(!batchMode)}
            >
              <ListChecks className="w-3.5 h-3.5" />
              {batchMode ? t('batch.exitMode') : t('batch.mode')}
            </Button>
          )
        }
      />

      <ConfigListLayout
        logPanel={
          <LogViewer
            logs={filteredLogs}
            title={selectedConfigId ? t('cancel.ui.logTitleSelected', { name: configs.find(c => c.id === selectedConfigId)?.name || '' }) : t('cancel.ui.logTitle')}
            icon="trash"
            running={hasAnyRunning}
            autoScroll={autoScroll}
            onAutoScrollChange={setAutoScroll}
            onClearLogs={onClearLogs}
            accountNames={accountNames as unknown as Record<string, string>}
            accountColors={accountColors as unknown as Record<string, string>}
            timezone={serverTimezone}
          />
        }
      >
        {batchMode && (
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
        {isLoading ? (
          <Spinner size="lg" label={t('cancel.ui.loading')} className="text-brand-yellow" />
        ) : configs.length === 0 ? (
          <EmptyConfigs label={t('cancel.ui.noConfig')} onAdd={openNew} />
        ) : (
          configs.map((cfg) => (
            <div key={cfg.id}>
              <ConfigCard
                instId={cfg.inst_id}
                name={cfg.name || t('cancel.ui.unnamedConfig')}
                shortcutKey={cfg.shortcut_key}
                isRunning={!!runningMap[cfg.id]}
                isSelected={selectedConfigId === cfg.id}
                testMode={cfg.test_mode}
                onClick={() => setSelectedConfigId(selectedConfigId === cfg.id ? null : cfg.id)}
                onEdit={() => openEdit(cfg)}
                onDuplicate={() => handleDuplicate(cfg.id)}
                batchMode={batchMode}
                isBatchSelected={selectedIds.has(cfg.id)}
                onToggleSelect={() => toggleSelect(cfg.id)}
                onPin={() => handlePin(cfg.id)}
                onDelete={() => handleDelete(cfg.id)}
                onStart={() => handleStart(cfg.id)}
                onStop={() => handleStop(cfg.id)}
              >
                <ConfigDescription
                  cfg={cfg}
                  accountNames={accountNames}
                  accountColors={accountColors}
                  accounts={accounts}
                  t={t}
                />
              </ConfigCard>
            </div>
          ))
        )}
      </ConfigListLayout>

      <ConfigModal {...configModalProps}>
        {configModalChildren}
      </ConfigModal>
    </div>
  );
});
