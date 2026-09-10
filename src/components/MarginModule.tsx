import DashedHint from '../ui/DashedHint'
import { Spinner } from '../ui/Spinner'
import React, { useState, useMemo, memo, useEffect } from 'react';
import { ArrowLeftRight, ListChecks } from 'lucide-react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import Switch from '../ui/Switch.tsx';
import AccountSelect from '../ui/AccountSelect.tsx';
import NumberInput from '../ui/NumberInput.tsx';
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
import { getAccountNameFromConfig } from '../lib/resolveAccount.ts';
import ShortcutKeyInput from '../ui/ShortcutKeyInput.tsx';

export interface MarginConfigItem extends ModuleConfig {
  id: string;
  name: string;
  account_id: string;
  margin_guard_redeem_amt: string;
  margin_payment_account: string;
  margin_to_account?: string;
  test_mode: boolean;
}

interface MarginModuleProps {
  config: Partial<AppConfig>;
  logs: LogEntry[];
  onClearLogs: () => void;
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  showToast: (message: string, type: 'success' | 'error') => void;
  serverTimezone?: string;
  isActive?: boolean;
}

const getPaymentOptions = (t: (key: string) => string = i18next.t.bind(i18next)) => [
  { label: t('margin.fundingAccount'), value: 'funding' },
  { label: t('margin.savingsUsdt'), value: 'savings' },
];

const getOkxDestOptions = (t: (key: string) => string = i18next.t.bind(i18next)) => [
  { label: t('margin.tradingAccount'), value: '18' },
];

const getBinanceDestOptions = (t: (key: string) => string = i18next.t.bind(i18next)) => [
  { label: t('margin.spotAccount'), value: 'SPOT' },
  { label: t('margin.marginAccountCross'), value: 'MARGIN' },
  { label: t('margin.futuresAccountUsdt'), value: 'USDT_FUTURE' },
];

export function buildMarginDescSegments(
  cfg: MarginConfigItem,
  accountNames: Record<number, string>,
  _accountColors: Record<number, string>,
  accounts: Array<{ id: string; name: string; exchange?: string }> = [],
  t: (key: string) => string = i18next.t.bind(i18next)
): DescSegment[] {
  const account = accounts?.find(a => a.id === cfg.account_id);
  const accountName = getAccountNameFromConfig(cfg, accountNames, accounts, t);
  const paymentLabel = getPaymentOptions(t).find(o => o.value === cfg.margin_payment_account)?.label || cfg.margin_payment_account || t('margin.desc.unknown');
  
  const isBinance = account?.exchange === 'BINANCE';
  const destOptions = isBinance ? getBinanceDestOptions(t) : getOkxDestOptions(t);
  
  let displayValue = cfg.margin_to_account;
  if (isBinance && (displayValue === '18' || !displayValue)) {
    displayValue = 'SPOT';
  }

  const destLabel = destOptions.find(o => o.value === displayValue)?.label || displayValue || (isBinance ? t('margin.option.destBinanceSpot') : t('margin.option.destOkxTrading'));

  const segs: DescSegment[] = [
    { label: t('margin.desc.account'), value: accountName },
    { label: t('margin.desc.transferAmount'), value: `₮${cfg.margin_guard_redeem_amt}` },
    { label: t('margin.desc.paymentAccount'), value: paymentLabel },
    { label: t('margin.desc.destAccount'), value: destLabel },
    { label: t('margin.desc.testMode'), value: !cfg.test_mode ? t('margin.value.on') : t('margin.value.off'), style: !cfg.test_mode ? 'yellow-on' : 'gray-off' },
  ];

  return segs;
}

export function buildMarginDescText(segments: DescSegment[]): string {
  return segments.map(s => `${s.label}: ${s.value}`).join(', ');
}

const ConfigDescription = memo(({ cfg, accountNames, accountColors, accounts, t }: {
  cfg: MarginConfigItem;
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  accounts: Array<{ id: string; name: string; exchange?: string }>;
  t: (key: string) => string;
}) => {
  const accountId = cfg.account_id || '';
  const accIdx = accounts.findIndex(a => a.id === accountId);
  const accountColor = accIdx >= 0 ? accountColors[accIdx] : undefined;
  const segments = buildMarginDescSegments(cfg, accountNames, accountColors, accounts, t);

  return (
    <ConfigSummaryRender 
      segments={segments} 
      accountColor={accountColor} 
    />
  );
});

