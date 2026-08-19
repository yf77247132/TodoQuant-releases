import DashedHint from '../ui/DashedHint'
import { Spinner } from '../ui/Spinner'
import React, { useState, useMemo, memo, useCallback, useEffect, useRef, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { FilePlus2, ListChecks } from 'lucide-react';
import Switch from '../ui/Switch.tsx';
import AccountSelect from '../ui/AccountSelect.tsx';
import Select from '../ui/Select.tsx';
import NumberInput from '../ui/NumberInput.tsx';
import FormulaPriceField from '../ui/FormulaPriceField.tsx';
import InstrumentInput from '../ui/InstrumentInput.tsx';
import LogViewer from '../ui/LogViewer.tsx';
import ConfigCard from '../ui/ConfigCard.tsx';
import ConfigListLayout, { EmptyConfigs } from '../ui/ConfigListLayout.tsx';
import ConfigModal from '../ui/ConfigModal.tsx';
import ConfigHeader from '../ui/ConfigHeader.tsx';
import { Tooltip } from '../ui/Tooltip.tsx';
import ConfigSummaryRender, { DescSegment } from '../ui/ConfigSummaryRender.tsx';
import BatchActionBar from '../ui/BatchActionBar.tsx';
import Button from '../ui/Button.tsx';
import { useConfigManager } from '../hooks/useConfigManager.ts';
import { useConfigModalForm } from '../hooks/useConfigModalForm.ts';
import { createModuleSaveHandlers } from '../lib/moduleSaveHandlers.ts';
import type { LogEntry } from '../types/logs.ts';
import type { ModuleConfig } from '../types/strategy.ts';
import type { Position } from '../types/trading.ts';
import type { AppConfig } from '../types/index.ts';
import { filterOrderTypesByContext, getOrderTypeLabel } from '../constants/orderTypes.ts';
import { PLACE_PRESET_GROUPS, findPreset } from '../constants/placePresets.ts';
import { getAccountNameFromConfig } from '../lib/resolveAccount.ts';
import { formulaNeedsVar, isFormula } from '../lib/priceFormula.ts';
import { useShortcutKeyConflict } from '../hooks/useShortcutKeyConflict.ts';
import ShortcutKeyInput from '../ui/ShortcutKeyInput.tsx';
import { LABEL_BASE } from '../ui/inputStyles.ts';

export interface PlaceConfigItem extends ModuleConfig {
  id: string;
  name: string;
  inst_id: string;
  account_id: string;
  order_type: string;
  side: string;
  pos_side: string;
  td_mode: string;
  tgt_ccy: string;
  order_direction: string;
  first_order_price: string;
  order_interval: string;
  order_count: string;
  contract_size: string;
  take_profit_margin: string;
  stop_loss_margin: string;
  first_tp_price: string;
  first_sl_price: string;
  chase_val: string;
  tp_sl_type: string;
  callback_ratio_spread: string;
  active_px: string;
  place_test_mode: boolean;
  skip_duplicate_orders: boolean;
}

interface PlaceModuleProps {
  config: Partial<AppConfig>;
  logs: LogEntry[];
  onClearLogs: () => void;
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  showToast: (message: string, type: 'success' | 'error') => void;
  serverTimezone?: string;
  isActive?: boolean;
  positions?: Position[];
}

interface PlaceFormState {
  name: string;
  inst_id: string;
  account_id: string;
  order_type: string;
  side: string;
  pos_side: string;
  td_mode: string;
  tgt_ccy: string;
  order_direction: string;
  first_order_price: string;
  take_profit_margin: string;
  stop_loss_margin: string;
  first_tp_price: string;
  first_sl_price: string;
  chase_val: string;
  tp_sl_type: string;
  callback_ratio_spread: string;
  active_px: string;
  order_interval: string;
  order_count: string;
  contract_size: string;
  place_test_mode: boolean;
  skip_duplicate_orders: boolean;
  shortcut_key: string;
}

function createEmptyPlaceForm(): PlaceFormState {
  return {
    name: '',
    inst_id: 'BTC-USDT-SWAP',
    account_id: '',
    order_type: 'limit',
    side: 'buy',
    pos_side: 'net',
    td_mode: 'cross',
    tgt_ccy: 'base_ccy',
    order_direction: 'up',
    first_order_price: '10000',
    take_profit_margin: '-1',
    stop_loss_margin: '-1',
    first_tp_price: '10000',
    first_sl_price: '100000',
    chase_val: '0',
    tp_sl_type: 'tp_sl',
    callback_ratio_spread: '1%',
    active_px: '10000',
    order_interval: '1000',
    order_count: '5',
    contract_size: '1',
    place_test_mode: true,
    skip_duplicate_orders: false,
    shortcut_key: '',
  };
}

type PlaceFormAction =
  | { type: 'SET'; field: keyof PlaceFormState; value: PlaceFormState[keyof PlaceFormState] }
  | { type: 'MERGE'; patch: Partial<PlaceFormState> }
  | { type: 'REPLACE'; form: PlaceFormState };

function placeFormReducer(state: PlaceFormState, action: PlaceFormAction): PlaceFormState {
  switch (action.type) {
    case 'SET':
      return { ...state, [action.field]: action.value } as PlaceFormState;
    case 'MERGE':
      return { ...state, ...action.patch };
    case 'REPLACE':
      return action.form;
  }
}

const isRegularOrder = (t: string) => ['market', 'limit', 'post_only', 'fok', 'ioc'].includes(t);
const isTrigger = (t: string) => t === 'trigger';
const isConditional = (t: string) => t === 'conditional';
const isOCO = (t: string) => t === 'oco';
const isChase = (t: string) => t === 'chase';
const isMoveOrderStop = (t: string) => t === 'move_order_stop';

export function buildPlaceDescSegments(
  cfg: PlaceConfigItem,
  accountNames: Record<number, string>,
  _accountColors: Record<number, string>,
  accounts: Array<{ id: string; name: string }> = [],
  t: (key: string) => string = (k) => k
): DescSegment[] {
  const accountName = getAccountNameFromConfig(cfg, accountNames, accounts, t);
  const instLabel = cfg.inst_id || t('place.desc.all');
  const typeLabel = t(getOrderTypeLabel(cfg.order_type));
  const sideLabel = cfg.side === 'buy' ? t('place.value.buy') : t('place.value.sell');
  const posSideText = cfg.pos_side === 'net' ? t('place.value.posSideNet') : (cfg.pos_side === 'long' ? t('place.value.posSideLong') : t('place.value.posSideShort'));
  const tdModeText = cfg.td_mode === 'cash' ? t('place.value.tdModeCash') : (cfg.td_mode === 'cross' ? t('place.value.tdModeCross') : t('place.value.tdModeIsolated'));
  const directionText = cfg.order_direction === 'up' ? t('place.value.directionUp') : t('place.value.directionDown');

  const segs: DescSegment[] = [
    { label: t('place.desc.account'), value: accountName },
    { label: t('place.desc.instId'), value: instLabel },
    { label: t('place.desc.posSide'), value: posSideText, style: cfg.pos_side === 'long' ? 'green' : (cfg.pos_side === 'short' ? 'red' : 'value') },
    { label: t('place.desc.tdMode'), value: tdModeText },
    { label: t('place.desc.orderDirection'), value: directionText },
    { label: t('place.desc.orderType'), value: typeLabel },
    { label: t('place.desc.side'), value: sideLabel, style: sideLabel === t('place.value.buy') ? 'green' : 'red' },
  ];

  const isMoveStop = cfg.tp_sl_type === 'move_stop';
  if (isRegularOrder(cfg.order_type)) {
    if (cfg.order_type !== 'market') {
      segs.push({ label: t('place.desc.orderPrice'), value: cfg.first_order_price });
    }
    if (isMoveStop) {
      if (cfg.callback_ratio_spread && cfg.callback_ratio_spread !== '-1') segs.push({ label: t('place.desc.callbackRatioSpread'), value: cfg.callback_ratio_spread });
      if (cfg.active_px !== '-1') segs.push({ label: t('place.desc.activePx'), value: cfg.active_px });
    } else {
      if (cfg.take_profit_margin !== '-1') segs.push({ label: t('place.desc.takeProfit'), value: cfg.take_profit_margin });
    }
    if (cfg.stop_loss_margin !== '-1') segs.push({ label: t('place.desc.stopLoss'), value: cfg.stop_loss_margin });
  }
  if (isTrigger(cfg.order_type)) {
    segs.push({ label: t('place.desc.triggerPrice'), value: cfg.first_order_price });
    if (isMoveStop) {
      if (cfg.callback_ratio_spread && cfg.callback_ratio_spread !== '-1') segs.push({ label: t('place.desc.callbackRatioSpread'), value: cfg.callback_ratio_spread });
      if (cfg.active_px !== '-1') segs.push({ label: t('place.desc.activePx'), value: cfg.active_px });
    } else {
      if (cfg.take_profit_margin !== '-1') segs.push({ label: t('place.desc.takeProfit'), value: cfg.take_profit_margin });
    }
    if (cfg.stop_loss_margin !== '-1') segs.push({ label: t('place.desc.stopLoss'), value: cfg.stop_loss_margin });
  }
  if (isConditional(cfg.order_type)) {
    if (cfg.first_tp_price !== '-1') segs.push({ label: t('place.desc.orderPrice'), value: cfg.first_tp_price });
  }
  if (isOCO(cfg.order_type)) {
    if (cfg.first_tp_price !== '-1') segs.push({ label: t('place.desc.tpPrice'), value: cfg.first_tp_price });
    if (cfg.first_sl_price !== '-1') segs.push({ label: t('place.desc.slPrice'), value: cfg.first_sl_price });
  }
  if (isChase(cfg.order_type) && cfg.chase_val !== '-1') {
    segs.push({ label: t('place.desc.chaseVal'), value: cfg.chase_val });
  }
  if (isMoveOrderStop(cfg.order_type)) {
    if (cfg.callback_ratio_spread && cfg.callback_ratio_spread !== '-1') segs.push({ label: t('place.desc.callbackRatioSpread'), value: cfg.callback_ratio_spread });
    if (cfg.active_px !== '-1') segs.push({ label: t('place.desc.activePx'), value: cfg.active_px });
  }

  segs.push({ label: t('place.desc.interval'), value: cfg.order_interval });
  segs.push({ label: t('place.desc.orderCount'), value: cfg.order_count });
  segs.push({ label: t('place.desc.contractSize'), value: cfg.contract_size });
  segs.push({ label: t('place.desc.testMode'), value: !cfg.place_test_mode ? t('place.value.on') : t('place.value.off'), style: !cfg.place_test_mode ? 'yellow-on' : 'gray-off' });
  segs.push({ label: t('place.desc.skipDuplicate'), value: cfg.skip_duplicate_orders ? t('place.value.on') : t('place.value.off'), style: cfg.skip_duplicate_orders ? 'yellow-on' : 'gray-off' });

  return segs;
}

export function buildPlaceDescText(segments: DescSegment[]): string {
  return segments.map(s => `${s.label}: ${s.value}`).join(', ');
}

const ConfigDescription = memo(({ cfg, accountNames, accountColors, accounts, t }: {
  cfg: PlaceConfigItem;
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  accounts: Array<{ id: string; name: string }>;
  t: (key: string) => string;
}) => {
  const accountId = cfg.account_id || '';
  const accIdx = accounts.findIndex(a => a.id === accountId);
  const accountColor = accIdx >= 0 ? accountColors[accIdx] : undefined;
  const segments = buildPlaceDescSegments(cfg, accountNames, accountColors, accounts, t);

  return (
    <ConfigSummaryRender 
      segments={segments} 
      accountColor={accountColor} 
    />
  );
});

ConfigDescription.displayName = 'ConfigDescription';

const OrderPreviewPanel = memo(({ orders, t }: {
  orders: Array<Record<string, number | string | null>>;
  t: (key: string) => string;
}) => {
  if (!orders.length) {
    return (
      <div className="text-3xs text-text-muted text-center py-4">
        {t('place.preview.noData')}
      </div>
    );
  }

  const hasPrice = orders.some(o => o.price != null);
  const hasActivePx = orders.some(o => o.activePx != null);
  const hasTpPrice = orders.some(o => o.tpPrice != null);
  const hasSlPrice = orders.some(o => o.slPrice != null);
  const hasCallback = orders.some(o => o.callbackRatio != null || o.callbackSpread != null);
  const hasChaseVal = orders.some(o => o.chaseVal != null);
  const hasSize = orders.some(o => o.size != null);

  return (
    <div className="space-y-2">
      <div className="text-3xs font-bold text-text-tertiary uppercase tracking-wider">
        {t('place.preview.title')}
      </div>
      <div>
        <table className="w-full text-2xs border-collapse">
          <thead>
            <tr className="border-b border-border-default">
              <th className="py-1 px-1 text-left text-white/40 font-medium w-5">#</th>
              {hasPrice && <th className="py-1 px-1 text-right text-white/40 font-medium">{t('place.preview.orderPriceShort')}</th>}
              {hasCallback && <th className="py-1 px-1 text-right text-white/40 font-medium">{t('place.preview.callbackShort')}</th>}
              {hasActivePx && <th className="py-1 px-1 text-right text-white/40 font-medium">{t('place.preview.activePxShort')}</th>}
              {hasTpPrice && <th className="py-1 px-1 text-right text-white/40 font-medium">{t('place.preview.tpPriceShort')}</th>}
              {hasSlPrice && <th className="py-1 px-1 text-right text-white/40 font-medium">{t('place.preview.slPriceShort')}</th>}
              {hasChaseVal && <th className="py-1 px-1 text-right text-white/40 font-medium">{t('place.preview.chaseValShort')}</th>}
              {hasSize && <th className="py-1 px-1 text-right text-white/40 font-medium">{t('place.preview.contractSizeShort')}</th>}
            </tr>
          </thead>
          <tbody>
            {orders.map((o, idx) => (
              <tr key={o.num} className={`${idx % 2 === 0 ? 'bg-surface-1' : ''} hover:bg-white/[0.05]`}>
                <td className="py-1 px-1 text-white/50 font-medium">{o.num}</td>
                {hasPrice && <td className="py-1 px-1 text-right font-mono text-white/90 whitespace-nowrap">{o.price ?? '-'}</td>}
                {hasCallback && <td className="py-1 px-1 text-right font-mono text-white/90 whitespace-nowrap">
                  {o.callbackRatio != null
                    ? (() => {
                        const pct = (o.callbackRatio as number) * 100;
                        if (pct >= 1) return pct.toFixed(1) + '%';
                        return parseFloat(pct.toFixed(3)) + '%';
                      })()
                    : o.callbackSpread != null ? o.callbackSpread : '-'}
                </td>}
                {hasActivePx && <td className="py-1 px-1 text-right font-mono text-white/90 whitespace-nowrap">{o.activePx ?? '-'}</td>}
                {hasTpPrice && <td className="py-1 px-1 text-right font-mono text-trade-green/90 whitespace-nowrap">{o.tpPrice ?? '-'}</td>}
                {hasSlPrice && <td className="py-1 px-1 text-right font-mono text-trade-red/90 whitespace-nowrap">{o.slPrice ?? '-'}</td>}
                {hasChaseVal && <td className="py-1 px-1 text-right font-mono text-white/90 whitespace-nowrap">{o.chaseVal ?? '-'}</td>}
                {hasSize && <td className="py-1 px-1 text-right font-mono text-white/90 whitespace-nowrap">{o.size ?? '-'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
OrderPreviewPanel.displayName = 'OrderPreviewPanel';

export default React.memo(function PlaceModule({
  config,
  logs,
  onClearLogs,
  accountNames,
  accountColors,
  showToast: onShowToast,
  serverTimezone,
  isActive = true,
  positions = [],
}: PlaceModuleProps) {
  const { t } = useTranslation();
  const accounts = useMemo(() => (config.accounts || []) as Array<{ id: string; name: string }>, [config.accounts]);
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
  } = useConfigManager<PlaceConfigItem>({
    moduleName: 'place',
    apiPrefix: '/api/trader',
    onShowToast: onShowToast,
    toRequestBody: (form) => ({
      name: form.name ?? '',
      inst_id: form.inst_id ?? '',
      account_id: form.account_id ?? '',
      order_type: form.order_type ?? 'limit',
      side: form.side ?? 'buy',
      pos_side: form.pos_side ?? 'net',
      td_mode: form.td_mode ?? 'cross',
      tgt_ccy: form.tgt_ccy ?? 'base_ccy',
      order_direction: form.order_direction ?? 'up',
      first_order_price: form.first_order_price ?? '10000',
      order_interval: form.order_interval ?? '1000',
      order_count: form.order_count ?? '5',
      contract_size: form.contract_size ?? '1',
      take_profit_margin: form.take_profit_margin ?? '-1',
      stop_loss_margin: form.stop_loss_margin ?? '-1',
      first_tp_price: form.first_tp_price || '10000',
      first_sl_price: form.first_sl_price || '100000',
      chase_val: form.chase_val ?? '0',
      tp_sl_type: form.tp_sl_type ?? 'tp_sl',
      callback_ratio_spread: form.callback_ratio_spread ?? (form.callback_spread && form.callback_spread !== '-1' ? form.callback_spread : (form.callback_ratio || '1%')),
      active_px: form.active_px ?? '10000',
      place_test_mode: form.place_test_mode ?? true,
      skip_duplicate_orders: form.skip_duplicate_orders ?? false,
      shortcut_key: form.shortcut_key ?? '',
    }),
  });

  const [selectedPresetId, setSelectedPresetId] = useState('');

  const {
    editingId,
    setEditingId,
    showModal,
    setShowModal,
    statusMsg,
    setStatusMsg,
    openNew: hookOpenNew,
    closeModal: hookCloseModal,
  } = useConfigModalForm<PlaceFormState>({
    createEmptyForm: createEmptyPlaceForm,
    onAfterClear: () => setSelectedPresetId(''),
  });

  const [form, formDispatch] = useReducer(placeFormReducer, undefined, createEmptyPlaceForm);
  const closeModal = hookCloseModal;
  const openNew = useCallback(() => {
    formDispatch({ type: 'REPLACE', form: createEmptyPlaceForm() });
    hookOpenNew();
  }, [hookOpenNew]);

  const formName = form.name;
  const formInstId = form.inst_id;
  const formAccountId = form.account_id;
  const formOrderType = form.order_type;
  const formSide = form.side;
  const formPosSide = form.pos_side;
  const formTdMode = form.td_mode;
  const formOrderDirection = form.order_direction;
  const formFirstOrderPrice = form.first_order_price;
  const formTakeProfitMargin = form.take_profit_margin;
  const formStopLossMargin = form.stop_loss_margin;
  const formFirstTpPrice = form.first_tp_price;
  const formFirstSlPrice = form.first_sl_price;
  const formChaseVal = form.chase_val;
  const formTpSlType = form.tp_sl_type;
  const formCallbackRatioSpread = form.callback_ratio_spread;
  const formActivePx = form.active_px;
  const formOrderInterval = form.order_interval;
  const formOrderCount = form.order_count;
  const formContractSize = form.contract_size;
  const formTestMode = form.place_test_mode;
  const formSkipDuplicate = form.skip_duplicate_orders;

  const setFormName = useCallback((value: string) => formDispatch({ type: 'SET', field: 'name', value }), [formDispatch]);
  const setFormInstId = useCallback((value: string) => formDispatch({ type: 'SET', field: 'inst_id', value }), [formDispatch]);
  const setFormAccountId = useCallback((value: string) => formDispatch({ type: 'SET', field: 'account_id', value }), [formDispatch]);
  const setFormOrderType = useCallback((value: string) => formDispatch({ type: 'SET', field: 'order_type', value }), [formDispatch]);
  const setFormSide = useCallback((value: string) => formDispatch({ type: 'SET', field: 'side', value }), [formDispatch]);
  const setFormPosSide = useCallback((value: string) => formDispatch({ type: 'SET', field: 'pos_side', value }), [formDispatch]);
  const setFormTdMode = useCallback((value: string) => formDispatch({ type: 'SET', field: 'td_mode', value }), [formDispatch]);
  const setFormOrderDirection = useCallback((value: string) => formDispatch({ type: 'SET', field: 'order_direction', value }), [formDispatch]);
  const setFormFirstOrderPrice = useCallback((value: string) => formDispatch({ type: 'SET', field: 'first_order_price', value }), [formDispatch]);
  const setFormTakeProfitMargin = useCallback((value: string) => formDispatch({ type: 'SET', field: 'take_profit_margin', value }), [formDispatch]);
  const setFormStopLossMargin = useCallback((value: string) => formDispatch({ type: 'SET', field: 'stop_loss_margin', value }), [formDispatch]);
  const setFormFirstTpPrice = useCallback((value: string) => formDispatch({ type: 'SET', field: 'first_tp_price', value }), [formDispatch]);
  const setFormFirstSlPrice = useCallback((value: string) => formDispatch({ type: 'SET', field: 'first_sl_price', value }), [formDispatch]);
  const setFormChaseVal = useCallback((value: string) => formDispatch({ type: 'SET', field: 'chase_val', value }), [formDispatch]);
  const setFormTpSlType = useCallback((value: string) => formDispatch({ type: 'SET', field: 'tp_sl_type', value }), [formDispatch]);
  const setFormCallbackRatioSpread = useCallback((value: string) => formDispatch({ type: 'SET', field: 'callback_ratio_spread', value }), [formDispatch]);
  const setFormActivePx = useCallback((value: string) => formDispatch({ type: 'SET', field: 'active_px', value }), [formDispatch]);
  const setFormOrderInterval = useCallback((value: string) => formDispatch({ type: 'SET', field: 'order_interval', value }), [formDispatch]);
  const setFormOrderCount = useCallback((value: string) => formDispatch({ type: 'SET', field: 'order_count', value }), [formDispatch]);
  const setFormContractSize = useCallback((value: string) => formDispatch({ type: 'SET', field: 'contract_size', value }), [formDispatch]);
  const setFormTestMode = useCallback((value: boolean) => formDispatch({ type: 'SET', field: 'place_test_mode', value }), [formDispatch]);
  const setFormSkipDuplicate = useCallback((value: boolean) => formDispatch({ type: 'SET', field: 'skip_duplicate_orders', value }), [formDispatch]);

  const [pricePreviews, setPricePreviews] = useState<Record<string, { text: string; error?: boolean }>>({});
  const firstOrderPriceValRef = useRef<number | null>(null);

  const findPositionSize = useCallback((): number | undefined => {
    if (!positions.length || !formAccountId || !formInstId) return undefined;
    const posSide = formPosSide;
    const tdMode = formTdMode;
    const matched = positions.find(p => {
      if (p._accountId !== formAccountId) return false;
      if (p.instId !== formInstId) return false;
      if (p.posSide !== posSide) return false;
      if (tdMode !== 'cash' && p.mgnMode && p.mgnMode !== tdMode) return false;
      return true;
    });
    if (!matched) return undefined;
    const pos = parseFloat(matched.pos);
    return Number.isFinite(pos) ? pos : undefined;
  }, [positions, formAccountId, formInstId, formPosSide, formTdMode]);

  const fetchFormulaPreview = useCallback(async (fieldName: string, value: string, silent = false, extraVars?: Record<string, number>) => {
    if (!value?.startsWith('=')) {
      setPricePreviews(prev => {
        if (!prev[fieldName]) return prev;
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
      return;
    }
    try {
      const needsO = formulaNeedsVar(value, 'o');
      const needsM = formulaNeedsVar(value, 'm');
      const needsS = formulaNeedsVar(value, 's');

      let orderPrice: number | undefined;
      const fieldsSupportO = ['active_px', 'first_tp_price', 'first_sl_price', 'contract_size'];
      if (needsO && !fieldsSupportO.includes(fieldName)) {
        setPricePreviews(prev => ({
          ...prev,
          [fieldName]: { text: t('formula.error.O_NOT_SUPPORTED'), error: true },
        }));
        return;
      }
      if (needsO) {
        if (firstOrderPriceValRef.current !== null) {
          orderPrice = firstOrderPriceValRef.current;
        } else {
          const raw = formFirstOrderPrice;
          if (raw && !raw.startsWith('=')) {
            orderPrice = parseFloat(raw);
          }
        }
      }

      let positionSize: number | undefined;
      if (needsS) {
        positionSize = findPositionSize();
        if (positionSize === undefined) {
          setPricePreviews(prev => ({
            ...prev,
            [fieldName]: { text: t('formula.error.MISSING_POSITION'), error: true },
          }));
          return;
        }
      }

      const body: Record<string, any> = { formula: value };
      if (needsM && formInstId) {
        body.instId = formInstId;
      }
      if (orderPrice !== undefined) {
        body.orderPrice = orderPrice;
      }
      if (positionSize !== undefined) {
        body.positionSize = positionSize;
      }
      if (extraVars) {
        Object.assign(body, extraVars);
      }

      const res = await fetch('/api/evaluate-formula', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok && data.preview) {
        setPricePreviews(prev => ({
          ...prev,
          [fieldName]: { text: data.preview, error: false },
        }));
        if (fieldName === 'first_order_price' && typeof data.result === 'number') {
          firstOrderPriceValRef.current = data.result;
        }
      } else if (!silent) {
        let errorMsg: string;
        if (data.errorCode) {
          const i18nKey = `formula.error.${data.errorCode}`;
          errorMsg = data.error ? t(i18nKey, { var: data.error }) : t(i18nKey);
        } else if (data.error) {
          errorMsg = data.error;
        } else {
          errorMsg = data.preview || t('formula.error.previewUnavailable');
        }
        setPricePreviews(prev => ({
          ...prev,
          [fieldName]: { text: errorMsg, error: true },
        }));
      }
    } catch {
      if (!silent) {
        setPricePreviews(prev => ({
          ...prev,
          [fieldName]: { text: t('formula.error.requestFailed'), error: true },
        }));
      }
    }
  }, [formInstId, formFirstOrderPrice, findPositionSize, t]);

  const pollTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const fetchPreviewRef = useRef(fetchFormulaPreview);
  fetchPreviewRef.current = fetchFormulaPreview;
  const formRef = useRef(form);
  formRef.current = form;
  const POLL_INTERVAL_MS = 3000;

  const stopPollPreview = useCallback((fieldName: string) => {
    if (pollTimersRef.current[fieldName]) {
      clearInterval(pollTimersRef.current[fieldName]);
      delete pollTimersRef.current[fieldName];
    }
  }, []);

  const startPollPreview = useCallback((fieldName: string) => {
    stopPollPreview(fieldName);
    const timer = setInterval(() => {
      const val = (formRef.current as any)[fieldName];
      if (val && val.startsWith('=')) {
        fetchPreviewRef.current(fieldName, val, true);
      }
    }, POLL_INTERVAL_MS);
    pollTimersRef.current[fieldName] = timer;
  }, [stopPollPreview]);

  const handleFormulaBlur = useCallback((fieldName: string) => {
    fetchFormulaPreview(fieldName, (formRef.current as any)[fieldName]);
    startPollPreview(fieldName);
  }, [fetchFormulaPreview, startPollPreview]);

  const handlePresetChange = useCallback((presetId: string) => {
    setSelectedPresetId(presetId);
    if (!presetId) return;
    const preset = findPreset(presetId);
    if (!preset) return;
    const values = preset.generate();
    formDispatch({ type: 'MERGE', patch: Object.fromEntries(
      Object.entries(values).filter(([_, v]) => v !== undefined)
    ) as Partial<PlaceFormState> });
    setTimeout(() => {
      const formulaFields = ['first_order_price', 'order_interval', 'contract_size', 'first_tp_price', 'first_sl_price', 'active_px'];
      for (const field of formulaFields) {
        const val = values[field as keyof typeof values];
        if (val && val.startsWith('=')) {
          fetchPreviewRef.current(field, val);
          startPollPreview(field);
        }
      }
    }, 50);
  }, [formDispatch, startPollPreview]);

  const handleFormulaFocus = useCallback((fieldName: string) => {
    stopPollPreview(fieldName);
  }, [stopPollPreview]);

  useEffect(() => {
    if (!formInstId) return;
    const formulaFields = ['first_order_price', 'first_tp_price', 'first_sl_price', 'active_px', 'order_interval', 'contract_size'];
    for (const field of formulaFields) {
      const val = (formRef.current as any)[field];
      if (val && val.startsWith('=')) {
        fetchFormulaPreview(field, val, true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formInstId]);

  useEffect(() => {
    if (!showModal) {
      Object.keys(pollTimersRef.current).forEach(stopPollPreview);
    } else {
      const formulaFields = ['first_order_price', 'first_tp_price', 'first_sl_price', 'active_px', 'order_interval', 'contract_size'];
      for (const field of formulaFields) {
        const val = (formRef.current as any)[field];
        if (val && val.startsWith('=')) {
          fetchFormulaPreview(field, val, true);
          startPollPreview(field);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal]);

  useEffect(() => {
    if (!showModal) return;
    const fieldsToRefresh: string[] = [];
    for (const field of ['active_px', 'contract_size']) {
      const val = (formRef.current as any)[field];
      if (val && isFormula(val) && formulaNeedsVar(val, 'o')) {
        fieldsToRefresh.push(field);
      }
    }
    for (const field of fieldsToRefresh) {
      fetchFormulaPreview(field, (formRef.current as any)[field], true);
    }
  }, [formFirstOrderPrice, showModal, fetchFormulaPreview]);

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

  const [previewOrders, setPreviewOrders] = useState<Array<Record<string, number | string | null>>>([]);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPreviewOrders = useCallback(() => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(async () => {
      try {
        const posSize = findPositionSize();
        const res = await fetch('/api/preview-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instId: formInstId || 'BTC-USDT-SWAP',
            orderType: formOrderType,
            side: formSide,
            orderDirection: formOrderDirection,
            firstOrderPrice: formFirstOrderPrice,
            orderInterval: formOrderInterval,
            orderCount: formOrderCount,
            contractSize: formContractSize,
            takeProfitMargin: formTakeProfitMargin,
            stopLossMargin: formStopLossMargin,
            firstTpPrice: formFirstTpPrice,
            firstSlPrice: formFirstSlPrice,
            activePx: formActivePx,
            tpSlType: formTpSlType,
            callbackRatioSpread: formCallbackRatioSpread,
            chaseVal: formChaseVal,
            positionSize: posSize,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          setPreviewOrders(data.orders || []);
        }
      } catch {
      }
    }, 300);
  }, [formInstId, formOrderType, formSide, formOrderDirection, formFirstOrderPrice, formOrderInterval, formOrderCount, formContractSize, formTakeProfitMargin, formStopLossMargin, formFirstTpPrice, formFirstSlPrice, formActivePx, formTpSlType, formCallbackRatioSpread, formChaseVal, findPositionSize]);

  useEffect(() => {
    if (showModal) fetchPreviewOrders();
  }, [showModal, fetchPreviewOrders]);

  useEffect(() => {
    if (!showModal) setPreviewOrders([]);
  }, [showModal]);

  const currentAccount = useMemo(() => 
    accounts.find(a => a.id === formAccountId) as { id: string; name: string; exchange?: string } | undefined, 
    [accounts, formAccountId]
  );
  
  const currentExchange = currentAccount?.exchange?.toUpperCase() || 'OKX';
  const isSpot = useMemo(() => {
    if (!formInstId) return false;
    const upper = formInstId.toUpperCase();
    return !upper.includes('SWAP') && !upper.includes('PERP') && !upper.includes('FUTURES');
  }, [formInstId]);

  const filteredOrderTypeOptions = useMemo(() => {
    return filterOrderTypesByContext(currentExchange, isSpot, formTdMode);
  }, [currentExchange, isSpot, formTdMode]);

  React.useEffect(() => {
    if (showModal && !filteredOrderTypeOptions.some(o => o.value === formOrderType)) {
      setFormOrderType('limit');
    }
  }, [filteredOrderTypeOptions, formOrderType, showModal, setFormOrderType]);

  React.useEffect(() => {
    if (showModal && !isSpot && formTdMode === 'cash') {
      setFormTdMode('cross');
    }
  }, [isSpot, formTdMode, showModal, setFormTdMode]);

  React.useEffect(() => {
    if (showModal && isSpot && formTpSlType === 'move_stop') {
      formDispatch({ type: 'MERGE', patch: { tp_sl_type: 'tp_sl', callback_ratio_spread: '1%', active_px: '10000' } });
    }
  }, [isSpot, formTpSlType, showModal]);

  const filteredLogs = useMemo(() => getFilteredLogs(logs), [logs, getFilteredLogs]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { action, configId: evtConfigId, moduleKey } = (e as CustomEvent).detail || {};
      if (moduleKey !== 'place') return;
      if (action === 'new') {
        openNew();
      } else if (action === 'edit' && evtConfigId) {
        const cfg = configs.find(c => c.id === evtConfigId);
        if (cfg) openEdit(cfg as PlaceConfigItem);
      }
    };
    window.addEventListener('open-config-modal', handler);
    return () => window.removeEventListener('open-config-modal', handler);
  }, [openNew, configs]); // eslint-disable-line react-hooks/exhaustive-deps

  const openEdit = (cfg: PlaceConfigItem) => {
    setEditingId(cfg.id);
    formDispatch({ type: 'REPLACE', form: {
      name: cfg.name,
      inst_id: cfg.inst_id || '',
      account_id: (cfg.account_id && accounts.find(a => a.id === cfg.account_id)) ? cfg.account_id : (accounts[0]?.id || ''),
      order_type: cfg.order_type || 'limit',
      side: cfg.side || 'buy',
      pos_side: cfg.pos_side || 'net',
      td_mode: cfg.td_mode || 'cross',
      tgt_ccy: cfg.tgt_ccy || 'base_ccy',
      order_direction: cfg.order_direction || 'up',
      first_order_price: cfg.first_order_price ?? '10000',
      take_profit_margin: cfg.take_profit_margin ?? '-1',
      stop_loss_margin: cfg.stop_loss_margin ?? '-1',
      first_tp_price: cfg.first_tp_price ?? '-1',
      first_sl_price: cfg.first_sl_price ?? '-1',
      chase_val: cfg.chase_val ?? '0',
      tp_sl_type: cfg.tp_sl_type ?? 'tp_sl',
      callback_ratio_spread: cfg.callback_ratio_spread ?? (cfg.callback_spread && cfg.callback_spread !== '-1' ? cfg.callback_spread : (cfg.callback_ratio || '1%')),
      active_px: cfg.active_px ?? '10000',
      order_interval: cfg.order_interval ?? '1000',
      order_count: cfg.order_count ?? '5',
      contract_size: cfg.contract_size ?? '1',
      place_test_mode: cfg.place_test_mode !== undefined ? cfg.place_test_mode : true,
      skip_duplicate_orders: cfg.skip_duplicate_orders ?? false,
      shortcut_key: cfg.shortcut_key || '',
    } });
    setShowModal(true);
    setStatusMsg('');
  };

  const { handleSaveConfig, handleSaveAndStart } = useMemo(() => createModuleSaveHandlers<PlaceFormState>({
    handleSave,
    handleStart,
    closeModal,
    fetchConfigs,
    buildConfigData: (form: PlaceFormState) => ({
      name: form.name,
      inst_id: form.inst_id,
      account_id: form.account_id,
      order_type: form.order_type,
      side: form.side,
      pos_side: form.pos_side,
      td_mode: form.td_mode,
      tgt_ccy: form.tgt_ccy || 'base_ccy',
      order_direction: form.order_direction,
      first_order_price: form.first_order_price || '10000',
      take_profit_margin: form.take_profit_margin || '-1',
      stop_loss_margin: form.stop_loss_margin || '-1',
      first_tp_price: form.first_tp_price || '-1',
      first_sl_price: form.first_sl_price || '-1',
      chase_val: form.chase_val || '0',
      tp_sl_type: form.tp_sl_type || 'tp_sl',
      callback_ratio_spread: form.callback_ratio_spread || '1%',
      active_px: form.active_px || '10000',
      order_interval: form.order_interval || '1000',
      order_count: form.order_count || '5',
      contract_size: form.contract_size || '1',
      place_test_mode: form.place_test_mode,
      skip_duplicate_orders: form.skip_duplicate_orders,
      shortcut_key: form.shortcut_key || '',
    }),
  }), [handleSave, handleStart, closeModal, fetchConfigs]);

  const configModalProps = {
    open: showModal,
    title: editingId ? t('place.ui.editTitle') : t('place.ui.newTitle'),
    saveLabel: editingId ? t('place.ui.saveUpdate') : t('place.ui.saveConfig'),
    onClose: closeModal,
    onSave: () => handleSaveConfig(form, editingId),
    onSaveAndStart: () => handleSaveAndStart(form, editingId),
    isLive: !formTestMode,
    statusMsg,
    preview: <OrderPreviewPanel orders={previewOrders} t={t} />,
    maxWidth: 'max-w-[707px]',
  };

  const configModalChildren = (
    <>
      <div className="grid grid-cols-[160px_160px] gap-4">
        <div>
          <label className="block text-3xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5">{t('place.form.preset')}</label>
          <Select
            value={selectedPresetId}
            onChange={(e) => handlePresetChange(e.target.value)}
          >
            <option value="">{t('place.form.presetNone')}</option>
            {PLACE_PRESET_GROUPS.map(group => (
              <optgroup key={group.key} label={t(group.key)}>
                {group.presets.map(p => (
                  <option key={p.id} value={p.id}>{t(p.nameKey)}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-3xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5">{t('place.form.configName')}</label>
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder={t('place.form.configNamePlaceholder')}
            className="w-full bg-surface-1 border border-border-default rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-focus-ring focus:ring-1 focus:ring-focus-ring transition-all"
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
              formDispatch({ type: 'SET', field: 'shortcut_key', value: val });
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
          label={t('place.form.instIdLabel')}
          tooltip={t('place.form.instIdTooltip')}
          value={formInstId}
          defaultValue="BTC-USDT-SWAP"
          placeholder="BTC-USDT-SWAP"
          onChange={setFormInstId}
          allowEmpty
        />

        <div className="space-y-2">
          <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Tooltip content={t('place.form.posModeTooltip')}>
              <DashedHint className={`cursor-help ${isSpot ? 'border-gray-600' : ''}`}>
                {t('place.form.posModeLabel')}
              </DashedHint>
            </Tooltip>
          </label>
          <Select
            value={formPosSide}
            onChange={(e) => setFormPosSide(e.target.value)}
            className={
              isSpot
                ? ''
                : formPosSide === 'long'
                  ? '!text-trade-green'
                  : formPosSide === 'short'
                    ? '!text-trade-red'
                    : '!text-text-primary'
            }
            disabled={isSpot}
          >
            <option value="net" className="!text-text-primary">{t('place.option.posSideNet')}</option>
            <option value="long" className="!text-trade-green">{t('place.option.posSideLong')}</option>
            <option value="short" className="!text-trade-red">{t('place.option.posSideShort')}</option>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Tooltip content={t('place.form.tdModeTooltip')}>
              <DashedHint className={`cursor-help ${(currentExchange === 'BINANCE' || currentExchange === 'Binance') && !isSpot ? 'border-gray-600' : ''}`}>
                {t('place.form.tdModeLabel')}
              </DashedHint>
            </Tooltip>
          </label>
          <Select
            value={formTdMode}
            onChange={(e) => setFormTdMode(e.target.value)}
            disabled={(currentExchange === 'BINANCE' || currentExchange === 'Binance') && !isSpot}
          >
            {isSpot && <option value="cash">{t('place.option.tdModeCash')}</option>}
            <option value="cross">{t('place.option.tdModeCross')}</option>
            <option value="isolated">{t('place.option.tdModeIsolated')}</option>
          </Select>
        </div>

        <div className="col-span-2 border-t border-border-default my-1" />

        <div className="space-y-2">
          <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Tooltip content={t('place.form.orderDirectionTooltip')}>
              <DashedHint className="cursor-help">
                {t('place.form.orderDirectionLabel')}
              </DashedHint>
            </Tooltip>
          </label>
          <Select
            value={formOrderDirection}
            onChange={(e) => setFormOrderDirection(e.target.value)}
          >
            <option value="up">{t('place.option.directionUp')}</option>
            <option value="down">{t('place.option.directionDown')}</option>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Tooltip content={t('common.orderTypeMapping')}>
              <DashedHint className="cursor-help">
                {t('place.form.orderTypeLabel')}
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

        {(isRegularOrder(formOrderType) || isTrigger(formOrderType)) && (
          <div className="space-y-2">
            <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Tooltip content={t('place.form.tpSlTypeTooltip')}>
                <DashedHint className="cursor-help">
                  {t('place.form.tpSlTypeLabel')}
                </DashedHint>
              </Tooltip>
            </label>
            <Select
              value={formTpSlType}
              onChange={(e) => setFormTpSlType(e.target.value)}
            >
              <option value="tp_sl">{t('place.option.tpSl')}</option>
              {!isSpot && <option value="move_stop">{t('place.option.moveStop')}</option>}
            </Select>
          </div>
        )}

        {((isRegularOrder(formOrderType) && formOrderType !== 'market') || isTrigger(formOrderType)) && (
          <FormulaPriceField
            label={isTrigger(formOrderType) ? t('place.form.triggerOrOrderPrice') : t('place.form.firstOrderPrice')}
            tooltip={t('place.form.firstOrderPriceFormulaTooltip')}
            value={formFirstOrderPrice}
            placeholder="10000"
            onChange={setFormFirstOrderPrice}
            preview={pricePreviews['first_order_price']?.text ?? null}
            previewError={pricePreviews['first_order_price']?.error ?? false}
            onBlur={() => handleFormulaBlur('first_order_price')}
            onFocus={() => handleFormulaFocus('first_order_price')}
          />
        )}

        {(isRegularOrder(formOrderType) || isTrigger(formOrderType)) && (
          <>
            {formTpSlType === 'tp_sl' ? (
              <NumberInput
                label={t('place.form.tpMarginLabel')}
                tooltip={t('place.form.tpMarginTooltip')}
                value={formTakeProfitMargin}
                defaultValue="-1"
                placeholder="-1"
                onChange={setFormTakeProfitMargin}
                min={-1}
                step="any"
                disabled={(currentExchange === 'BINANCE' || currentExchange === 'Binance') && !isSpot}
                allowPercent
              />
            ) : (
              <>
                <NumberInput
                  label={t('place.form.callbackRatioSpreadLabel')}
                  tooltip={t('place.form.callbackRatioSpreadTooltip')}
                  value={formCallbackRatioSpread}
                  defaultValue="1%"
                  placeholder="1% 或 0.01"
                  onChange={setFormCallbackRatioSpread}
                  min={-1}
                  step="any"
                  disabled={currentExchange === 'BINANCE' || currentExchange === 'Binance'}
                  allowPercent
                />
                <FormulaPriceField
                  label={t('place.form.activePxLabel')}
                  tooltip={t('place.form.activePxTooltip')}
                  value={formActivePx}
                  placeholder="-1"
                  onChange={setFormActivePx}
                  preview={pricePreviews['active_px']?.text ?? null}
                  previewError={pricePreviews['active_px']?.error ?? false}
                  onBlur={() => handleFormulaBlur('active_px')}
                  onFocus={() => handleFormulaFocus('active_px')}
                  disabled={currentExchange === 'BINANCE' || currentExchange === 'Binance'}
                />
              </>
            )}
            <NumberInput
              label={t('place.form.slMarginLabel')}
              tooltip={t('place.form.slMarginTooltip')}
              value={formStopLossMargin}
              defaultValue="-1"
              placeholder="-1"
              onChange={setFormStopLossMargin}
              min={-1}
              step="any"
              disabled={(currentExchange === 'BINANCE' || currentExchange === 'Binance') && !isSpot}
              allowPercent
            />
          </>
        )}

        {(isConditional(formOrderType) || isOCO(formOrderType)) && (
          <>
            <FormulaPriceField
              label={isConditional(formOrderType) ? t('place.form.triggerOrOrderPrice') : t('place.form.tpTriggerPrice')}
              tooltip={isConditional(formOrderType) ? t('place.form.tpTriggerTooltip') : t('place.form.tpTriggerTooltipOco')}
              value={formFirstTpPrice}
              placeholder="-1"
              onChange={setFormFirstTpPrice}
              preview={pricePreviews['first_tp_price']?.text ?? null}
              previewError={pricePreviews['first_tp_price']?.error ?? false}
              onBlur={() => handleFormulaBlur('first_tp_price')}
              onFocus={() => handleFormulaFocus('first_tp_price')}
            />
            {isOCO(formOrderType) && (
              <FormulaPriceField
                label={t('place.form.slTriggerPrice')}
                tooltip={t('place.form.slTriggerTooltip')}
                value={formFirstSlPrice}
                placeholder="-1"
                onChange={setFormFirstSlPrice}
                preview={pricePreviews['first_sl_price']?.text ?? null}
                previewError={pricePreviews['first_sl_price']?.error ?? false}
                onBlur={() => handleFormulaBlur('first_sl_price')}
                onFocus={() => handleFormulaFocus('first_sl_price')}
              />
            )}
          </>
        )}

        {isChase(formOrderType) && (
          <NumberInput
            label={t('place.form.chaseValLabel')}
            tooltip={t('place.form.chaseValTooltip')}
            value={formChaseVal}
            defaultValue="0"
            placeholder="0"
            onChange={setFormChaseVal}
            min={0}
            step="any"
          />
        )}

        {isMoveOrderStop(formOrderType) && (
          <>
            <NumberInput
              label={t('place.form.callbackRatioSpreadLabel')}
              tooltip={t('place.form.callbackRatioSpreadTooltip')}
              value={formCallbackRatioSpread}
              defaultValue="1%"
              placeholder="1% 或 0.01"
              onChange={setFormCallbackRatioSpread}
              min={-1}
              step="any"
              allowPercent
            />
            <FormulaPriceField
              label={t('place.form.activePxLabel')}
              tooltip={t('place.form.activePxTooltip')}
              value={formActivePx}
              placeholder="-1"
              onChange={setFormActivePx}
              preview={pricePreviews['active_px']?.text ?? null}
              previewError={pricePreviews['active_px']?.error ?? false}
              onBlur={() => handleFormulaBlur('active_px')}
              onFocus={() => handleFormulaFocus('active_px')}
            />
          </>
        )}

        <FormulaPriceField
          label={t('place.form.intervalLabel')}
          tooltip={t('place.form.intervalFormulaTooltip')}
          value={formOrderInterval}
          placeholder="10 或 10% 或 =10*2^n"
          onChange={setFormOrderInterval}
          preview={pricePreviews['order_interval']?.text ?? null}
          previewError={pricePreviews['order_interval']?.error ?? false}
          onBlur={() => handleFormulaBlur('order_interval')}
          onFocus={() => handleFormulaFocus('order_interval')}
          allowPercent
        />
        <NumberInput
          label={t('place.form.orderCountLabel')}
          tooltip={t('place.form.orderCountTooltip')}
          value={formOrderCount}
          defaultValue="5"
          placeholder="5"
          onChange={setFormOrderCount}
          min={1}
          step="1"
        />
        <FormulaPriceField
          label={t('place.form.contractSizeLabel')}
          tooltip={t('place.form.contractSizeFormulaTooltip')}
          value={formContractSize}
          placeholder="1 或 =FLOOR(100/(m*cv),ls)"
          onChange={setFormContractSize}
          preview={pricePreviews['contract_size']?.text ?? null}
          previewError={pricePreviews['contract_size']?.error ?? false}
          onBlur={() => handleFormulaBlur('contract_size')}
          onFocus={() => handleFormulaFocus('contract_size')}
        />
        <div className="space-y-2">
          <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5">{t('place.form.sideLabel')}</label>
          <Select
            value={formSide}
            onChange={(e) => setFormSide(e.target.value)}
            className={formSide === 'buy' ? '!text-trade-green' : '!text-trade-red'}
          >
            <option value="buy" className="!text-trade-green">{t('place.option.sideBuy')}</option>
            <option value="sell" className="!text-trade-red">{t('place.option.sideSell')}</option>
          </Select>
        </div>
      </div>

      <Switch
        checked={!formTestMode}
        onChange={(val) => setFormTestMode(!val)}
        label={t('place.switch.testModeLabel')}
        descriptionOn={t('place.switch.testModeOn')}
        descriptionOff={t('place.switch.testModeOff')}
        colorOn="text-brand-yellow"
      />
      <Switch
        checked={formSkipDuplicate}
        onChange={setFormSkipDuplicate}
        label={t('place.switch.skipDuplicateLabel')}
        descriptionOn={t('place.switch.skipDuplicateOn')}
        descriptionOff={t('place.switch.skipDuplicateOff')}
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
        icon={FilePlus2}
        iconColor="text-brand-yellow"
        title={t('nav.place')}
        subtitle={t('place.ui.subtitle')}
        addLabel={t('place.ui.addLabel')}
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
            title={selectedConfigId ? t('place.ui.logTitleSelected', { name: configs.find(c => c.id === selectedConfigId)?.name || '' }) : t('place.ui.logTitle')}
            icon="file-plus"
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
          <Spinner size="lg" label={t('place.ui.loading')} className="text-brand-yellow" />
        ) : configs.length === 0 ? (
          <EmptyConfigs label={t('place.ui.noConfig')} onAdd={openNew} />
        ) : (
          configs.map((cfg) => (
            <div key={cfg.id}>
              <ConfigCard
                instId={cfg.inst_id}
                name={cfg.name || t('place.ui.unnamedConfig')}
                shortcutKey={cfg.shortcut_key}
                isRunning={!!runningMap[cfg.id]}
                isSelected={selectedConfigId === cfg.id}
                testMode={cfg.place_test_mode}
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
