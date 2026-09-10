import React, { useState, useRef } from 'react';
import DashedHint from '../../ui/DashedHint'
import { X, Plus, Trash2, Shield, Info } from 'lucide-react';
import { useTranslation, type TFunction } from 'react-i18next';

import { Tooltip } from '../../ui/Tooltip.tsx';
import Button from '../../ui/Button.tsx';
import Select from '../../ui/Select.tsx';
import NumberInput from '../../ui/NumberInput.tsx';
import TextInput from '../../ui/TextInput.tsx';
import AccountSelect from '../../ui/AccountSelect.tsx';
import InstrumentInput from '../../ui/InstrumentInput.tsx';

import type { ConditionTemplate, ConditionBlock, ConditionType } from '../../types/index.ts';
import { COND_FIELD_LABELS } from '../../constants/conditionLabels.ts';
import { POS_SIDE_OPTIONS_FILTERED } from '../../constants/positionFields.ts';
import { INDICATOR_MAP } from '../../freqtrade/transpileMap.ts';
import { validatePairTypeConsistency } from '../../freqtrade/buildSpecFromConditions.ts';
import type { FreqtradeIndicator, PriceSource } from '../../types/freqtrade.ts';

interface ConditionTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (template: ConditionTemplate) => void;
  initialData?: ConditionTemplate | null;
  accountNames: Record<string, string>;
  accountColors: Record<string, string>;
  accounts?: Array<{ id: string; name: string; color?: string }>;
}

interface SimpleIndicatorDef {
  id: string;
  label: string;
  group?: string;
  paramLabel?: string;
  paramOptions?: number[];
  defaultParam?: number;
  subOptions?: { value: string; label: string }[];
  priceSubOptions?: { value: string; label: string }[];
  noCross?: boolean;
}

const SIMPLE_INDICATORS: SimpleIndicatorDef[] = [
  { id: 'price', label: 'indicators.price', noCross: true, priceSubOptions: [
    { value: 'close', label: 'indicators.priceClose' }, { value: 'open', label: 'indicators.priceOpen' },
    { value: 'high', label: 'indicators.priceHigh' }, { value: 'low', label: 'indicators.priceLow' },
  ]},
  { id: 'volume', label: 'indicators.volume', group: 'indicators.groupVolume', noCross: true },
  { id: 'VOL_MA', label: 'indicators.volMa', group: 'indicators.groupVolume', noCross: true, paramLabel: 'indicators.period', paramOptions: [5, 10, 20, 30, 60], defaultParam: 20 },
  { id: 'RSI', label: 'indicators.rsi', noCross: true, paramLabel: 'indicators.period', paramOptions: [6, 7, 9, 14, 21], defaultParam: 14 },
  { id: 'EMA', label: 'indicators.ema', paramLabel: 'indicators.period', paramOptions: [5, 9, 20, 21, 50, 200], defaultParam: 20 },
  { id: 'SMA', label: 'indicators.ma', paramLabel: 'indicators.period', paramOptions: [5, 10, 20, 50, 200], defaultParam: 20 },
  { id: 'MACD', label: 'indicators.macd', subOptions: [
    { value: 'macd', label: 'indicators.macdDiff' }, { value: 'macdsignal', label: 'indicators.macdDea' }, { value: 'macdhist', label: 'indicators.macdStick' },
  ]},
  { id: 'BB', label: 'indicators.boll', paramLabel: 'indicators.period', paramOptions: [20, 50], defaultParam: 20, subOptions: [
    { value: 'lower', label: 'indicators.bollLb' }, { value: 'mid', label: 'indicators.bollMid' }, { value: 'upper', label: 'indicators.bollUb' },
  ]},
  { id: 'ATR', label: 'indicators.atr', noCross: true, paramLabel: 'indicators.period', paramOptions: [7, 14, 21], defaultParam: 14 },
  { id: 'STOCH', label: 'indicators.kdj', subOptions: [
    { value: 'slowk', label: 'indicators.kdjK' }, { value: 'slowd', label: 'indicators.kdjD' }, { value: 'j', label: 'indicators.kdjJ' },
  ]},
  { id: 'ADX', label: 'indicators.adx', noCross: true, paramLabel: 'indicators.period', paramOptions: [14, 20, 21], defaultParam: 14 },
  { id: 'MFI', label: 'indicators.mfi', noCross: true, paramLabel: 'indicators.period', paramOptions: [14, 20], defaultParam: 14 },
  { id: 'CCI', label: 'indicators.cci', noCross: true, paramLabel: 'indicators.period', paramOptions: [14, 20, 50], defaultParam: 20 },
];

interface MergedIndicatorOption {
  value: string;
  label: (t: TFunction) => string;
  group: string;
}

function normalizeRepeatValue(val: unknown): string {
  if (val === 'true') return 'repeat';
  if (val === 'false') return 'once';
  return String(val || 'once');
}

const MERGED_INDICATOR_OPTIONS: MergedIndicatorOption[] = (() => {
  const opts: MergedIndicatorOption[] = [];
  for (const ind of SIMPLE_INDICATORS) {
    const grp: string = ind.group || ind.label;
    if (ind.id === 'price') {
      for (const sub of ind.priceSubOptions!) {
        opts.push({ value: `price:${sub.value}`, label: (t) => t(sub.label), group: grp });
      }
    } else if (ind.id === 'volume') {
      opts.push({ value: 'volume', label: (t) => t(ind.label), group: grp });
    } else if (ind.subOptions && !ind.paramOptions) {
      for (const sub of ind.subOptions) {
        opts.push({ value: `${ind.id}:${sub.value}`, label: (t) => t(sub.label), group: grp });
      }
    } else if (ind.subOptions && ind.paramOptions) {
      for (const param of ind.paramOptions) {
        for (const sub of ind.subOptions) {
          opts.push({ value: `${ind.id}:${param}:${sub.value}`, label: (t) => `${t(sub.label)}(${param})`, group: grp });
        }
      }
    } else if (ind.paramOptions) {
      for (const param of ind.paramOptions) {
        opts.push({ value: `${ind.id}:${param}`, label: (t) => `${t(ind.label)}(${param})`, group: grp });
      }
    }
  }
  return opts;
})();

