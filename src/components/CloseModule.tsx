import DashedHint from '../ui/DashedHint'
import { Spinner } from '../ui/Spinner'
import React, { useState, useMemo, memo, useEffect, useCallback, useRef } from 'react';
import { XCircle, ListChecks } from 'lucide-react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import Switch from '../ui/Switch.tsx';
import AccountSelect from '../ui/AccountSelect.tsx';
import InstrumentInput from '../ui/InstrumentInput.tsx';
import Select from '../ui/Select.tsx';
import TextInput from '../ui/TextInput.tsx';
import { Tooltip } from '../ui/Tooltip.tsx';
import { LABEL_BASE } from '../ui/inputStyles.ts';
import LogViewer from '../ui/LogViewer.tsx';
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

export interface CloseConfigItem extends ModuleConfig {
  id: string;
  name: string;
  inst_id: string;
  account_id: string;
  mgn_mode: string;
  pos_side: string;
  upl_filter: string;
  upl_ratio_filter: string;
  test_mode: boolean;
  reverse: boolean;
}

interface CloseModuleProps {
  config: Partial<AppConfig>;
  logs: LogEntry[];
  onClearLogs: () => void;
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  showToast: (message: string, type: 'success' | 'error') => void;
  serverTimezone?: string;
  isActive?: boolean;
}

export function buildCloseDescSegments(
  cfg: CloseConfigItem,
  accountNames: Record<number, string>,
  _accountColors?: Record<number, string>,
  accounts: Array<{ id: string; name: string }> = [],
  t: (key: string) => string = i18next.t.bind(i18next)
): DescSegment[] {
  const accountName = getAccountNameFromConfig(cfg, accountNames, accounts, t);
  const instLabel = cfg.inst_id || t('close.desc.all');

  const segs: DescSegment[] = [
    { label: t('close.desc.account'), value: accountName },
    { label: t('close.desc.instId'), value: instLabel, style: 'value' },
  ];

  const mgnModeMap: Record<string, string> = { cross: t('close.value.mgnModeCross'), isolated: t('close.value.mgnModeIsolated') };
  segs.push({ label: t('close.desc.mgnMode'), value: mgnModeMap[cfg.mgn_mode] || t('close.option.all'), style: 'value' });

  const posSideMap: Record<string, string> = { long: t('close.value.posSideLong'), short: t('close.value.posSideShort') };
  segs.push({ label: t('close.desc.posSide'), value: posSideMap[cfg.pos_side] || t('close.option.all'), style: cfg.pos_side === 'long' ? 'green' : cfg.pos_side === 'short' ? 'red' : 'value' });
  if (cfg.upl_filter) {
    segs.push({ label: t('close.desc.uplFilter'), value: cfg.upl_filter, style: 'value' });
  }
  if (cfg.upl_ratio_filter) {
    segs.push({ label: t('close.desc.uplRatioFilter'), value: cfg.upl_ratio_filter, style: 'value' });
  }

  segs.push({ label: t('close.desc.testMode'), value: !cfg.test_mode ? t('close.value.on') : t('close.value.off'), style: !cfg.test_mode ? 'yellow-on' : 'gray-off' });

  segs.push({ label: t('close.desc.reverse'), value: cfg.reverse ? t('close.value.on') : t('close.value.off'), style: cfg.reverse ? 'yellow-on' : 'gray-off' });

  return segs;
}

export function buildCloseDescText(segments: DescSegment[]): string {
  return segments.map(s => `${s.label}: ${s.value}`).join(', ');
}

const ConfigDescription = memo(({ cfg, accountNames, accountColors, accounts, t }: {
  cfg: CloseConfigItem;
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  accounts: Array<{ id: string; name: string }>;
  t: (key: string) => string;
}) => {
  const accountId = cfg.account_id || '';
  const accIdx = accounts.findIndex(a => a.id === accountId);
  const accountColor = accIdx >= 0 ? accountColors[accIdx] : undefined;
  const segments = buildCloseDescSegments(cfg, accountNames, accountColors, accounts, t);

  return (
    <ConfigSummaryRender 
      segments={segments} 
      accountColor={accountColor} 
    />
  );
});

ConfigDescription.displayName = 'CloseConfigDescription';