ConfigDescription.displayName = 'ConfigDescription';

export default React.memo(function MarginModule({
  config,
  logs,
  onClearLogs,
  accountNames,
  accountColors,
  showToast: onShowToast,
  serverTimezone,
  isActive = true,
}: MarginModuleProps) {
  const { t } = useTranslation();
  const accounts = useMemo(() => (config.accounts || []) as Array<{ id: string; name: string; exchange?: string }>, [config.accounts]);
  const accountList = useMemo(() =>
    accounts.map((a, idx) => ({ id: a.id, name: a.name, color: accountColors[idx], exchange: a.exchange })),
    [accounts, accountColors]
  );

  type MarginFormState = {
    name: string;
    account_id: string;
    margin_guard_redeem_amt: string;
    margin_payment_account: string;
    margin_to_account: string;
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
  } = useConfigManager<MarginConfigItem>({
    moduleName: 'margin',
    apiPrefix: '/api/margin',
    onShowToast: onShowToast,
    toRequestBody: (form) => ({
      name: form.name ?? '',
      account_id: form.account_id ?? '',
      margin_guard_redeem_amt: form.margin_guard_redeem_amt ?? "100",
      margin_payment_account: form.margin_payment_account ?? "funding",
      margin_to_account: form.margin_to_account ?? "18",
      test_mode: form.test_mode ?? false,
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
    openNew,
    closeModal,
  } = useConfigModalForm<MarginFormState>({
    createEmptyForm: () => ({
      name: '',
      account_id: '',
      margin_guard_redeem_amt: '100',
      margin_payment_account: 'funding',
      margin_to_account: '18',
      test_mode: true,
      shortcut_key: '',
    }),
  });

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

  useEffect(() => {
    if (showModal && !editingId && !form.account_id && accounts.length > 0) {
      const firstAcc = accounts[0];
      const defaultTo = firstAcc.exchange === 'BINANCE' ? 'SPOT' : '18';
      setForm(prev => ({ ...prev, account_id: firstAcc.id, margin_to_account: defaultTo }));
    }
  }, [showModal, editingId, form.account_id, accounts, setForm]);

  const currentAccount = useMemo(() => 
    accounts.find(a => a.id === form.account_id),
  [form.account_id, accounts]);

  const destinationOptions = useMemo(() => {
    if (currentAccount?.exchange === 'BINANCE') {
      return getBinanceDestOptions();
    }
    return getOkxDestOptions();
  }, [currentAccount]);

  useEffect(() => {
    if (form.account_id && destinationOptions.length > 0) {
      const isValid = destinationOptions.some(opt => opt.value === form.margin_to_account);
      if (!isValid) {
        setForm(prev => ({ ...prev, margin_to_account: destinationOptions[0].value }));
      }
    }
  }, [form.account_id, destinationOptions, form.margin_to_account, setForm]);

  const filteredLogs = useMemo(() => getFilteredLogs(logs), [logs, getFilteredLogs]);

  const openEdit = (cfg: MarginConfigItem) => {
    const acc = accounts.find(a => a.id === cfg.account_id) || accounts[0];
    const defaultTo = acc?.exchange === 'BINANCE' ? 'SPOT' : '18';
    
    setEditingId(cfg.id);
    setForm({
      name: cfg.name,
      account_id: (cfg.account_id && accounts.find(a => a.id === cfg.account_id)) ? cfg.account_id : (accounts[0]?.id || ''),
      margin_guard_redeem_amt: cfg.margin_guard_redeem_amt ?? '100',
      margin_payment_account: cfg.margin_payment_account || 'funding',
      margin_to_account: cfg.margin_to_account || defaultTo,
      test_mode: cfg.test_mode !== undefined ? cfg.test_mode : true,
      shortcut_key: cfg.shortcut_key || '',
    });
    setShowModal(true);
    setStatusMsg('');
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const { action, configId: evtConfigId, moduleKey } = (e as CustomEvent).detail || {};
      if (moduleKey !== 'margin') return;
      if (action === 'new') {
        openNew();
      } else if (action === 'edit' && evtConfigId) {
        const cfg = configs.find(c => c.id === evtConfigId);
        if (cfg) openEdit(cfg as MarginConfigItem);
      }
    };
    window.addEventListener('open-config-modal', handler);
    return () => window.removeEventListener('open-config-modal', handler);
  }, [openNew, configs]); // eslint-disable-line react-hooks/exhaustive-deps

  const { handleSaveConfig, handleSaveAndStart } = useMemo(() => createModuleSaveHandlers<MarginFormState>({
    handleSave,
    handleStart,
    closeModal,
    fetchConfigs,
    buildConfigData: (form: MarginFormState) => ({
      name: form.name,
      account_id: form.account_id,
      margin_guard_redeem_amt: form.margin_guard_redeem_amt,
      margin_payment_account: form.margin_payment_account,
      margin_to_account: form.margin_to_account,
      test_mode: form.test_mode,
      shortcut_key: form.shortcut_key || '',
    }),
  }), [handleSave, handleStart, closeModal, fetchConfigs]);

  const configModalProps = {
    open: showModal,
    title: editingId ? t('margin.ui.editTitle') : t('margin.ui.newTitle'),
    saveLabel: editingId ? t('margin.ui.saveUpdate') : t('margin.ui.saveConfig'),
    onClose: closeModal,
    onSave: () => handleSaveConfig(form, editingId),
    onSaveAndStart: () => handleSaveAndStart(form, editingId),
    isLive: !form.test_mode,
    statusMsg,
    maxWidth: 'max-w-[386px]',
  };

  const configModalChildren = (
    <>
      <div className="grid grid-cols-[160px_160px] gap-4">
        <div>
          <label className="block text-3xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5">{t('margin.form.configName')}</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder={t('margin.form.configNamePlaceholder')}
            className="w-full bg-white/5 border border-border-default rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-focus-ring focus:ring-1 focus:ring-focus-ring transition-all"
          />
        </div>
        <div>
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
        <NumberInput
          label={t('margin.form.transferAmountLabel')}
          tooltip={t('margin.form.transferAmountTooltip')}
          value={form.margin_guard_redeem_amt}
          defaultValue="100"
          onChange={(v) => setForm(prev => ({ ...prev, margin_guard_redeem_amt: v }))}
          min={0.01}
          step="0.01"
        />
        <div className="space-y-2">
          <label className="block text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5">
            {t('margin.form.paymentAccountLabel')}
          </label>
          <Select
            value={form.margin_payment_account}
            onChange={(e) => setForm(prev => ({ ...prev, margin_payment_account: e.target.value }))}
          >
            {getPaymentOptions().map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <label className="block text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5">
            {t('margin.form.destAccountLabel')}
          </label>
          <Select
            value={form.margin_to_account}
            onChange={(e) => setForm(prev => ({ ...prev, margin_to_account: e.target.value }))}
          >
            {destinationOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        </div>
      </div>

      <Switch
        checked={!form.test_mode}
        onChange={(v) => setForm(prev => ({ ...prev, test_mode: !v }))}
        label={t('margin.switch.testModeLabel')}
        descriptionOn={t('margin.switch.testModeOn')}
        descriptionOff={t('margin.switch.testModeOff')}
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
        icon={ArrowLeftRight}
        iconColor="text-brand-blue"
        title={t('nav.margin')}
        subtitle={t('margin.ui.subtitle')}
        addLabel={t('margin.ui.addLabel')}
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
            title={selectedConfigId ? t('margin.ui.logTitleSelected', { name: configs.find(c => c.id === selectedConfigId)?.name || '' }) : t('margin.ui.logTitle')}
            icon="transfer"
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
          <Spinner size="lg" label={t('margin.ui.loading')} className="text-brand-yellow" />
        ) : configs.length === 0 ? (
          <EmptyConfigs label={t('margin.ui.noConfig')} onAdd={openNew} />
        ) : (
          configs.map((cfg) => (
            <div key={cfg.id}>
              <ConfigCard
                instId={cfg.inst_id}
                name={cfg.name || t('margin.ui.unnamedConfig')}
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