const MERGED_INDICATOR_GROUPS: Record<string, MergedIndicatorOption[]> = (() => {
  const groups: Record<string, MergedIndicatorOption[]> = {};
  for (const opt of MERGED_INDICATOR_OPTIONS) {
    (groups[opt.group] ??= []).push(opt);
  }
  return groups;
})();

function indicatorKeyFromParams(params: Record<string, any>): string {
  const indId = params.indicator || 'RSI';
  const indDef = SIMPLE_INDICATORS.find(i => i.id === indId);
  if (indId === 'price') return `price:${params.source || 'close'}`;
  if (indId === 'volume') return 'volume';
  if (indId === 'MACD' || indId === 'STOCH') {
    return `${indId}:${params.output || indDef?.subOptions?.[0]?.value || ''}`;
  }
  if (indId === 'BB') {
    const w = (params.params as Record<string, number>)?.window || indDef?.defaultParam || 20;
    const o = params.output || indDef?.subOptions?.[0]?.value || 'lower';
    return `BB:${w}:${o}`;
  }
  const paramKey = indId === 'VOL_MA' ? 'window' : 'timeperiod';
  const p = (params.params as Record<string, number>)?.[paramKey] || indDef?.defaultParam || 0;
  return `${indId}:${p}`;
}

function parseIndicatorKey(key: string): { indicator: string; params: Record<string, number>; output: string; source: string } {
  const parts = key.split(':');
  const indId = parts[0];
  const indDef = SIMPLE_INDICATORS.find(i => i.id === indId) || SIMPLE_INDICATORS[3];
  const result = { indicator: indId, params: {} as Record<string, number>, output: '', source: 'close' };
  if (indId === 'price') {
    result.source = parts[1] || 'close';
  } else if (indId === 'volume') {
  } else if (indId === 'MACD' || indId === 'STOCH') {
    result.output = parts[1] || indDef.subOptions?.[0]?.value || '';
  } else if (indId === 'BB') {
    result.params = { window: Number(parts[1]) || indDef.defaultParam! || 20 };
    result.output = parts[2] || indDef.subOptions?.[0]?.value || '';
  } else {
    const paramKey = indId === 'VOL_MA' ? 'window' : 'timeperiod';
    result.params = { [paramKey]: Number(parts[1]) || indDef.defaultParam! || 0 };
  }
  return result;
}

function indicatorNoCrossFromKey(key: string): boolean {
  const indId = key.split(':')[0];
  const indDef = SIMPLE_INDICATORS.find(i => i.id === indId);
  return indDef?.noCross ?? false;
}

const LOGIC_COMPARE: { value: string; label: string }[] = [
  { value: '>', label: '>' }, { value: '<', label: '<' },
  { value: '>=', label: '≥' }, { value: '<=', label: '≤' },
];

const LOGIC_OPTIONS: { value: string; label: string }[] = [
  ...LOGIC_COMPARE,
  { value: 'cross_above', label: 'indicators.crossAbove' }, { value: 'cross_below', label: 'indicators.crossBelow' },
];

const TIMEFRAME_OVERRIDE_OPTIONS: { value: string; label: string }[] = [
  { value: '1m', label: '1m' }, { value: '3m', label: '3m' }, { value: '5m', label: '5m' },
  { value: '15m', label: '15m' }, { value: '30m', label: '30m' },
  { value: '1h', label: '1h' }, { value: '2h', label: '2h' }, { value: '4h', label: '4h' },
  { value: '6h', label: '6h' }, { value: '8h', label: '8h' }, { value: '12h', label: '12h' },
  { value: '1d', label: '1d' }, { value: '3d', label: '3d' },
  { value: '1w', label: '1w' }, { value: '1M', label: '1M' },
];

const CATEGORIES = [
  { id: 'account', label: 'condition.categoryAccount', icon: '💳' },
  { id: 'position', label: 'condition.categoryPosition', icon: '📊' },
  { id: 'time', label: 'condition.categoryTime', icon: '🕒' },
  { id: 'control', label: 'condition.categoryControl', icon: '⚙️' },
  { id: 'signal', label: 'condition.categorySignal', icon: '📡' },
  { id: 'indicator', label: 'condition.categoryIndicator', icon: '📈' },
  { id: 'market', label: 'condition.categoryMarket', icon: '🌐' },
] as const;

function getIndicatorSubTypes(): { label: string; type: ConditionType }[] {
  return SIMPLE_INDICATORS.map(ind => ({
    label: ind.label,
    type: 'indicator' as ConditionType,
  }));
}

const CONDITION_TYPES: Record<string, { label: string; type: ConditionType }[]> = {
  account: [
    { label: 'condition.typeBalance', type: 'balance_less' },
  ],
  position: [
    { label: 'condition.typePosCount', type: 'pos_count' },
    { label: 'condition.typePosSz', type: 'pos_sz_limit' },
    { label: 'condition.typePosSide', type: 'pos_side' },
    { label: 'condition.typePnlAmt', type: 'pos_pnl_amount' },
    { label: 'condition.typePnlRate', type: 'pos_pnl_rate' },
    { label: 'condition.typeMargin', type: 'pos_margin' },
    { label: 'condition.typeMgnRatio', type: 'pos_mgn_ratio_val' },
    { label: 'condition.typeLiqDist', type: 'pos_liq_dist' },
    { label: 'condition.typeFundingRate', type: 'pos_funding_rate' },
    { label: 'condition.typeClosedPnl', type: 'pos_closed_pnl' },
    { label: 'condition.typeHoldTime', type: 'pos_hold_time' },
  ],
  time: [
    { label: 'condition.typeTimeWindow', type: 'time_window' },
  ],
  control: [
    { label: 'condition.typeCooldown', type: 'cooldown' },
    { label: 'condition.typeCountLimit', type: 'count_limit' },
  ],
  signal: [
    { label: 'condition.typeTvSignal', type: 'tv_signal' },
  ],
  indicator: getIndicatorSubTypes(),
  market: [
    { label: 'condition.typePriceChange24h', type: 'price_change_24h' },
    { label: 'condition.typePriceChangeToday', type: 'price_change_today' },
    { label: 'condition.typePriceChangeHigh24h', type: 'price_change_high24h' },
  ],
};

