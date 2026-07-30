import DashedHint from '../ui/DashedHint'
import { Spinner } from '../ui/Spinner'
import React, { useState, useMemo, memo, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { Edit3, ListChecks } from 'lucide-react';
import Switch from '../ui/Switch.tsx';
import AccountSelect from '../ui/AccountSelect.tsx';
import Select from '../ui/Select.tsx';
import NumberInput from '../ui/NumberInput.tsx';
import FormulaPriceField from '../ui/FormulaPriceField.tsx';
import InstrumentInput from '../ui/InstrumentInput.tsx';
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

import { AMEND_ORDER_TYPE_OPTIONS, AMEND_ORDER_TYPE_VALUES, getOrderTypeLabel, normalizeOrderType } from '../constants/orderTypes.ts';
import { getAccountNameFromConfig } from '../lib/resolveAccount.ts';
import ShortcutKeyInput from '../ui/ShortcutKeyInput.tsx';

export interface AmendConfigItem extends ModuleConfig {
  id: string;
  name: string;
  inst_id: string;
  account_id: string;
  order_type: string;
  tp_sl_type: string;
  trigger_px_increment: string;
  tp_ord_px_increment: string;
  sl_ord_px_increment: string;
  px_increment: string;
  tp_px_increment: string;
  sl_px_increment: string;
  callback_ratio_spread: string;
  active_px: string;
  new_contract_size: string;
  test_mode: boolean;
}

interface AmendModuleProps {
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

interface AmendFormState {
  name: string;
  inst_id: string;
  account_id: string;
  order_type: string;
  tp_sl_type: string;
  trigger_px_increment: string;
  tp_ord_px_increment: string;
  sl_ord_px_increment: string;
  px_increment: string;
  tp_px_increment: string;
  sl_px_increment: string;
  callback_ratio_spread: string;
  active_px: string;
  new_contract_size: string;
  test_mode: boolean;
  shortcut_key: string;
}

export function buildAmendDescSegments(
  cfg: AmendConfigItem,
  accountNames: Record<number, string>,
  _accountColors: Record<number, string>,
  accounts: Array<{ id: string; name: string; exchange?: string }> = [],
  t: (key: string) => string = i18next.t.bind(i18next)
): DescSegment[] {
  const typeLabel = t(getOrderTypeLabel(cfg.order_type));
  const accountName = getAccountNameFromConfig(cfg, accountNames, accounts, t);
  const instLabel = cfg.inst_id || t('amend.all');

  const segs: DescSegment[] = [
    { label: t('amend.account'), value: accountName },
    { label: t('amend.tradingPair'), value: instLabel },
    { label: t('amend.type'), value: typeLabel },
  ];

  if (cfg.order_type === 'trigger') {
    segs.push({ label: t('amend.triggerPxIncrement'), value: cfg.trigger_px_increment });
    if (cfg.tp_sl_type === 'move_stop') {
      if (cfg.callback_ratio_spread && cfg.callback_ratio_spread !== '-1' && cfg.callback_ratio_spread !== '0') segs.push({ label: t('amend.callbackRatioSpreadIncrement'), value: cfg.callback_ratio_spread });
      if (cfg.active_px && cfg.active_px !== '') segs.push({ label: t('amend.activationPxIncrement'), value: cfg.active_px });
    } else {
      if (cfg.tp_ord_px_increment && cfg.tp_ord_px_increment !== '-1') segs.push({ label: t('amend.takeProfit'), value: cfg.tp_ord_px_increment });
    }
    if (cfg.sl_ord_px_increment && cfg.sl_ord_px_increment !== '-1') segs.push({ label: t('amend.stopLoss'), value: cfg.sl_ord_px_increment });
  }
  if (cfg.order_type === 'limit') {
    if (cfg.px_increment && cfg.px_increment !== '0') segs.push({ label: t('amend.ordPxIncrement'), value: cfg.px_increment });
    if (cfg.tp_sl_type === 'move_stop') {
      if (cfg.callback_ratio_spread && cfg.callback_ratio_spread !== '-1' && cfg.callback_ratio_spread !== '0') segs.push({ label: t('amend.callbackRatioSpreadIncrement'), value: cfg.callback_ratio_spread });
      if (cfg.active_px && cfg.active_px !== '') segs.push({ label: t('amend.activationPxIncrement'), value: cfg.active_px });
    } else {
      if (cfg.tp_ord_px_increment && cfg.tp_ord_px_increment !== '-1') segs.push({ label: t('amend.takeProfit'), value: cfg.tp_ord_px_increment });
    }
    if (cfg.sl_ord_px_increment && cfg.sl_ord_px_increment !== '-1') segs.push({ label: t('amend.stopLoss'), value: cfg.sl_ord_px_increment });
  }
  if (cfg.order_type === 'conditional' || cfg.order_type === 'oco' || cfg.order_type === 'move_order_stop') {
    if (cfg.tp_px_increment && cfg.tp_px_increment !== '0') segs.push({ label: cfg.order_type === 'move_order_stop' ? t('amend.callbackRatioIncrement') : t('amend.tpIncrement'), value: cfg.tp_px_increment });
    if (cfg.sl_px_increment && cfg.sl_px_increment !== '0') segs.push({ label: cfg.order_type === 'move_order_stop' ? t('amend.activationPxIncrement') : t('amend.slIncrement'), value: cfg.sl_px_increment });
  }

  if (cfg.new_contract_size) segs.push({ label: t('amend.quantity'), value: cfg.new_contract_size });
  segs.push({ label: t('amend.liveMode'), value: !cfg.test_mode ? t('amend.on') : t('amend.off'), style: !cfg.test_mode ? 'yellow-on' : 'gray-off' });

  return segs;
}

export function buildAmendDescText(segments: DescSegment[]): string {
  return segments.map(s => `${s.label}: ${s.value}`).join(', ');
}

const ConfigDescription = memo(({ cfg, accountNames, accountColors, accounts, t }: {
  cfg: AmendConfigItem;
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  accounts: Array<{ id: string; name: string; exchange?: string }>;
  t: (key: string) => string;
}) => {
  const accountId = cfg.account_id || '';
  const accIdx = accounts.findIndex(a => a.id === accountId);
  const accountColor = accIdx >= 0 ? accountColors[accIdx] : undefined;
  const segments = buildAmendDescSegments(cfg, accountNames, accountColors, accounts, t);

  return (
    <ConfigSummaryRender 
      segments={segments} 
      accountColor={accountColor} 
    />
  );
});

ConfigDescription.displayName = 'ConfigDescription';

const AmendPreviewPanel = memo(({ orders, t }: {
  orders: Array<{
    price?: string;
    tpPrice?: string;
    slPrice?: string;
    callback?: string;
    activePx?: string;
    size?: string;
  }>;
  t: (key: string) => string;
}) => {
  if (!orders.length) {
    return (
      <div className="text-3xs text-text-muted text-center py-4">
        {t('amend.preview.noData')}
      </div>
    );
  }

  const hasPrice = orders.some(o => o.price != null);
  const hasTpPrice = orders.some(o => o.tpPrice != null);
  const hasSlPrice = orders.some(o => o.slPrice != null);
  const hasCallback = orders.some(o => o.callback != null);
  const hasActivePx = orders.some(o => o.activePx != null);
  const hasSize = orders.some(o => o.size != null);

  const isChanged = (val: string) => typeof val === 'string' && val.includes('→');

  return (
    <div className="space-y-2">
      <div className="text-3xs font-bold text-text-tertiary uppercase tracking-wider">
        {t('amend.preview.title')}
      </div>
      <div>
        <table className="w-full text-2xs border-collapse">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="py-1 px-1 text-left text-text-tertiary font-medium w-5">#</th>
              {hasPrice && <th className="py-1 px-1 text-right text-text-tertiary font-medium">{t('amend.preview.orderPriceShort')}</th>}
              {hasCallback && <th className="py-1 px-1 text-right text-text-tertiary font-medium">{t('amend.preview.callbackShort')}</th>}
              {hasActivePx && <th className="py-1 px-1 text-right text-text-tertiary font-medium">{t('amend.preview.activePxShort')}</th>}
              {hasTpPrice && <th className="py-1 px-1 text-right text-text-tertiary font-medium">{t('amend.preview.tpPriceShort')}</th>}
              {hasSlPrice && <th className="py-1 px-1 text-right text-text-tertiary font-medium">{t('amend.preview.slPriceShort')}</th>}
              {hasSize && <th className="py-1 px-1 text-right text-text-tertiary font-medium">{t('amend.preview.contractSizeShort')}</th>}
            </tr>
          </thead>
          <tbody>
            {orders.map((o, idx) => (
              <tr key={idx} className={`${idx % 2 === 0 ? 'bg-surface-1' : ''} hover:bg-surface-3`}>
                <td className="py-1 px-1 text-text-tertiary font-medium">{idx + 1}</td>
                {hasPrice && <td className={`py-1 px-1 text-right font-mono whitespace-nowrap ${isChanged(o.price) ? 'text-brand-yellow' : 'text-text-primary'}`}>{o.price ?? '-'}</td>}
                {hasCallback && <td className={`py-1 px-1 text-right font-mono whitespace-nowrap ${isChanged(o.callback) ? 'text-brand-yellow' : 'text-text-primary'}`}>{o.callback ?? '-'}</td>}
                {hasActivePx && <td className={`py-1 px-1 text-right font-mono whitespace-nowrap ${isChanged(o.activePx) ? 'text-brand-yellow' : 'text-text-primary'}`}>{o.activePx ?? '-'}</td>}
                {hasTpPrice && <td className={`py-1 px-1 text-right font-mono whitespace-nowrap ${isChanged(o.tpPrice) ? 'text-trade-green' : 'text-trade-green/70'}`}>{o.tpPrice ?? '-'}</td>}
                {hasSlPrice && <td className={`py-1 px-1 text-right font-mono whitespace-nowrap ${isChanged(o.slPrice) ? 'text-trade-red' : 'text-trade-red/70'}`}>{o.slPrice ?? '-'}</td>}
                {hasSize && <td className={`py-1 px-1 text-right font-mono whitespace-nowrap ${isChanged(o.size) ? 'text-brand-yellow' : 'text-text-primary'}`}>{o.size ?? '-'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
AmendPreviewPanel.displayName = 'AmendPreviewPanel';

export default React.memo(function AmendModule({
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
}: AmendModuleProps) {
  const { t } = useTranslation();
  const accounts = useMemo(() => (config.accounts || []) as Array<{ id: string; name: string; exchange?: string }>, [config.accounts]);
  const accountList = useMemo(() =>
    accounts.map((a, idx) => ({ id: a.id, name: a.name, color: accountColors[idx] })),
    [accounts, accountColors]
  );

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
  } = useConfigManager<AmendConfigItem>({
    moduleName: 'amend',
    apiPrefix: '/api/amend',
    onShowToast: onShowToast,
    onStartSuccess: () => {
      window.dispatchEvent(new CustomEvent('open-log-drawer', { detail: { moduleKey: 'amend' } }));
    },
    toRequestBody: (form) => ({
      name: form.name ?? '',
      inst_id: form.inst_id ?? '',
      account_id: form.account_id ?? '',
      order_type: form.order_type ?? 'trigger',
      tp_sl_type: form.tp_sl_type ?? 'tp_sl',
      trigger_px_increment: form.trigger_px_increment ?? "0",
      tp_ord_px_increment: form.tp_ord_px_increment ?? "-1",
      sl_ord_px_increment: form.sl_ord_px_increment ?? "-1",
      px_increment: form.px_increment ?? "0",
      tp_px_increment: form.tp_px_increment ?? "0",
      sl_px_increment: form.sl_px_increment ?? "0",
      callback_ratio_spread: form.callback_ratio_spread ?? "0",
      active_px: form.active_px ?? "",
      new_contract_size: form.new_contract_size ?? "1",
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
  } = useConfigModalForm<AmendFormState>({
    createEmptyForm: () => ({
      name: '',
      inst_id: 'BTC-USDT-SWAP',
      account_id: '',
      order_type: 'limit',
      tp_sl_type: 'tp_sl',
      trigger_px_increment: '0',
      tp_ord_px_increment: '-1',
      sl_ord_px_increment: '-1',
      px_increment: '0',
      tp_px_increment: '0',
      sl_px_increment: '0',
      callback_ratio_spread: '0',
      active_px: '',
      new_contract_size: '1',
      test_mode: true,
      shortcut_key: '',
    }),
    onAfterClear: onClearPreFill,
  });

  const formName = form.name;
  const formInstId = form.inst_id;
  const formAccountId = form.account_id;
  const formOrderType = form.order_type;
  const formTpSlType = form.tp_sl_type;
  const formTriggerPxInc = form.trigger_px_increment;
  const formTpOrdPxInc = form.tp_ord_px_increment;
  const formSlOrdPxInc = form.sl_ord_px_increment;
  const formPxIncrement = form.px_increment;
  const formTpPxInc = form.tp_px_increment;
  const formSlPxInc = form.sl_px_increment;
  const formCallbackRatioSpread = form.callback_ratio_spread;
  const formActivePx = form.active_px;
  const formNewContractSize = form.new_contract_size;

  const formTestMode = form.test_mode;

  const setFormName = (value: string) => setForm(prev => ({ ...prev, name: value }));
  const setFormInstId = (value: string) => setForm(prev => ({ ...prev, inst_id: value }));
  const setFormAccountId = useCallback((value: string) => setForm(prev => ({ ...prev, account_id: value })), [setForm]);
  const setFormOrderType = (value: string) => setForm(prev => ({ ...prev, order_type: value }));
  const setFormTpSlType = (value: string) => setForm(prev => ({ ...prev, tp_sl_type: value }));
  const setFormTriggerPxInc = (value: string) => setForm(prev => ({ ...prev, trigger_px_increment: value }));
  const setFormTpOrdPxInc = (value: string) => setForm(prev => ({ ...prev, tp_ord_px_increment: value }));
  const setFormSlOrdPxInc = (value: string) => setForm(prev => ({ ...prev, sl_ord_px_increment: value }));
  const setFormPxIncrement = (value: string) => setForm(prev => ({ ...prev, px_increment: value }));
  const setFormTpPxInc = (value: string) => setForm(prev => ({ ...prev, tp_px_increment: value }));
  const setFormSlPxInc = (value: string) => setForm(prev => ({ ...prev, sl_px_increment: value }));
  const setFormCallbackRatioSpread = (value: string) => setForm(prev => ({ ...prev, callback_ratio_spread: value }));
  const setFormActivePx = (value: string) => setForm(prev => ({ ...prev, active_px: value }));
  const setFormNewContractSize = (value: string) => setForm(prev => ({ ...prev, new_contract_size: value }));
  const setFormTestMode = (value: boolean) => setForm(prev => ({ ...prev, test_mode: value }));

  useEffect(() => {
    if (showModal && !editingId && !formAccountId && accounts.length > 0) {
      setFormAccountId(accounts[0].id);
    }
  }, [showModal, editingId, formAccountId, accounts, setFormAccountId]);

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

  const [previewOrders, setPreviewOrders] = useState<Array<Record<string, any>>>([]);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPreviewAmend = useCallback(() => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/preview-amend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: formAccountId,
            instId: formInstId || '',
            orderType: formOrderType,
            tpSlType: formTpSlType,
            pxIncrement: formPxIncrement,
            triggerPxIncrement: formTriggerPxInc,
            tpOrdPxIncrement: formTpOrdPxInc,
            slOrdPxIncrement: formSlOrdPxInc,
            tpPxIncrement: formTpPxInc,
            slPxIncrement: formSlPxInc,
            callbackRatioSpread: formCallbackRatioSpread,
            activePx: formActivePx,
            newContractSize: formNewContractSize,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          setPreviewOrders(data.orders || []);
        }
      } catch {
      }
    }, 300);
  }, [formAccountId, formInstId, formOrderType, formTpSlType, formPxIncrement, formTriggerPxInc, formTpOrdPxInc, formSlOrdPxInc, formTpPxInc, formSlPxInc, formCallbackRatioSpread, formActivePx, formNewContractSize]);

  useEffect(() => {
    if (showModal) fetchPreviewAmend();
  }, [showModal, fetchPreviewAmend]);

  useEffect(() => {
    if (!showModal) setPreviewOrders([]);
  }, [showModal]);

  const [isPrefillMode, setIsPrefillMode] = useState(false);

  const isRunMode = !!preFill || !!isPrefillMode;

  const applyPreFill = useCallback((pf: { accountId: string; _account: number; instId: string; orderType: string }) => {
    const normalizedType = normalizeOrderType(pf.orderType);
    const mappedType = normalizedType && AMEND_ORDER_TYPE_VALUES.includes(normalizedType)
      ? normalizedType
      : 'limit';

    const effectiveAccountId = pf.accountId || accounts[pf._account]?.id || accounts[0]?.id || '';
    setForm(prev => ({
      ...prev,
      account_id: effectiveAccountId,
      inst_id: pf.instId,
      order_type: mappedType,
      tp_sl_type: 'tp_sl',
      name: `${t('amend.runNow')}: ${pf.instId}`,
      test_mode: false,
      trigger_px_increment: '0',
      tp_ord_px_increment: '-1',
      sl_ord_px_increment: '-1',
      px_increment: '0',
      tp_px_increment: '0',
      sl_px_increment: '0',
      callback_ratio_spread: '0',
      active_px: '',
      new_contract_size: '1',
      shortcut_key: '',
    }));
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

  const currentExchange = useMemo(() => {
    const acc = accounts.find(a => a.id === formAccountId);
    return acc?.exchange?.toUpperCase();
  }, [accounts, formAccountId]);

  const isSpot = useMemo(() => {
    if (!formInstId) return true;
    const upper = formInstId.toUpperCase();
    return !upper.includes('SWAP') && !upper.includes('PERP') && !upper.includes('FUTURES');
  }, [formInstId]);

  const filteredOrderTypeOptions = useMemo(() => {
    let allowedTypes = AMEND_ORDER_TYPE_VALUES;
    if (currentExchange === 'BINANCE') {
      if (isSpot) {
        allowedTypes = ['limit', 'conditional', 'oco', 'move_order_stop'];
      } else {
        allowedTypes = ['limit', 'conditional', 'move_order_stop'];
      }
    } else if (currentExchange === 'OKX') {
      allowedTypes = ['limit', 'trigger', 'conditional', 'oco'];
    }
    return AMEND_ORDER_TYPE_OPTIONS.filter(opt => allowedTypes.includes(opt.value));
  }, [currentExchange, isSpot]);

  useEffect(() => {
    if (!currentExchange || !formOrderType) return;
    let allowedTypes: string[] = [];
    if (currentExchange === 'BINANCE') {
      if (isSpot) {
        allowedTypes = ['limit', 'conditional', 'oco', 'move_order_stop'];
      } else {
        allowedTypes = ['limit', 'conditional', 'move_order_stop'];
      }
    } else if (currentExchange === 'OKX') {
      allowedTypes = ['limit', 'trigger', 'conditional', 'oco'];
    }
    if (!allowedTypes.includes(formOrderType)) {
      const fallbackType = currentExchange === 'BINANCE' ? 'limit' : 'trigger';
      setForm(prev => ({ ...prev, order_type: fallbackType }));
    }
  }, [currentExchange, formOrderType, setForm, isSpot]);

  const openNew = () => {
    setEditingId(null);
    setForm({
      name: '',
      inst_id: 'BTC-USDT-SWAP',
      account_id: '',
      order_type: 'limit',
      tp_sl_type: 'tp_sl',
      trigger_px_increment: '0',
      tp_ord_px_increment: '-1',
      sl_ord_px_increment: '-1',
      px_increment: '0',
      tp_px_increment: '0',
      sl_px_increment: '0',
      callback_ratio_spread: '0',
      active_px: '',
      new_contract_size: '1',
      test_mode: true,
      shortcut_key: '',
    });
    setStatusMsg('');
    setShowModal(true);
    onClearPreFill?.();
  };

  const closeModal = () => {
    setShowModal(false);
    setIsPrefillMode(false);
    onClearPreFill?.();
  };

  const cancelBack = () => {
    closeModal();
    onCancelBack?.();
  };

  const openEdit = (cfg: AmendConfigItem) => {
    onClearPreFill?.();
    setEditingId(cfg.id);
    setForm({
      name: cfg.name,
      inst_id: cfg.inst_id || '',
      account_id: (cfg.account_id && accounts.find(a => a.id === cfg.account_id)) ? cfg.account_id : (accounts[0]?.id || ''),
      order_type: cfg.order_type || 'trigger',
      tp_sl_type: cfg.tp_sl_type || 'tp_sl',
      trigger_px_increment: cfg.trigger_px_increment ?? '0',
      tp_ord_px_increment: cfg.tp_ord_px_increment ?? '-1',
      sl_ord_px_increment: cfg.sl_ord_px_increment ?? '-1',
      px_increment: cfg.px_increment ?? '0',
      tp_px_increment: cfg.tp_px_increment ?? '0',
      sl_px_increment: cfg.sl_px_increment ?? '0',
      callback_ratio_spread: cfg.callback_ratio_spread ?? '0',
      active_px: cfg.active_px ?? '',
      new_contract_size: cfg.new_contract_size ?? '1',
      test_mode: cfg.test_mode !== undefined ? cfg.test_mode : true,
      shortcut_key: cfg.shortcut_key || '',
    });
    setShowModal(true);
    setStatusMsg('');
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const { action, configId: evtConfigId, moduleKey, preFill: evtPreFill } = (e as CustomEvent).detail || {};
      if (moduleKey !== 'amend') return;
      if (action === 'new') {
        openNew();
      } else if (action === 'edit' && evtConfigId) {
        const cfg = configs.find(c => c.id === evtConfigId);
        if (cfg) openEdit(cfg as AmendConfigItem);
      } else if (action === 'prefill' && evtPreFill) {
        applyPreFill(evtPreFill);
      }
    };
    window.addEventListener('open-config-modal', handler);
    return () => window.removeEventListener('open-config-modal', handler);
  }, [openNew, configs, applyPreFill]); // eslint-disable-line react-hooks/exhaustive-deps

  const { handleSaveConfig, handleSaveAndStart } = useMemo(() => createModuleSaveHandlers<AmendFormState>({
    handleSave,
    handleStart,
    closeModal,
    fetchConfigs,
    buildConfigData: (form: AmendFormState, ctx) => ({
      name: form.name || (ctx.editingId ? undefined : `#${Date.now().toString(16).slice(-4).toUpperCase()}`),
      inst_id: form.inst_id || 'BTC-USDT-SWAP',
      account_id: form.account_id,
      order_type: form.order_type,
      tp_sl_type: form.tp_sl_type || 'tp_sl',
      trigger_px_increment: form.trigger_px_increment || '0',
      tp_ord_px_increment: form.tp_ord_px_increment || '-1',
      sl_ord_px_increment: form.sl_ord_px_increment || '-1',
      px_increment: form.px_increment || '0',
      tp_px_increment: form.tp_px_increment || '0',
      sl_px_increment: form.sl_px_increment || '0',
      callback_ratio_spread: form.callback_ratio_spread || '0',
      active_px: form.active_px || '',
      new_contract_size: form.new_contract_size || '1',
      test_mode: form.test_mode,
      shortcut_key: form.shortcut_key || '',
    }),
    isRunMode: () => isRunMode,
    handleRunMode: async (configData) => {
      try {
        setStatusMsg(t('amend.executing'));
        const res = await fetch('/api/amend/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(configData),
        });
        const data = await res.json();
        if (data.ok) {
          closeModal();
          window.dispatchEvent(new CustomEvent('open-log-drawer', { detail: { moduleKey: 'amend', force: true } }));
        } else {
          setStatusMsg(`✗ ${data.error || t('amend.execFailed')}`);
        }
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(err));
        console.error('立即执行改单失败:', err.message);
        setStatusMsg(t('amend.networkError'));
      }
    },
  }), [handleSave, handleStart, closeModal, fetchConfigs, isRunMode, t, setStatusMsg]);

  const configModalProps = {
    open: showModal,
    title: (preFill?.orderType || isPrefillMode) ? t('order.batchAmend') : (isRunMode ? `⚡ ${t('amend.runBatchAmend')}` : (editingId ? `✏️ ${t('amend.editAmendConfig')}` : `➕ ${t('amend.newAmendConfig')}`)),
    saveLabel: isRunMode ? t('amend.runNow') : (editingId ? t('amend.saveUpdate') : t('amend.saveConfig')),
    onClose: (preFill?.orderType || isPrefillMode) ? cancelBack : closeModal,
    onSave: () => handleSaveConfig(form, editingId),
    onSaveAndStart: !isRunMode ? () => handleSaveAndStart(form, editingId) : undefined,
    isLive: !formTestMode,
    statusMsg,
    preview: <AmendPreviewPanel orders={previewOrders} t={t} />,
  };

  const configModalChildren = (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-3xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5">{t('amend.configName')}</label>
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder={t('amend.configNamePlaceholder')}
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
          value={formAccountId}
          onChange={setFormAccountId}
          accounts={accountList}
        />
        <InstrumentInput
          label={t('amend.tradingPair')}
          tooltip={t('amend.tradingPairTooltip')}
          value={formInstId}
          defaultValue="BTC-USDT-SWAP"
          placeholder="BTC-USDT-SWAP"
          onChange={setFormInstId}
        />

        <div className="space-y-2">
          <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Tooltip content={t('common.orderTypeMapping')}>
              <DashedHint className="cursor-help">
                {t('amend.orderType')}
              </DashedHint>
            </Tooltip>
          </label>
          <Select
            value={formOrderType}
            onChange={(e) => setFormOrderType(e.target.value)}
          >
            {filteredOrderTypeOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{t(opt.label)}</option>
            ))}
          </Select>
        </div>

        {(formOrderType === 'limit' || formOrderType === 'trigger') && (
          <>
            <div className="space-y-2">
              <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Tooltip content={t('place.form.tpSlTypeTooltip')}>
                  <DashedHint className="cursor-help">
                    {t('amend.tpSlType')}
                  </DashedHint>
                </Tooltip>
              </label>
              <Select
                value={formTpSlType}
                onChange={(e) => setFormTpSlType(e.target.value)}
              >
                <option value="tp_sl">{t('place.option.tpSl')}</option>
              </Select>
            </div>

            {formOrderType === 'limit' ? (
              <NumberInput
                label={t('amend.ordPxIncrementPoints')}
                tooltip={t('amend.ordPxIncrementTooltip')}
                value={formPxIncrement}
                defaultValue="0"
                placeholder="0"
                onChange={setFormPxIncrement}
                step="any"
                allowPercent
              />
            ) : (
              <NumberInput
                label={t('amend.triggerOrdPxIncrementPoints')}
                tooltip={t('amend.triggerOrdPxIncrementTooltip')}
                value={formTriggerPxInc}
                defaultValue="0"
                placeholder="0"
                onChange={setFormTriggerPxInc}
                step="any"
                allowPercent
              />
            )}

            {formTpSlType === 'tp_sl' ? (
              <>
                <NumberInput
                  label={t('amend.tpRangePoints')}
                  tooltip={t('amend.tpRangeTooltip')}
                  value={formTpOrdPxInc}
                  defaultValue="-1"
                  placeholder="-1"
                  onChange={setFormTpOrdPxInc}
                  min={-1}
                  step="any"
                  allowPercent
                  disabled={(currentExchange === 'BINANCE' || currentExchange === 'Binance') && !isSpot}
                />
                <NumberInput
                  label={t('amend.slRangePoints')}
                  tooltip={t('amend.slRangeTooltip')}
                  value={formSlOrdPxInc}
                  defaultValue="-1"
                  placeholder="-1"
                  onChange={setFormSlOrdPxInc}
                  min={-1}
                  step="any"
                  allowPercent
                  disabled={(currentExchange === 'BINANCE' || currentExchange === 'Binance') && !isSpot}
                />
              </>
            ) : (
              <>
                <NumberInput
                  label={t('amend.callbackRatioSpreadIncrement')}
                  tooltip={t('amend.callbackRatioSpreadIncrementTooltip')}
                  value={formCallbackRatioSpread}
                  defaultValue="0"
                  placeholder="0"
                  onChange={setFormCallbackRatioSpread}
                  step="any"
                  allowPercent
                />
                <NumberInput
                  label={t('amend.activationPxIncrement')}
                  tooltip={t('amend.activationPxTooltip')}
                  value={formActivePx}
                  defaultValue="-1"
                  placeholder="-1"
                  onChange={setFormActivePx}
                  step="any"
                  allowPercent
                />
                <NumberInput
                  label={t('amend.slRangePoints')}
                  tooltip={t('amend.slRangeTooltip')}
                  value={formSlOrdPxInc}
                  defaultValue="-1"
                  placeholder="-1"
                  onChange={setFormSlOrdPxInc}
                  min={-1}
                  step="any"
                  allowPercent
                  disabled={(currentExchange === 'BINANCE' || currentExchange === 'Binance') && !isSpot}
                />
              </>
            )}
          </>
        )}

        {(formOrderType === 'conditional' || formOrderType === 'oco' || formOrderType === 'move_order_stop') && (
          <>
            <NumberInput
              label={formOrderType === 'move_order_stop' ? t('amend.callbackRatioIncrement') : t('amend.tpIncrementPoints')}
              tooltip={formOrderType === 'move_order_stop'
                ? t('amend.callbackRatioTooltip')
                : t('amend.tpIncrementTooltip')}
              value={formTpPxInc}
              defaultValue="0"
              placeholder="0"
              onChange={setFormTpPxInc}
              step="any"
              allowPercent
            />
            <NumberInput
              label={formOrderType === 'move_order_stop' ? t('amend.activationPxIncrement') : t('amend.slIncrementPoints')}
              tooltip={formOrderType === 'move_order_stop' ? t('amend.activationPxTooltip') : t('amend.slIncrementTooltip')}
              value={formSlPxInc}
              defaultValue="0"
              placeholder="0"
              onChange={setFormSlPxInc}
              step="any"
              allowPercent
            />
          </>
        )}

        <FormulaPriceField
          label={t('amend.newContractSize')}
          tooltip={t('amend.newContractSizeTooltip')}
          value={formNewContractSize}
          placeholder="1 / =sz+10"
          onChange={setFormNewContractSize}
          allowPercent
        />
      </div>

      <Switch
        checked={!formTestMode}
        onChange={(val) => setFormTestMode(!val)}
        label={t('amend.liveMode')}
        descriptionOn={t('amend.liveModeOn')}
        descriptionOff={t('amend.liveModeOff')}
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
        icon={Edit3}
        iconColor="text-brand-blue"
        title={preFill?.orderType ? t('order.batchAmend') : t('nav.amend')}
        subtitle={t('amend.ui.subtitle')}
        addLabel={t('amend.newConfig')}
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
            title={selectedConfigId ? `${t('amend.execLog')} - ${configs.find(c => c.id === selectedConfigId)?.name || ''}` : t('amend.execLog')}
            icon="edit"
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
          <Spinner size="lg" label={t('amend.loadingConfigs')} className="text-brand-yellow" />
        ) : configs.length === 0 ? (
          <EmptyConfigs label={t('amend.noConfigs')} onAdd={openNew} />
        ) : (
          configs.map((cfg) => (
            <div key={cfg.id}>
              <ConfigCard
                instId={cfg.inst_id}
                name={cfg.name || t('amend.unnamedConfig')}
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