const ClosePreviewPanel = memo(({ positions, t }: {
  positions: Array<{ instId: string; mgnMode: string; posSide: string; upl: string; uplRatio: string }>;
  t: (key: string) => string;
}) => {
  if (!positions.length) {
    return (
      <div className="text-3xs text-text-muted text-center py-4">
        {t('close.preview.noData')}
      </div>
    );
  }

  const mgnModeMap: Record<string, string> = { cross: t('close.value.mgnModeCross'), isolated: t('close.value.mgnModeIsolated') };
  const posSideMap: Record<string, string> = { long: t('close.value.posSideLong'), short: t('close.value.posSideShort'), net: t('close.value.posSideNet') };

  return (
    <div className="space-y-2">
      <div className="text-3xs font-bold text-text-tertiary uppercase tracking-wider">
        {t('close.preview.title')}
      </div>
      <div>
        <table className="w-full text-2xs border-collapse">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="py-1 px-1 text-left text-text-tertiary font-medium w-5">#</th>
              <th className="py-1 px-1 text-left text-text-tertiary font-medium">{t('close.preview.instIdShort')}</th>
              <th className="py-1 px-1 text-center text-text-tertiary font-medium">{t('close.preview.mgnModeShort')}</th>
              <th className="py-1 px-1 text-center text-text-tertiary font-medium">{t('close.preview.posSideShort')}</th>
              <th className="py-1 px-1 text-right text-text-tertiary font-medium">{t('close.preview.uplShort')}</th>
              <th className="py-1 px-1 text-right text-text-tertiary font-medium">{t('close.preview.uplRatioShort')}</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p, idx) => {
              const uplNum = parseFloat(p.upl || '0');
              const uplRatioNum = parseFloat(p.uplRatio || '0') * 100;
              const isPositive = uplNum >= 0;
              return (
                <tr key={idx} className={`${idx % 2 === 0 ? 'bg-surface-1' : ''} hover:bg-surface-3`}>
                  <td className="py-1 px-1 text-text-tertiary font-medium">{idx + 1}</td>
                  <td className="py-1 px-1 text-text-primary whitespace-nowrap">{p.instId}</td>
                  <td className="py-1 px-1 text-center text-text-secondary">{mgnModeMap[p.mgnMode] || p.mgnMode || '-'}</td>
                  <td className={`py-1 px-1 text-center ${p.posSide === 'long' ? 'text-trade-green' : p.posSide === 'short' ? 'text-trade-red' : 'text-text-secondary'}`}>
                    {posSideMap[p.posSide] || p.posSide || '-'}
                  </td>
                  <td className={`py-1 px-1 text-right font-mono whitespace-nowrap ${isPositive ? 'text-trade-green' : 'text-trade-red'}`}>
                    {uplNum.toFixed(2)}
                  </td>
                  <td className={`py-1 px-1 text-right font-mono whitespace-nowrap ${isPositive ? 'text-trade-green' : 'text-trade-red'}`}>
                    {uplRatioNum.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
ClosePreviewPanel.displayName = 'ClosePreviewPanel';

export default memo(function CloseModule({
  config,
  logs,
  onClearLogs,
  accountNames,
  accountColors,
  showToast: onShowToast,
  serverTimezone,
  isActive = true,
}: CloseModuleProps) {
  const { t } = useTranslation();
  const accounts = useMemo(() => (config.accounts || []) as Array<{ id: string; name: string }>, [config.accounts]);
  const accountList = useMemo(() =>
    accounts.map((a, idx) => ({ id: a.id, name: a.name, color: accountColors[idx] })),
    [accounts, accountColors]
  );

  type CloseFormState = {
    name: string;
    inst_id: string;
    account_id: string;
    mgn_mode: string;
    pos_side: string;
    upl_filter: string;
    upl_ratio_filter: string;
    test_mode: boolean;
    reverse: boolean;
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
  } = useConfigManager<CloseConfigItem>({
    moduleName: 'close',
    apiPrefix: '/api/close',
    onShowToast: onShowToast,
    toRequestBody: (form) => ({
      name: form.name ?? '',
      inst_id: form.inst_id ?? '',
      account_id: form.account_id ?? '',
      mgn_mode: form.mgn_mode ?? '',
      pos_side: form.pos_side ?? '',
      upl_filter: form.upl_filter ?? '',
      upl_ratio_filter: form.upl_ratio_filter ?? '',
      test_mode: form.test_mode ?? true,
      reverse: form.reverse ?? false,
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
  } = useConfigModalForm<CloseFormState>({
    createEmptyForm: () => ({
      name: '',
      inst_id: '',
      account_id: '',
      mgn_mode: '',
      pos_side: '',
      upl_filter: '',
      upl_ratio_filter: '',
      test_mode: true,
      reverse: false,
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

  const [previewPositions, setPreviewPositions] = useState<Array<{ instId: string; mgnMode: string; posSide: string; upl: string; uplRatio: string }>>([]);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPreviewClose = useCallback(() => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/preview-close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: form.account_id,
            instId: form.inst_id || '',
            mgnMode: form.mgn_mode,
            posSide: form.pos_side,
            uplFilter: form.upl_filter,
            uplRatioFilter: form.upl_ratio_filter,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          setPreviewPositions(data.positions || []);
        }
      } catch {
      }
    }, 300);
  }, [form.account_id, form.inst_id, form.mgn_mode, form.pos_side, form.upl_filter, form.upl_ratio_filter]);

  useEffect(() => {
    if (showModal) fetchPreviewClose();
  }, [showModal, fetchPreviewClose]);

  useEffect(() => {
    if (!showModal) setPreviewPositions([]);
  }, [showModal]);

  useEffect(() => {
    if (showModal && !editingId && !form.account_id && accounts.length > 0) {
      setForm(prev => ({ ...prev, account_id: accounts[0].id }));
    }
  }, [showModal, editingId, form.account_id, accounts, setForm]);

  const filteredLogs = useMemo(() => getFilteredLogs(logs), [logs, getFilteredLogs]);

  const openEdit = (cfg: CloseConfigItem) => {
    setEditingId(cfg.id);
    setForm({
      name: cfg.name,
      inst_id: cfg.inst_id || '',
      account_id: (cfg.account_id && accounts.find(a => a.id === cfg.account_id)) ? cfg.account_id : (accounts[0]?.id || ''),
      mgn_mode: cfg.mgn_mode || '',
      pos_side: cfg.pos_side || '',
      upl_filter: cfg.upl_filter || '',
      upl_ratio_filter: cfg.upl_ratio_filter || '',
      test_mode: cfg.test_mode !== undefined ? cfg.test_mode : true,
      reverse: cfg.reverse ?? false,
      shortcut_key: cfg.shortcut_key || '',
    });
    setStatusMsg('');
    setShowModal(true);
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const { action, configId: evtConfigId, moduleKey } = (e as CustomEvent).detail || {};
      if (moduleKey !== 'close') return;
      if (action === 'new') {
        openNew();
      } else if (action === 'edit' && evtConfigId) {
        const cfg = configs.find(c => c.id === evtConfigId);
        if (cfg) openEdit(cfg as CloseConfigItem);
      }
    };
    window.addEventListener('open-config-modal', handler);
    return () => window.removeEventListener('open-config-modal', handler);
  }, [openNew, configs]); // eslint-disable-line react-hooks/exhaustive-deps

  const { handleSaveConfig, handleSaveAndStart } = useMemo(() => createModuleSaveHandlers<CloseFormState>({
    handleSave,
    handleStart,
    closeModal,
    fetchConfigs,
    buildConfigData: (form: CloseFormState) => ({
      name: form.name,
      inst_id: form.inst_id,
      account_id: form.account_id,
      mgn_mode: form.mgn_mode,
      pos_side: form.pos_side,
      upl_filter: form.upl_filter,
      upl_ratio_filter: form.upl_ratio_filter,
      test_mode: form.test_mode,
      reverse: form.reverse,
      shortcut_key: form.shortcut_key || '',
    }),
  }), [handleSave, handleStart, closeModal, fetchConfigs]);

  const configModalProps = {
    open: showModal,
    title: editingId ? t('close.ui.editTitle') : t('close.ui.newTitle'),
    saveLabel: editingId ? t('close.ui.saveUpdate') : t('close.ui.saveConfig'),
    onClose: closeModal,
    onSave: () => handleSaveConfig(form, editingId),
    onSaveAndStart: () => handleSaveAndStart(form, editingId),
    isLive: !form.test_mode,
    statusMsg,
    preview: <ClosePreviewPanel positions={previewPositions} t={t} />,
    maxWidth: 'max-w-[707px]',
  };

  const configModalChildren = (
    <>
      <div className="grid grid-cols-[160px_160px] gap-4">
        <div>
          <label className="block text-3xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5">{t('close.form.configName')}</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder={t('close.form.configNamePlaceholder')}
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
        <InstrumentInput
          label={t('close.form.instIdLabel')}
          tooltip={t('close.form.instIdTooltip')}
          value={form.inst_id}
          defaultValue=""
          placeholder="BTC-USDT-SWAP"
          onChange={(v) => setForm(prev => ({ ...prev, inst_id: v }))}
        />
        <div className="space-y-2">
          <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            {t('close.form.mgnModeLabel')}
          </label>
          <Select
            value={form.mgn_mode}
            onChange={(e) => setForm(prev => ({ ...prev, mgn_mode: e.target.value }))}
          >
            <option value="">{t('close.option.all')}</option>
            <option value="cross">{t('close.option.mgnModeCross')}</option>
            <option value="isolated">{t('close.option.mgnModeIsolated')}</option>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            {t('close.form.posSideLabel')}
          </label>
          <Select
            value={form.pos_side}
            onChange={(e) => setForm(prev => ({ ...prev, pos_side: e.target.value }))}
            className={
              form.pos_side === 'long'
                ? '!text-trade-green'
                : form.pos_side === 'short'
                  ? '!text-trade-red'
                  : ''
            }
          >
            <option value="" className="!text-text-primary">{t('close.option.all')}</option>
            <option value="long" className="!text-trade-green">{t('close.option.posSideLong')}</option>
            <option value="short" className="!text-trade-red">{t('close.option.posSideShort')}</option>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Tooltip content={t('close.form.uplFilterTooltip')}>
              <DashedHint className="cursor-help">
                {t('close.form.uplFilterLabel')}
              </DashedHint>
            </Tooltip>
          </label>
          <TextInput
            value={form.upl_filter}
            defaultValue=""
            onChange={(v) => setForm(prev => ({ ...prev, upl_filter: v }))}
            placeholder=">100"
          />
        </div>
        <div className="space-y-2">
          <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Tooltip content={t('close.form.uplRatioFilterTooltip')}>
              <DashedHint className="cursor-help">
                {t('close.form.uplRatioFilterLabel')}
              </DashedHint>
            </Tooltip>
          </label>
          <TextInput
            value={form.upl_ratio_filter}
            defaultValue=""
            onChange={(v) => setForm(prev => ({ ...prev, upl_ratio_filter: v }))}
            placeholder=">5%"
          />
        </div>
      </div>

      <Switch
        checked={!form.test_mode}
        onChange={(v) => setForm(prev => ({ ...prev, test_mode: !v }))}
        label={t('close.switch.testModeLabel')}
        descriptionOn={t('close.switch.testModeOn')}
        descriptionOff={t('close.switch.testModeOff')}
        colorOn="text-brand-yellow"
      />

      <Switch
        checked={form.reverse}
        onChange={(v) => setForm(prev => ({ ...prev, reverse: v }))}
        label={t('close.switch.reverseLabel')}
        descriptionOn={t('close.switch.reverseOn')}
        descriptionOff={t('close.switch.reverseOff')}
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
        icon={XCircle}
        iconColor="text-orange-500"
        title={t('nav.close')}
        subtitle={t('close.ui.subtitle')}
        addLabel={t('close.ui.addLabel')}
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
            title={selectedConfigId ? t('close.ui.logTitleSelected', { name: configs.find(c => c.id === selectedConfigId)?.name || '' }) : t('close.ui.logTitle')}
            icon="x-circle"
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
          <Spinner size="lg" label={t('close.ui.loading')} className="text-brand-yellow" />
        ) : configs.length === 0 ? (
          <EmptyConfigs label={t('close.ui.noConfig')} onAdd={openNew} />
        ) : (
          configs.map((cfg) => (
            <div key={cfg.id}>
              <ConfigCard
                instId={cfg.inst_id}
                name={cfg.name || t('close.ui.unnamedConfig')}
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