function getIndicatorDefaultParams(indicator: FreqtradeIndicator): Record<string, number> {
  const mapping = INDICATOR_MAP[indicator];
  if (!mapping) return {};
  const defaults: Record<string, number> = {};
  for (const arg of mapping.args) {
    defaults[arg.name] = arg.default;
  }
  return defaults;
}

const ConditionOperatorSelect = ({
  value,
  onChange,
  includeEqual = true,
  includeCross = false
}: {
  value: string;
  onChange: (val: string) => void;
  includeEqual?: boolean;
  includeCross?: boolean;
}) => {
  const { t } = useTranslation();
  return (
  <div className="space-y-2">
    <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">{t('condition.logic')}</label>
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {includeEqual && <option value="=">{t('condition.equal')}</option>}
      <option value="<">{t('condition.lessThan')}</option>
      <option value=">">{t('condition.greaterThan')}</option>
      <option value="<=">{t('condition.lessEqual')}</option>
      <option value=">=">{t('condition.greaterEqual')}</option>
      {includeCross && <option value="cross_above">{t('indicators.crossAbove')}</option>}
      {includeCross && <option value="cross_below">{t('indicators.crossBelow')}</option>}
    </Select>
  </div>
  );
};

export default function ConditionTemplateModal({
  isOpen,
  onClose,
  onSave,
  initialData,
  accounts = [],
}: ConditionTemplateModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialData?.name || '');
  const [exchange, setExchange] = useState<'okx' | 'binance'>(
    initialData?.exchange || 'okx'
  );
  const [timeframe, setTimeframe] = useState(initialData?.timeframe || '5m');
  const [conditions, setConditions] = useState<ConditionBlock[]>(initialData?.conditions || []);
  const [saveError, setSaveError] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setName(initialData?.name || '');
    setExchange(initialData?.exchange || 'okx');
    setTimeframe(initialData?.timeframe || '5m');
    setConditions(initialData?.conditions || []);
  }, [initialData]);

  const defaultAccountId = accounts.length > 0 ? accounts[0].id : '';

  if (!isOpen) return null;

  const getDefaultParams = (type: string, defaultAccountId: string): Record<string, any> => {
    if (type === 'balance_less') return { accountId: defaultAccountId, operator: '<', threshold: 1000 };
    if (type === 'pos_count') return { accountId: defaultAccountId, instId: '', operator: '=', count: 0 };
    if (type === 'pos_sz_limit') return { accountId: defaultAccountId, instId: '', operator: '>', size: 0 };
    if (type === 'pos_pnl_amount') return { accountId: defaultAccountId, instId: '', operator: '>', amount: 0 };
    if (type === 'pos_pnl_rate') return { accountId: defaultAccountId, instId: '', operator: '>', rate: 0 };
    if (type === 'pos_margin') return { accountId: defaultAccountId, instId: '', operator: '>', margin: 0 };
    if (type === 'pos_mgn_ratio_val') return { accountId: defaultAccountId, instId: '', operator: '>', ratio: 0 };
    if (type === 'pos_liq_dist') return { accountId: defaultAccountId, instId: '', operator: '>', dist: 0 };
    if (type === 'pos_funding_rate') return { accountId: defaultAccountId, instId: '', operator: '>', rate: 0 };
    if (type === 'pos_closed_pnl') return { accountId: defaultAccountId, instId: '', operator: '>', amount: 0 };
    if (type === 'pos_hold_time') return { accountId: defaultAccountId, instId: '', operator: '>', value: 1, unit: 'hour' };
    if (type === 'time_window') return { startTime: '00:00', endTime: '23:59', days: [1, 2, 3, 4, 5, 6, 0] };
    if (type === 'cooldown') return { minutes: 0, seconds: 0 };
    if (type === 'count_limit') return { limit: 1 };
    if (type === 'pos_side') return { accountId: defaultAccountId, instId: '', side: 'long' };
    if (type === 'tv_signal') return { signalName: '', secret: '' };
    if (type === 'indicator') return {
      indicator: 'RSI',
      params: getIndicatorDefaultParams('RSI'),
      output: '',
      source: 'close',
      operator: '<',
      operandKind: 'constant',
      operandValue: 30,
      timeframe: '5m',
      pair: '',
    };
    if (type === 'price_change_24h') return { exchange: 'okx', instId: '', window: '24h', operator: '>', threshold: 5 };
    if (type === 'price_change_today') return { exchange: 'okx', instId: '', window: 'today', operator: '>', threshold: 5 };
    if (type === 'price_change_high24h') return { exchange: 'okx', instId: '', window: '24h', operator: '>', threshold: 5 };
    return {};
  };

  const handleAddCondition = () => {
    const newCondition: ConditionBlock = {
      id: Date.now().toString(),
      category: 'account',
      type: 'balance_less',
      params: getDefaultParams('balance_less', defaultAccountId),
    };
    setConditions([...conditions, newCondition]);
  };

  const handleRemoveCondition = (id: string) => {
    setConditions(conditions.filter(c => c.id !== id));
  };

  const handleUpdateCondition = (id: string, updates: Partial<ConditionBlock>) => {
    setConditions(conditions.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const handleUpdateParams = (id: string, paramUpdates: Record<string, any>) => {
    setConditions(conditions.map(c =>
      c.id === id ? { ...c, params: { ...c.params, ...paramUpdates } } : c
    ));
  };

  const handleSave = () => {
    for (let i = 0; i < conditions.length; i++) {
      const c = conditions[i];
      if (c.category === 'indicator' && !String(c.params.pair || '').trim()) {
        setSaveError(`第 ${i + 1} 个条件（指标类型）缺少交易对，请填写后保存`);
        return;
      }
    }

    const pairTypeError = validatePairTypeConsistency(conditions);
    if (pairTypeError) {
      setSaveError(pairTypeError);
      return;
    }

    setSaveError('');

    let finalName = name.trim();
    if (!finalName) {
      const types = conditions.slice(0, 2).map(c => {
        const cat = CONDITION_TYPES[c.category] || [];
        return cat.find(tp => tp.type === c.type)?.label ? t(cat.find(tp => tp.type === c.type)!.label) : t('condition.blockDefault');
      });
      const typeStr = types.length > 0 ? types.join('+') : t('condition.conditionDefault');
      finalName = `#${Date.now().toString(16).slice(-4).toUpperCase()}`;
    }

    const updatedConditions = conditions.map(c => {
      if (c.type === 'tv_signal' && !c.params.secret?.trim()) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let randomSecret = '';
        for (let i = 0; i < 24; i++) {
          randomSecret += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return { ...c, params: { ...c.params, secret: randomSecret } };
      }
      return c;
    });

    onSave({
      id: initialData?.id || Date.now().toString(),
      name: finalName,
      exchange,
      timeframe,
      conditions: updatedConditions,
      createdAt: initialData?.createdAt || Date.now(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      />
      <div ref={modalRef} className="relative bg-surface-2 border border-border-default rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-x-hidden">
        <div className="px-6 py-4 border-b border-border-default flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-yellow/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-brand-yellow" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-secondary">{initialData ? t('condition.editCondition') : t('condition.createCondition')}</h2>
              <p className="text-xs text-text-tertiary">{t('condition.conditionDesc')}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-3 rounded-full text-text-tertiary hover:text-text-primary transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          <div className="space-y-2">
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-2">
                <label className="text-xs font-bold text-text-secondary flex items-center gap-1.5">
                  {t('condition.conditionName')}
                </label>
                <TextInput
                  value={name}
                  defaultValue=""
                  onChange={setName}
                />
              </div>
              <div className="flex-1 space-y-2">
                <label className="text-xs font-bold text-text-secondary flex items-center gap-1.5">
                  <Tooltip content={t('field.indicatorEditor.exchangeTooltip')}>
                    <DashedHint className="cursor-help">{t('field.indicatorEditor.exchange')}</DashedHint>
                  </Tooltip>
                </label>
                <Select
                  value={exchange}
                  onChange={(e) => setExchange(e.target.value as 'okx' | 'binance')}
                >
                  <option value="okx">OKX</option>
                  <option value="binance">Binance</option>
                </Select>
              </div>
              <div className="flex-1 space-y-2">
                <label className="text-xs font-bold text-text-secondary flex items-center gap-1.5">
                  <Tooltip content={t('field.indicatorEditor.timeframeTooltip')}>
                    <DashedHint className="cursor-help">{t('field.indicatorEditor.timeframe')}</DashedHint>
                  </Tooltip>
                </label>
                <Select
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                >
                  {TIMEFRAME_OVERRIDE_OPTIONS.map((tf) => (
                    <option key={tf.value} value={tf.value}>{tf.label}</option>
                  ))}
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-text-secondary ml-1">{t('condition.blockCombo')}</label>
              <Button 
                variant="ghost"
                onClick={handleAddCondition}
              >
                <Plus className="w-3 h-3" />
                {t('condition.addBlock')}
              </Button>
            </div>

            <div className="space-y-4">
              {conditions.length === 0 ? (
                <div className="p-8 border border-dashed border-white/5 rounded-2xl flex flex-col items-center justify-center text-center">
                  <Info className="w-6 h-6 text-text-muted mb-2" />
                  <p className="text-xs text-text-muted">{t('condition.addBlockHint')}</p>
                </div>
              ) : (
                conditions.map((condition, idx) => (
                  <div key={condition.id} className="p-4 rounded-2xl bg-surface-1 border border-border-default shadow-sm space-y-4 relative group">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-lg bg-surface-1 border border-border-default flex items-center justify-center text-xs">
                        {idx + 1}
                      </div>
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <Select
                          value={condition.category}
                          onChange={(e) => {
                            const newCategory = e.target.value as ConditionBlock['category'];
                            const newType = CONDITION_TYPES[newCategory]?.[0]?.type || 'balance_less';
                            handleUpdateCondition(condition.id, {
                              category: newCategory,
                              type: newType,
                              params: getDefaultParams(newType, defaultAccountId)
                            });
                          }}
                        >
                          {CATEGORIES.map(cat => (
                            <option key={cat.id} value={cat.id}>{cat.icon} {t(cat.label)}</option>
                          ))}
                        </Select>
                        <Select
                          value={condition.params.indicator || condition.type}
                          onChange={(e) => {
                            const selectedValue = e.target.value;
                            if (condition.category === 'indicator') {
                              const indDef = SIMPLE_INDICATORS.find(i => i.id === selectedValue);
                              const newParams = selectedValue !== 'price' && selectedValue !== 'volume' && selectedValue !== 'MACD' && selectedValue !== 'STOCH'
                                ? getIndicatorDefaultParams(selectedValue as FreqtradeIndicator)
                                : {};
                              handleUpdateParams(condition.id, {
                                indicator: selectedValue,
                                params: newParams,
                                output: indDef?.subOptions?.[0]?.value || '',
                                source: selectedValue === 'price' ? 'close' : 'close',
                              });
                            } else {
                              const newType = selectedValue as ConditionType;
                              handleUpdateCondition(condition.id, { type: newType, params: getDefaultParams(newType, defaultAccountId) });
                            }
                          }}
                        >
                          {(CONDITION_TYPES[condition.category] || []).map((tp, idx) => {
                            const optionValue = condition.category === 'indicator'
                              ? SIMPLE_INDICATORS[idx]?.id || tp.type
                              : tp.type;
                            return (
                              <option key={optionValue} value={optionValue}>{t(tp.label)}</option>
                            );
                          })}
                        </Select>
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() => handleRemoveCondition(condition.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="pl-9 grid grid-cols-1 gap-4 border-l-2 border-border-subtle">
                      {condition.type === 'balance_less' && (
                        <div className="grid grid-cols-3 gap-2">
                          <div className="col-span-1">
                            <AccountSelect
                              value={condition.params.accountId ?? ''}
                              onChange={(val) => handleUpdateParams(condition.id, { accountId: val })}
                              accounts={accounts}
                            />
                          </div>
                          <div className="col-span-1">
                            <ConditionOperatorSelect
                              value={condition.params.operator}
                              onChange={(val) => handleUpdateParams(condition.id, { operator: val })}
                            />
                          </div>
                          <div className="col-span-1">
                            <NumberInput
                              label={t(COND_FIELD_LABELS.bl_threshold)}
                              value={condition.params.threshold}
                              defaultValue={1000}
                              onChange={(val) => handleUpdateParams(condition.id, { threshold: val })}
                              placeholder={t('condition.placeholderAmount')}
                            />
                          </div>
                        </div>
                      )}

                      {condition.type === 'pos_count' && (
                        <div className="grid grid-cols-4 gap-2">
                          <div className="col-span-1">
                            <AccountSelect
                              value={condition.params.accountId ?? ''}
                              onChange={(val) => handleUpdateParams(condition.id, { accountId: val })}
                              accounts={accounts}
                            />
                          </div>
                          <div className="col-span-1">
                            <InstrumentInput
                              label={t('condition.tradingPair')}
                              value={condition.params.instId || ''}
                              defaultValue=""
                              onChange={(val) => handleUpdateParams(condition.id, { instId: val })}
                              placeholder={t('ui.instrumentInput.allPlaceholder')}
                              tooltip={t('condition.instIdTooltip')}
                            />
                          </div>
                          <div className="col-span-1">
                            <ConditionOperatorSelect
                              value={condition.params.operator}
                              onChange={(val) => handleUpdateParams(condition.id, { operator: val })}
                            />
                          </div>
                          <div className="col-span-1">
                            <NumberInput
                              label={t('condition.positionCount')}
                              value={condition.params.count}
                              defaultValue={0}
                              onChange={(val) => handleUpdateParams(condition.id, { count: val })}
                              placeholder={t('condition.placeholderCount')}
                            />
                          </div>
                        </div>
                      )}

                      {condition.type === 'pos_sz_limit' && (
                        <div className="grid grid-cols-4 gap-2">
                          <div className="col-span-1">
                            <AccountSelect
                              value={condition.params.accountId ?? ''}
                              onChange={(val) => handleUpdateParams(condition.id, { accountId: val })}
                              accounts={accounts}
                            />
                          </div>
                          <div className="col-span-1">
                            <InstrumentInput
                              label={t('condition.tradingPair')}
                              value={condition.params.instId || ''}
                              defaultValue=""
                              onChange={(val) => handleUpdateParams(condition.id, { instId: val })}
                              placeholder={t('ui.instrumentInput.allPlaceholder')}
                              tooltip={t('condition.instIdTooltip')}
                            />
                          </div>
                          <div className="col-span-1">
                            <ConditionOperatorSelect
                              value={condition.params.operator}
                              onChange={(val) => handleUpdateParams(condition.id, { operator: val })}
                            />
                          </div>
                          <div className="col-span-1">
                            <NumberInput
                              label={t('condition.positionSize')}
                              value={condition.params.size}
                              defaultValue={0}
                              onChange={(val) => handleUpdateParams(condition.id, { size: val })}
                              placeholder={t('condition.placeholderQuantity')}
                            />
                          </div>
                        </div>
                      )}

                      {condition.type === 'pos_pnl_amount' && (
                        <div className="grid grid-cols-4 gap-2">
                          <div className="col-span-1">
                            <AccountSelect
                              value={condition.params.accountId ?? ''}
                              onChange={(val) => handleUpdateParams(condition.id, { accountId: val })}
                              accounts={accounts}
                            />
                          </div>
                          <div className="col-span-1">
                            <InstrumentInput
                              label={t('condition.tradingPair')}
                              value={condition.params.instId || ''}
                              defaultValue=""
                              onChange={(val) => handleUpdateParams(condition.id, { instId: val })}
                              placeholder={t('ui.instrumentInput.allPlaceholder')}
                              tooltip={t('condition.instIdTooltip')}
                            />
                          </div>
                          <div className="col-span-1">
                            <ConditionOperatorSelect
                              value={condition.params.operator}
                              onChange={(val) => handleUpdateParams(condition.id, { operator: val })}
                            />
                          </div>
                          <div className="col-span-1">
                            <NumberInput
                              label={t('condition.pnlAmount')}
                              value={condition.params.amount}
                              defaultValue={0}
                              onChange={(val) => handleUpdateParams(condition.id, { amount: val })}
                              placeholder={t('condition.placeholderAmount')}
                            />
                          </div>
                        </div>
                      )}

                      {condition.type === 'pos_margin' && (
                        <div className="grid grid-cols-4 gap-2">
                          <div className="col-span-1">
                            <AccountSelect
                              value={condition.params.accountId ?? ''}
                              onChange={(val) => handleUpdateParams(condition.id, { accountId: val })}
                              accounts={accounts}
                            />
                          </div>
                          <div className="col-span-1">
                            <InstrumentInput
                              label={t('condition.tradingPair')}
                              value={condition.params.instId || ''}
                              defaultValue=""
                              onChange={(val) => handleUpdateParams(condition.id, { instId: val })}
                              placeholder={t('ui.instrumentInput.allPlaceholder')}
                              tooltip={t('condition.instIdTooltip')}
                            />
                          </div>
                          <div className="col-span-1">
                            <ConditionOperatorSelect
                              value={condition.params.operator}
                              onChange={(val) => handleUpdateParams(condition.id, { operator: val })}
                            />
                          </div>
                          <div className="col-span-1">
                            <NumberInput
                              label={t('condition.margin')}
                              value={condition.params.margin}
                              defaultValue={0}
                              onChange={(val) => handleUpdateParams(condition.id, { margin: val })}
                              placeholder={t('condition.placeholderAmount')}
                            />
                          </div>
                        </div>
                      )}

                      {condition.type === 'pos_mgn_ratio_val' && (
                        <div className="grid grid-cols-4 gap-2">
                          <div className="col-span-1">
                            <AccountSelect
                              value={condition.params.accountId ?? ''}
                              onChange={(val) => handleUpdateParams(condition.id, { accountId: val })}
                              accounts={accounts}
                            />
                          </div>
                          <div className="col-span-1">
                            <InstrumentInput
                              label={t('condition.tradingPair')}
                              value={condition.params.instId || ''}
                              defaultValue=""
                              onChange={(val) => handleUpdateParams(condition.id, { instId: val })}
                              placeholder={t('ui.instrumentInput.allPlaceholder')}
                              tooltip={t('condition.instIdTooltip')}
                            />
                          </div>
                          <div className="col-span-1">
                            <ConditionOperatorSelect
                              value={condition.params.operator}
                              onChange={(val) => handleUpdateParams(condition.id, { operator: val })}
                            />
                          </div>
                          <div className="col-span-1">
                            <NumberInput
                              label={t('condition.mgnRatio')}
                              value={condition.params.ratio}
                              defaultValue={0}
                              onChange={(val) => handleUpdateParams(condition.id, { ratio: val })}
                              placeholder={t('condition.placeholderPercent')}
                            />
                          </div>
                        </div>
                      )}

                      {condition.type === 'pos_pnl_rate' && (
                        <div className="grid grid-cols-4 gap-2">
                          <div className="col-span-1">
                            <AccountSelect
                              value={condition.params.accountId ?? ''}
                              onChange={(val) => handleUpdateParams(condition.id, { accountId: val })}
                              accounts={accounts}
                            />
                          </div>
                          <div className="col-span-1">
                            <InstrumentInput
                              label={t('condition.tradingPair')}
                              value={condition.params.instId || ''}
                              defaultValue=""
                              onChange={(val) => handleUpdateParams(condition.id, { instId: val })}
                              placeholder={t('ui.instrumentInput.allPlaceholder')}
                              tooltip={t('condition.instIdTooltip')}
                            />
                          </div>
                          <div className="col-span-1">
                            <ConditionOperatorSelect
                              value={condition.params.operator}
                              onChange={(val) => handleUpdateParams(condition.id, { operator: val })}
                            />
                          </div>
                          <div className="col-span-1">
                            <NumberInput
                              label={t('condition.pnlRate')}
                              value={condition.params.rate}
                              defaultValue={0}
                              onChange={(val) => handleUpdateParams(condition.id, { rate: val })}
                              placeholder={t('condition.placeholderPercent')}
                            />
                          </div>
                        </div>
                      )}

                      {condition.type === 'pos_liq_dist' && (
                        <div className="grid grid-cols-4 gap-2">
                          <div className="col-span-1">
                            <AccountSelect
                              value={condition.params.accountId ?? ''}
                              onChange={(val) => handleUpdateParams(condition.id, { accountId: val })}
                              accounts={accounts}
                            />
                          </div>
                          <div className="col-span-1">
                            <InstrumentInput
                              label={t('condition.tradingPair')}
                              value={condition.params.instId || ''}
                              defaultValue=""
                              onChange={(val) => handleUpdateParams(condition.id, { instId: val })}
                              placeholder={t('ui.instrumentInput.allPlaceholder')}
                              tooltip={t('condition.instIdTooltip')}
                            />
                          </div>
                          <div className="col-span-1">
                            <ConditionOperatorSelect
                              value={condition.params.operator}
                              onChange={(val) => handleUpdateParams(condition.id, { operator: val })}
                            />
                          </div>
                          <div className="col-span-1">
                            <NumberInput
                              label={t('condition.liqDist')}
                              value={condition.params.dist}
                              defaultValue={0}
                              onChange={(val) => handleUpdateParams(condition.id, { dist: val })}
                              placeholder={t('condition.placeholderAmount')}
                            />
                          </div>
                        </div>
                      )}

                      {condition.type === 'pos_funding_rate' && (
                        <div className="grid grid-cols-4 gap-2">
                          <div className="col-span-1">
                            <AccountSelect
                              value={condition.params.accountId ?? ''}
                              onChange={(val) => handleUpdateParams(condition.id, { accountId: val })}
                              accounts={accounts}
                            />
                          </div>
                          <div className="col-span-1">
                            <InstrumentInput
                              label={t('condition.tradingPair')}
                              value={condition.params.instId || ''}
                              defaultValue=""
                              onChange={(val) => handleUpdateParams(condition.id, { instId: val })}
                              placeholder={t('ui.instrumentInput.allPlaceholder')}
                              tooltip={t('condition.instIdTooltip')}
                            />
                          </div>
                          <div className="col-span-1">
                            <ConditionOperatorSelect
                              value={condition.params.operator}
                              onChange={(val) => handleUpdateParams(condition.id, { operator: val })}
                            />
                          </div>
                          <div className="col-span-1">
                            <NumberInput
                              label={t('condition.fundingRateLabel')}
                              value={condition.params.rate}
                              defaultValue={0}
                              onChange={(val) => handleUpdateParams(condition.id, { rate: val })}
                              placeholder={t('condition.placeholderPercent')}
                            />
                          </div>
                        </div>
                      )}

                      {condition.type === 'pos_closed_pnl' && (
                        <div className="grid grid-cols-4 gap-2">
                          <div className="col-span-1">
                            <AccountSelect
                              value={condition.params.accountId ?? ''}
                              onChange={(val) => handleUpdateParams(condition.id, { accountId: val })}
                              accounts={accounts}
                            />
                          </div>
                          <div className="col-span-1">
                            <InstrumentInput
                              label={t('condition.tradingPair')}
                              value={condition.params.instId || ''}
                              defaultValue=""
                              onChange={(val) => handleUpdateParams(condition.id, { instId: val })}
                              placeholder={t('ui.instrumentInput.allPlaceholder')}
                              tooltip={t('condition.instIdTooltip')}
                            />
                          </div>
                          <div className="col-span-1">
                            <ConditionOperatorSelect
                              value={condition.params.operator}
                              onChange={(val) => handleUpdateParams(condition.id, { operator: val })}
                            />
                          </div>
                          <div className="col-span-1">
                            <NumberInput
                              label={t('condition.closedPnl')}
                              value={condition.params.amount}
                              defaultValue={0}
                              onChange={(val) => handleUpdateParams(condition.id, { amount: val })}
                              placeholder={t('condition.placeholderAmount')}
                            />
                          </div>
                        </div>
                      )}

                      {condition.type === 'pos_hold_time' && (
                        <div className="grid grid-cols-5 gap-2">
                          <div className="col-span-1">
                            <AccountSelect
                              value={condition.params.accountId ?? ''}
                              onChange={(val) => handleUpdateParams(condition.id, { accountId: val })}
                              accounts={accounts}
                            />
                          </div>
                          <div className="col-span-1">
                            <InstrumentInput
                              label={t('condition.tradingPair')}
                              value={condition.params.instId || ''}
                              defaultValue=""
                              onChange={(val) => handleUpdateParams(condition.id, { instId: val })}
                              placeholder={t('ui.instrumentInput.allPlaceholder')}
                              tooltip={t('condition.instIdTooltip')}
                            />
                          </div>
                          <div className="col-span-1">
                            <ConditionOperatorSelect
                              value={condition.params.operator}
                              onChange={(val) => handleUpdateParams(condition.id, { operator: val })}
                            />
                          </div>
                          <div className="col-span-1">
                            <NumberInput
                              label={t('condition.holdTime')}
                              value={condition.params.value}
                              defaultValue={1}
                              min={0}
                              onChange={(val) => handleUpdateParams(condition.id, { value: val })}
                              placeholder={t('condition.placeholderAmount')}
                            />
                          </div>
                          <div className="col-span-1">
                            <Select
                              label={t('field.unit')}
                              value={condition.params.unit || 'hour'}
                              onChange={(e) => handleUpdateParams(condition.id, { unit: e.target.value })}
                            >
                              <option value="minute">{t('unit.minute')}</option>
                              <option value="hour">{t('unit.hour')}</option>
                              <option value="day">{t('unit.day')}</option>
                            </Select>
                          </div>
                        </div>
                      )}

                      {condition.type === 'time_window' && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <TextInput
                              label={t('condition.startTime')}
                              value={condition.params.startTime}
                              defaultValue="00:00"
                              onChange={(val) => handleUpdateParams(condition.id, { startTime: val })}
                            />
                            <TextInput
                              label={t('condition.endTime')}
                              value={condition.params.endTime}
                              defaultValue="23:59"
                              onChange={(val) => handleUpdateParams(condition.id, { endTime: val })}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">{t('condition.weekly')}</label>
                            <div className="grid grid-cols-7 gap-1">
                              {[t('condition.daySun'), t('condition.dayMon'), t('condition.dayTue'), t('condition.dayWed'), t('condition.dayThu'), t('condition.dayFri'), t('condition.daySat')].map((day, idx) => {
                                const dayVal = idx === 0 ? 0 : idx;
                                const isSelected = condition.params.days?.includes(dayVal);
                                return (
                                  <button
                                    key={day}
                                    onClick={() => {
                                      const days = condition.params.days || [];
                                      const newDays = isSelected
                                        ? days.filter((d: number) => d !== dayVal)
                                        : [...days, dayVal];
                                      handleUpdateParams(condition.id, { days: newDays });
                                    }}
                                    className={`px-1 py-1 rounded text-2xs ${isSelected ? 'bg-brand-blue text-text-primary' : 'bg-surface-3 text-text-secondary'}`}
                                  >
                                    {day}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}

                      {condition.type === 'cooldown' && (
                        <div className="grid grid-cols-2 gap-4">
                          <NumberInput
                            label={t('condition.minutes')}
                            value={condition.params.minutes}
                            defaultValue={0}
                            onChange={(val) => handleUpdateParams(condition.id, { minutes: val })}
                          />
                          <NumberInput
                            label={t('condition.seconds')}
                            value={condition.params.seconds}
                            defaultValue={0}
                            onChange={(val) => handleUpdateParams(condition.id, { seconds: val })}
                          />
                        </div>
                      )}

                      {condition.type === 'count_limit' && (
                        <div className="grid grid-cols-1 gap-4">
                          <NumberInput
                            label={t('condition.dailyLimit')}
                            value={condition.params.limit}
                            defaultValue={1}
                            onChange={(val) => handleUpdateParams(condition.id, { limit: val })}
                          />
                        </div>
                      )}

                      {condition.type === 'pos_side' && (
                        <div className="grid grid-cols-3 gap-2">
                          <div className="col-span-1">
                            <AccountSelect
                              value={condition.params.accountId ?? ''}
                              onChange={(val) => handleUpdateParams(condition.id, { accountId: val })}
                              accounts={accounts}
                            />
                          </div>
                          <div className="col-span-1">
                            <InstrumentInput
                              label={t('condition.tradingPair')}
                              value={condition.params.instId || ''}
                              defaultValue=""
                              onChange={(val) => handleUpdateParams(condition.id, { instId: val })}
                              placeholder={t('ui.instrumentInput.allPlaceholder')}
                              tooltip={t('condition.instIdTooltip')}
                            />
                          </div>
                          <div className="col-span-1 space-y-2">
                            <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">{t('condition.direction')}</label>
                            <Select
                              value={condition.params.side}
                              onChange={(e) => handleUpdateParams(condition.id, { side: e.target.value })}
                            >
                              {POS_SIDE_OPTIONS_FILTERED.map((opt) => (
                                <option key={opt.value} value={opt.value}>{t(`position.${opt.label}`)}</option>
                              ))}
                            </Select>
                          </div>
                        </div>
                      )}

                      {condition.type === 'tv_signal' && (
                        <div className="grid grid-cols-1">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Tooltip content={t('condition.webhookSecretTooltip')}>
                                <DashedHint as="label" className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5 !mb-0 cursor-help">
                                  {t('condition.secretKey')}
                                </DashedHint>
                              </Tooltip>
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                                  let randomSecret = '';
                                  for (let i = 0; i < 24; i++) {
                                    randomSecret += chars.charAt(Math.floor(Math.random() * chars.length));
                                  }
                                  handleUpdateParams(condition.id, { secret: randomSecret });
                                }}
                              >
                                {t('condition.randomGenerate')}
                              </Button>
                            </div>
                            <TextInput
                              value={condition.params.secret || ''}
                              defaultValue=""
                              onChange={(val) => handleUpdateParams(condition.id, { secret: val })}
                              placeholder={t('condition.secretPlaceholder')}
                            />
                          </div>
                        </div>
                      )}

                      {condition.type === 'indicator' && (() => {
                        const currentKey = indicatorKeyFromParams(condition.params);
                        const noCross = indicatorNoCrossFromKey(currentKey);
                        const logicOpts = noCross ? LOGIC_COMPARE : LOGIC_OPTIONS;
                        return (
                          <div className="space-y-3">
                            <div className="grid grid-cols-4 gap-2 items-end">
                              <InstrumentInput
                                label={t('field.indicatorEditor.tradingPair')}
                                value={condition.params.pair || ''}
                                defaultValue=""
                                onChange={(val) => handleUpdateParams(condition.id, { pair: val })}
                                placeholder="BTC-USDT-SWAP"
                              />
                              <div className="space-y-1">
                                <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider">{t('field.indicatorEditor.indicator')}</label>
                                <Select
                                  value={currentKey}
                                  onChange={(e) => {
                                    const parsed = parseIndicatorKey(e.target.value);
                                    handleUpdateParams(condition.id, {
                                      indicator: parsed.indicator,
                                      params: parsed.params,
                                      output: parsed.output,
                                      source: parsed.source,
                                    });
                                  }}
                                >
                                  {Object.entries(MERGED_INDICATOR_GROUPS).map(([groupKey, opts]) => (
                                    <optgroup key={groupKey} label={t(groupKey)}>
                                      {opts.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label(t)}</option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider">{t('field.indicatorEditor.logic')}</label>
                                <Select
                                  value={condition.params.operator || '<'}
                                  onChange={(e) => handleUpdateParams(condition.id, { operator: e.target.value })}
                                >
                                  {logicOpts.map(opt => (
                                    <option key={opt.value} value={opt.value}>{t(opt.label)}</option>
                                  ))}
                                </Select>
                              </div>
                              <NumberInput
                                label={t('field.indicatorEditor.value')}
                                value={condition.params.operandValue ?? 0}
                                defaultValue={0}
                                onChange={(val) => handleUpdateParams(condition.id, { operandValue: val })}
                              />
                            </div>
                          </div>
                        );
                      })()}

                      {condition.type.startsWith('price_change') && (
                        <div className="space-y-2">
                          <div className="grid grid-cols-4 gap-2 items-end">
                            <div className="space-y-1">
                              <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider">
                                {t(COND_FIELD_LABELS.pch_exchange)}
                              </label>
                              <Select
                                value={condition.params.exchange || 'okx'}
                                onChange={(e) => handleUpdateParams(condition.id, { exchange: e.target.value })}
                              >
                                <option value="okx">OKX</option>
                              </Select>
                            </div>
                            <InstrumentInput
                              label={
                                <Tooltip content={t('condition.pchInstIdTips')}>
                                  <DashedHint className="cursor-help">{t('condition.tradingPair')}</DashedHint>
                                </Tooltip>
                              }
                              value={condition.params.instId || ''}
                              defaultValue=""
                              onChange={(val) => handleUpdateParams(condition.id, { instId: val })}
                              placeholder={t('ui.instrumentInput.allPlaceholder')}
                            />
                            <ConditionOperatorSelect
                              value={condition.params.operator || '>'}
                              onChange={(val) => handleUpdateParams(condition.id, { operator: val })}
                              includeCross
                              includeEqual={false}
                            />
                            <NumberInput
                              label={t('condition.value')}
                              value={condition.params.threshold || 0}
                              defaultValue={5}
                              onChange={(val) => handleUpdateParams(condition.id, { threshold: val })}
                              placeholder="5"
                            />
                          </div>
                          <div className="col-span-1">
                            <Select
                              label={
                                <Tooltip content={t('condition.repeatTips')}>
                                  <DashedHint className="cursor-help">{t('condition.repeatTrigger')}</DashedHint>
                                </Tooltip>
                              }
                              value={normalizeRepeatValue(condition.params.repeat)}
                              onChange={(e) => handleUpdateParams(condition.id, { repeat: e.target.value })}
                            >
                              <option value="repeat">{t('condition.repeatMode.repeat')}</option>
                              <option value="once">{t('condition.repeatMode.once')}</option>
                              <option value="daily">{t('condition.repeatMode.daily')}</option>
                            </Select>
                          </div>
                        </div>
                      )}

                      {condition.type !== 'balance_less' && condition.type !== 'pos_count' && condition.type !== 'pos_sz_limit' && condition.type !== 'pos_pnl_amount' && condition.type !== 'pos_pnl_rate' && condition.type !== 'pos_margin' && condition.type !== 'pos_mgn_ratio_val' && condition.type !== 'pos_liq_dist' && condition.type !== 'pos_funding_rate' && condition.type !== 'pos_closed_pnl' && condition.type !== 'pos_hold_time' && condition.type !== 'time_window' && condition.type !== 'cooldown' && condition.type !== 'count_limit' && condition.type !== 'pos_side' && condition.type !== 'tv_signal' && condition.type !== 'indicator' && !condition.type.startsWith('price_change') && (
                        <p className="text-2xs text-text-muted italic">{t('condition.blockInDev')}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {saveError && (
          <div className="px-6 py-2 bg-trade-red/10 border-t border-trade-red/20">
            <p className="text-sm text-trade-red font-medium">{saveError}</p>
          </div>
        )}

        <div className="px-6 py-4 border-t border-border-default bg-surface-1 flex items-center justify-end gap-3 shrink-0">
          <Button
            variant="ghost"
            size="md"
            onClick={onClose}
            className="rounded-xl"
          >
            {t('condition.cancel')}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSave}
            disabled={conditions.length === 0}
            className="rounded-xl"
          >
            {t('condition.saveCondition')}
          </Button>
        </div>
      </div>
    </div>
  );
}
