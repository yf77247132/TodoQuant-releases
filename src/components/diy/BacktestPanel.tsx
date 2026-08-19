import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Plus, Minus } from 'lucide-react';
import DashedHint from '../../ui/DashedHint.tsx';
import { Tooltip } from '../../ui/Tooltip.tsx';
import { safeStorageGet, safeStorageSet } from '../../lib/safeStorage.ts';
import Button from '../../ui/Button.tsx';
import NumberInput from '../../ui/NumberInput.tsx';
import Select from '../../ui/Select.tsx';
import Switch from '../../ui/Switch.tsx';
import InstrumentInput from '../../ui/InstrumentInput.tsx';
import DatePickerInput from '../../ui/DatePickerInput.tsx';
import { LABEL_BASE, INPUT_BASE } from '../../ui/inputStyles.ts';
import { classifyConditions, buildSpecFromConditions } from '../../freqtrade/buildSpecFromConditions.ts';
import { CONDITION_TYPE_LABELS, CONDITION_TYPE_LOG_LABELS, BACKTESTABLE_CONDITION_TYPES } from '../../constants/conditionLabels.ts';
import { okxPairToFtPair } from '../../freqtrade/strategyGenerator.ts';
import type { FreqtradeTimeframe, ConditionClassification } from '../../types/freqtrade.ts';
import type { ConditionBlock, ConditionTemplate } from '../../types/diy.ts';

const TIMEFRAME_OPTIONS: { value: FreqtradeTimeframe; maxDays: number }[] = [
  { value: '1m',  maxDays: 5   },
  { value: '3m',  maxDays: 13  },
  { value: '5m',  maxDays: 180 },
  { value: '15m', maxDays: 365 },
  { value: '30m', maxDays: 0   },
  { value: '1h',  maxDays: 0   },
  { value: '2h',  maxDays: 0   },
  { value: '4h',  maxDays: 0   },
  { value: '6h',  maxDays: 0   },
  { value: '8h',  maxDays: 0   },
  { value: '12h', maxDays: 0   },
  { value: '1d',  maxDays: 0   },
  { value: '3d',  maxDays: 0   },
  { value: '1w',  maxDays: 0   },
  { value: '1M',  maxDays: 0   },
];

const DAY_NAME_KEYS = [
  'backtest.days.sunday', 'backtest.days.monday', 'backtest.days.tuesday',
  'backtest.days.wednesday', 'backtest.days.thursday', 'backtest.days.friday',
  'backtest.days.saturday',
];

const OPERATOR_SYMBOL: Record<string, string> = {
  '>': '>', '<': '<', '>=': '≥', '<=': '≤',
  cross_above: '×↑', cross_below: '×↓',
};

const SK_ENTRY_TEMPLATE_ID = 'bt_entryTemplateId';
const SK_EXIT_TEMPLATE_ID  = 'bt_exitTemplateId';
const SK_INST_ID           = 'bt_instId';
const SK_STOPLOSS          = 'bt_stoploss';
const SK_ROI_ROWS          = 'bt_roiRows';
const SK_TRAILING_STOP     = 'bt_trailingStop';
const SK_TRAILING_CALLBACK = 'bt_trailingCallback';
const SK_FROM_DATE         = 'bt_fromDate';
const SK_TO_DATE           = 'bt_toDate';
const SK_DRY_RUN_WALLET    = 'bt_dryRunWallet';
const SK_STAKE_AMOUNT      = 'bt_stakeAmount';
const SK_MAX_OPEN_TRADES   = 'bt_maxOpenTrades';
const SK_TIMEFRAME         = 'bt_timeframe';

const defaultFromDate = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};

const defaultToDate = () => new Date().toISOString().slice(0, 10);

export interface BacktestPanelProps {
  conditionTemplates: ConditionTemplate[];
  timezone?: string;
  onRunBacktest: (params: BacktestRunParams) => void;
}

type BacktestPhase = 'idle' | 'detecting' | 'downloading' | 'running';

export interface BacktestRunParams {
  entryConditions: ConditionBlock[];
  exitConditions: ConditionBlock[];
  spec: ReturnType<typeof buildSpecFromConditions>;
  pairs: string[];
  exchange: 'okx' | 'binance';
  resolvedTimeframe: FreqtradeTimeframe;
  ftStrategyName: string;
  btId: string;
  fromDateString: string;
  toDateString: string;
  stakeAmount: number;
  maxOpenTrades: number;
  dryRunWallet: number;
  timezone?: string;
  direction?: 'long' | 'short' | 'both';
}

export interface RoiRow {
  rate: string;
  minutes: string;
}

export function buildRoiFromRows(rows: RoiRow[]): Record<string, number> {
  const roi: Record<string, number> = {};
  for (const row of rows) {
    const minutes = Number(row.minutes) || 0;
    const rate = Number(row.rate) || 0;
    roi[String(minutes)] = rate / 100;
  }
  return Object.keys(roi).length > 0 ? roi : { '0': 0.05 };
}

export function buildConditionDescription(cond: ConditionBlock, t?: (key: string) => string): string {
  const p = cond.params;

  if (cond.type === 'indicator') {
    const indicator = String(p.indicator || 'RSI');
    const inner = (p.params && typeof p.params === 'object') ? p.params as Record<string, unknown> : {};
    const paramStr = Object.entries(inner)
      .filter(([, v]) => typeof v === 'number' && v > 0)
      .map(([, v]) => v)
      .join(',');
    const operator = String(p.operator || '<');
    const opSym = OPERATOR_SYMBOL[operator] || operator;

    let operandStr = '';
    const operandKind = String(p.operandKind || 'constant');
    if (operandKind === 'constant') {
      operandStr = String(p.operandValue ?? 0);
    } else if (operandKind === 'price') {
      operandStr = String(p.operandSource || 'close');
    } else if (operandKind === 'indicator') {
      operandStr = String(p.operandIndicator || 'RSI');
    }

    return paramStr ? `${indicator}(${paramStr}) ${opSym} ${operandStr}` : `${indicator} ${opSym} ${operandStr}`;
  }

  if (cond.type === 'time_window') {
    const start = String(p.startTime || '');
    const end = String(p.endTime || '');
    const days = (p.days as number[]) || [];
    const dayStr = days.length === 7
      ? (t ? t('backtest.days.everyday') : '每天')
      : days.length === 0
        ? ''
        : [...days].sort((a, b) => a - b).map(d => t ? t(DAY_NAME_KEYS[d]) : String(d)).join('、');
    return `${start}-${end}${dayStr ? ` ${dayStr}` : ''}`;
  }

  if (t) {
    const key = CONDITION_TYPE_LABELS[cond.type];
    if (key) return t(key);
  }
  return CONDITION_TYPE_LOG_LABELS[cond.type] || cond.type;
}

function deriveExchange(template: ConditionTemplate | null): 'okx' | 'binance' {
  if (template?.exchange) {
    return template.exchange === 'binance' ? 'binance' : 'okx';
  }
  const cond = template?.conditions?.[0];
  const instId = cond?.params?.instId || cond?.params?.instrument || '';
  if (typeof instId === 'string' && instId.includes('-')) return 'okx';
  return 'okx';
}

function getTimezoneDisplay(tz?: string): string {
  if (!tz) return 'UTC';
  try {
    const parts = tz.split('/');
    return parts.length > 1 ? parts[parts.length - 1].replace(/_/g, ' ') : tz;
  } catch {
    return tz;
  }
}

export default function BacktestPanel({
  conditionTemplates,
  timezone,
  onRunBacktest,
}: BacktestPanelProps) {
  const { t } = useTranslation();

  const [entryTemplateId, setEntryTemplateId] = useState(() => safeStorageGet<string>(SK_ENTRY_TEMPLATE_ID, ''));
  const [exitTemplateId, setExitTemplateId] = useState(() => safeStorageGet<string>(SK_EXIT_TEMPLATE_ID, ''));

  const entryTemplate = useMemo(
    () => conditionTemplates.find(t => t.id === entryTemplateId) || null,
    [conditionTemplates, entryTemplateId],
  );
  const exitTemplate = useMemo(
    () => conditionTemplates.find(t => t.id === exitTemplateId) || null,
    [conditionTemplates, exitTemplateId],
  );

  const allConditions = useMemo(() => {
    const entry = entryTemplate?.conditions || [];
    const exit = exitTemplate?.conditions || [];
    return [...entry, ...exit];
  }, [entryTemplate, exitTemplate]);

  const entryBacktestable = useMemo(
    () => (entryTemplate?.conditions || []).filter(c => BACKTESTABLE_CONDITION_TYPES.has(c.type)),
    [entryTemplate],
  );

  const exitBacktestable = useMemo(
    () => (exitTemplate?.conditions || []).filter(c => BACKTESTABLE_CONDITION_TYPES.has(c.type)),
    [exitTemplate],
  );

  const liveOnlyConditions = useMemo(
    () => allConditions.filter(c => !BACKTESTABLE_CONDITION_TYPES.has(c.type)),
    [allConditions],
  );

  const classification: ConditionClassification = useMemo(
    () => classifyConditions(allConditions),
    [allConditions],
  );

  const hasBacktestable = entryBacktestable.length > 0 || exitBacktestable.length > 0;

  const [instId, setInstId] = useState(() => safeStorageGet<string>(SK_INST_ID, ''));

  const [stoplossPct, setStoplossPct] = useState(() => safeStorageGet<string>(SK_STOPLOSS, '-5'));
  const [roiRows, setRoiRows] = useState<RoiRow[]>(() => safeStorageGet<RoiRow[]>(SK_ROI_ROWS, [{ rate: '5', minutes: '0' }]));
  const [trailingStop, setTrailingStop] = useState(() => safeStorageGet<boolean>(SK_TRAILING_STOP, false));
  const [trailingCallbackPct, setTrailingCallbackPct] = useState(() => safeStorageGet<string>(SK_TRAILING_CALLBACK, '2'));
  const SK_DIRECTION = 'bt_direction';
  const [direction, setDirection] = useState<'long' | 'short'>(() => (safeStorageGet<string>(SK_DIRECTION, 'long') ?? 'long') as 'long' | 'short');
  const persistDirection = (v: string) => { setDirection(v as 'long' | 'short'); safeStorageSet(SK_DIRECTION, v); };

  const [fromDate, setFromDate] = useState(() => safeStorageGet<string>(SK_FROM_DATE, defaultFromDate()));
  const [toDate, setToDate] = useState(() => safeStorageGet<string>(SK_TO_DATE, defaultToDate()));
  const [dryRunWallet, setDryRunWallet] = useState(() => safeStorageGet<string>(SK_DRY_RUN_WALLET, '10000'));
  const [stakeAmount, setStakeAmount] = useState(() => safeStorageGet<string>(SK_STAKE_AMOUNT, '100'));
  const [maxOpenTrades, setMaxOpenTrades] = useState(() => safeStorageGet<string>(SK_MAX_OPEN_TRADES, '3'));
  const [timeframe, setTimeframe] = useState<FreqtradeTimeframe>(
    () => safeStorageGet<FreqtradeTimeframe>(SK_TIMEFRAME, '5m'),
  );

  const persistEntryTemplateId = useCallback((v: string) => { setEntryTemplateId(v); safeStorageSet(SK_ENTRY_TEMPLATE_ID, v); }, []);
  const persistExitTemplateId = useCallback((v: string) => { setExitTemplateId(v); safeStorageSet(SK_EXIT_TEMPLATE_ID, v); }, []);
  const persistInstId = useCallback((v: string) => { setInstId(v); safeStorageSet(SK_INST_ID, v); }, []);
  const persistStoplossPct = useCallback((v: string) => { setStoplossPct(v); safeStorageSet(SK_STOPLOSS, v); }, []);
  const persistRoiRows = useCallback((v: RoiRow[]) => { setRoiRows(v); safeStorageSet(SK_ROI_ROWS, v); }, []);
  const persistTrailingStop = useCallback((v: boolean) => { setTrailingStop(v); safeStorageSet(SK_TRAILING_STOP, v); }, []);
  const persistTrailingCallbackPct = useCallback((v: string) => { setTrailingCallbackPct(v); safeStorageSet(SK_TRAILING_CALLBACK, v); }, []);
  const persistFromDate = useCallback((v: string) => { setFromDate(v); safeStorageSet(SK_FROM_DATE, v); }, []);
  const persistToDate = useCallback((v: string) => { setToDate(v); safeStorageSet(SK_TO_DATE, v); }, []);
  const persistDryRunWallet = useCallback((v: string) => { setDryRunWallet(v); safeStorageSet(SK_DRY_RUN_WALLET, v); }, []);
  const persistStakeAmount = useCallback((v: string) => { setStakeAmount(v); safeStorageSet(SK_STAKE_AMOUNT, v); }, []);
  const persistMaxOpenTrades = useCallback((v: string) => { setMaxOpenTrades(v); safeStorageSet(SK_MAX_OPEN_TRADES, v); }, []);
  const persistTimeframe = useCallback((v: FreqtradeTimeframe) => { setTimeframe(v); safeStorageSet(SK_TIMEFRAME, v); }, []);

  const addRoiRow = useCallback(() => {
    setRoiRows(prev => { const next = [...prev, { rate: '5', minutes: '0' }]; safeStorageSet(SK_ROI_ROWS, next); return next; });
  }, []);

  const removeRoiRow = useCallback((index: number) => {
    setRoiRows(prev => { const next = prev.filter((_, i) => i !== index); safeStorageSet(SK_ROI_ROWS, next); return next; });
  }, []);

  const updateRoiRow = useCallback((index: number, field: 'rate' | 'minutes', value: string) => {
    setRoiRows(prev => { const next = prev.map((row, i) => i === index ? { ...row, [field]: value } : row); safeStorageSet(SK_ROI_ROWS, next); return next; });
  }, []);

  const timeframeTouchRef = useRef(false);
  useEffect(() => {
    if (entryTemplate?.timeframe && !timeframeTouchRef.current) {
      const saved = safeStorageGet<FreqtradeTimeframe>(SK_TIMEFRAME, null);
      if (!saved) persistTimeframe(entryTemplate.timeframe as FreqtradeTimeframe);
      timeframeTouchRef.current = true;
    }
  }, [entryTemplate?.timeframe]);

  const hasTimeWindow = useMemo(
    () => allConditions.some(c => c.type === 'time_window'),
    [allConditions],
  );

  const canRun = (hasBacktestable || hasTimeWindow) && !!entryTemplateId && !!instId;

  const handleRunBacktest = useCallback(() => {
    const entryConditions = entryBacktestable;
    const exitConditions = exitBacktestable;

    const btId = `bt_${Date.now()}`;
    const entryName = entryTemplate?.name || 'Entry';
    const exitName = exitTemplate?.name || '';
    const btName = exitName ? `${entryName}_${exitName}` : entryName;

    const spec = buildSpecFromConditions(btId, btName, entryConditions, timeframe, exitConditions, okxPairToFtPair(instId), timezone);

    const mainPair = okxPairToFtPair(instId);
    const specPairs = new Set<string>([mainPair]);
    if (spec) {
      for (const cond of spec.entry.children) {
        if (cond.pair) specPairs.add(cond.pair);
      }
      for (const cond of spec.exit.children) {
        if (cond.pair) specPairs.add(cond.pair);
      }
    }
    const pairs = Array.from(specPairs);

    const resolvedTimeframe = spec?.timeframe || timeframe;
    const ftStrategyName = `GenStrategy_${btId}`;

    if (spec) {
      spec.backtest = {
        stoploss: Number(stoplossPct) / 100,
        minimalRoi: buildRoiFromRows(roiRows),
        trailingStopEnabled: trailingStop,
        trailingStopPositive: Number(trailingCallbackPct) / 100,
        trailingOnlyOffsetIsReached: true,
      };
    }

    const exchange = deriveExchange(exitTemplate) === 'binance' ? 'binance' : deriveExchange(entryTemplate);

    const fmtDate = (d: string) => d.replace(/-/g, '');

    onRunBacktest({
      entryConditions,
      exitConditions,
      spec: spec!,
      pairs,
      exchange,
      resolvedTimeframe,
      ftStrategyName,
      btId,
      fromDateString: fmtDate(fromDate),
      toDateString: fmtDate(toDate),
      stakeAmount: Number(stakeAmount) || 100,
      maxOpenTrades: Number(maxOpenTrades) || 3,
      dryRunWallet: Number(dryRunWallet) || 10000,
      direction,
      timezone,
    });
  }, [entryBacktestable, exitBacktestable, entryTemplate, exitTemplate, timeframe, instId, timezone, stoplossPct, roiRows, trailingStop, trailingCallbackPct, fromDate, toDate, stakeAmount, maxOpenTrades, dryRunWallet, onRunBacktest]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4">
        <div className="bg-surface-2 border border-border-default rounded-2xl shadow-sm p-4 space-y-4">
          <h3 className="text-sm font-bold text-text-secondary">{t('backtest.conditionConfig')}</h3>

          <div>
            <label className={LABEL_BASE}>{t('backtest.entryCondition')}</label>
            <Select
              value={entryTemplateId}
              onChange={(e) => persistEntryTemplateId(e.target.value)}
              containerClassName="w-full"
            >
              <option value="">{t('backtest.selectEntryTemplate')}</option>
              {conditionTemplates.map(tmpl => (
                <option key={tmpl.id} value={tmpl.id}>
                  {tmpl.name}{tmpl.exchange ? ` (${tmpl.exchange.toUpperCase()})` : ''}
                </option>
              ))}
            </Select>
            {entryTemplate && (
              <div className="mt-2 p-2.5 bg-surface-1 border border-border-default rounded-lg space-y-1">
                <p className="text-xs text-text-secondary font-medium">
                  {t('backtest.backtestableConditions')} ({entryBacktestable.length})
                </p>
                {entryBacktestable.length > 0 ? (
                  <ul className="space-y-0.5">
                    {entryBacktestable.map(c => (
                      <li key={c.id} className="text-xs text-text-tertiary">
                        • {buildConditionDescription(c, t)}
                        {c.type === 'time_window' && (
                          <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-surface-3 text-text-muted rounded">
                            {t('backtest.timeWindowAuto')}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-text-muted">{t('backtest.noBacktestable')}</p>
                )}
                {(entryTemplate.conditions || []).filter(c => !BACKTESTABLE_CONDITION_TYPES.has(c.type)).length > 0 && (
                  <div className="pt-1.5 border-t border-border-subtle">
                    <p className="text-xs text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {t('backtest.liveOnlyInTemplate', {
                        count: (entryTemplate.conditions || []).filter(c => !BACKTESTABLE_CONDITION_TYPES.has(c.type)).length,
                      })}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className={LABEL_BASE}>{t('backtest.exitCondition')}</label>
            <Select
              value={exitTemplateId}
              onChange={(e) => persistExitTemplateId(e.target.value)}
              containerClassName="w-full"
            >
              <option value="">{t('backtest.noExitCondition')}</option>
              {conditionTemplates.map(tmpl => (
                <option key={tmpl.id} value={tmpl.id} disabled={tmpl.id === entryTemplateId}>
                  {tmpl.name}{tmpl.exchange ? ` (${tmpl.exchange.toUpperCase()})` : ''}
                </option>
              ))}
            </Select>
            {exitTemplate && (
              <div className="mt-2 p-2.5 bg-surface-1 border border-border-default rounded-lg space-y-1">
                <p className="text-xs text-text-secondary font-medium">
                  {t('backtest.backtestableConditions')} ({exitBacktestable.length})
                </p>
                {exitBacktestable.length > 0 ? (
                  <ul className="space-y-0.5">
                    {exitBacktestable.map(c => (
                      <li key={c.id} className="text-xs text-text-tertiary">
                        • {buildConditionDescription(c, t)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-text-muted">{t('backtest.noBacktestable')}</p>
                )}
              </div>
            )}
          </div>

          {liveOnlyConditions.length > 0 && (
            <div className="p-2.5 bg-amber-400/5 border border-amber-400/15 rounded-lg">
              <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{t('backtest.liveOnly', { count: liveOnlyConditions.length })}</span>
                <span className="text-text-muted font-normal">— {t('backtest.liveOnlyHint')}</span>
              </div>
              <ul className="ml-5 mt-1 space-y-0.5">
                {liveOnlyConditions.map(c => (
                  <li key={c.id} className="text-xs text-text-tertiary">
                    • {buildConditionDescription(c, t)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!hasBacktestable && entryTemplateId && (
            <div className="p-3 bg-amber-400/10 border border-amber-400/20 rounded-lg text-sm text-amber-400">
              {t('backtest.noBacktestableWarning')}
            </div>
          )}
        </div>

        <div className="bg-surface-2 border border-border-default rounded-2xl shadow-sm p-4 space-y-4">
          <h3 className="text-sm font-bold text-text-secondary">{t('backtest.exitSettings')}</h3>
          <NumberInput
            label={t('backtest.stoploss')}
            value={stoplossPct}
            defaultValue="-5"
            onChange={persistStoplossPct}
            min={-100}
            max={0}
            step="1"
            allowPercent
            tooltip={t('backtest.stoplossTooltip')}
          />

          <div className="space-y-2">
            <label className={LABEL_BASE}>
              <Tooltip content={t('backtest.roiTooltip')}>
                <DashedHint className="cursor-help">{t('backtest.roi')}</DashedHint>
              </Tooltip>
            </label>
            <div className="space-y-1.5">
              {roiRows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={row.rate}
                      onChange={(e) => updateRoiRow(idx, 'rate', e.target.value)}
                      className={`${INPUT_BASE} flex-1 min-w-0`}
                      step="1"
                      min={0}
                    />
                    <span className="text-xs text-text-muted shrink-0">%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={row.minutes}
                      onChange={(e) => updateRoiRow(idx, 'minutes', e.target.value)}
                      className={`${INPUT_BASE} flex-1 min-w-0`}
                      step="1"
                      min={0}
                    />
                    <span className="text-xs text-text-muted shrink-0">m</span>
                  </div>
                  {roiRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRoiRow(idx)}
                      className="p-1 text-text-muted hover:text-trade-red transition-colors shrink-0"
                      title={t('backtest.removeRoiRow')}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {roiRows.length <= 1 && <div className="w-5" />}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addRoiRow}
              className="flex items-center gap-1 text-xs text-brand-yellow hover:text-brand-yellow/80 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('backtest.addRoiRow')}
            </button>
          </div>

          <Switch
            label={t('backtest.trailingStop')}
            checked={trailingStop}
            onChange={persistTrailingStop}
            size="sm"
          />
          {trailingStop && (
            <NumberInput
              label={t('backtest.trailingCallback')}
              value={trailingCallbackPct}
              defaultValue="2"
              onChange={persistTrailingCallbackPct}
              min={0.1}
              step="0.5"
              allowPercent
              tooltip={t('backtest.trailingCallbackTooltip')}
            />
          )}
        </div>

        <div className="bg-surface-2 border border-border-default rounded-2xl shadow-sm p-4 space-y-4">
          <h3 className="text-sm font-bold text-text-secondary">{t('backtest.params')}</h3>

          <InstrumentInput
            label={t('backtest.tradingPair')}
            value={instId}
            defaultValue=""
            onChange={persistInstId}
            placeholder={t('backtest.tradingPairPlaceholder')}
          />

          <div className="grid grid-cols-2 gap-3">
            <DatePickerInput
              label={t('backtest.fromDate')}
              value={fromDate}
              onChange={persistFromDate}
            />
            <DatePickerInput
              label={t('backtest.toDate')}
              value={toDate}
              onChange={persistToDate}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberInput
              label={`${t('backtest.dryRunWallet')} (USDT)`}
              value={dryRunWallet}
              defaultValue="10000"
              onChange={persistDryRunWallet}
              min={100}
              step="1000"
              tooltip={t('backtest.dryRunWalletTooltip')}
            />
            <NumberInput
              label={`${t('backtest.stakeAmount')} (USDT)`}
              value={stakeAmount}
              defaultValue="100"
              onChange={persistStakeAmount}
              min={1}
              step="10"
              tooltip={t('backtest.stakeAmountTooltip')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className={LABEL_BASE}>
                <Tooltip content={t('backtest.timeframeTooltip')}>
                  <DashedHint className="cursor-help">{t('backtest.timeframe')}</DashedHint>
                </Tooltip>
              </label>
              <Select
                value={timeframe}
                onChange={(e) => persistTimeframe(e.target.value as FreqtradeTimeframe)}
              >
                {TIMEFRAME_OPTIONS.map(({ value: tf, maxDays }) => (
                  <option key={tf} value={tf}>
                    {tf}{maxDays > 0 ? ` - ${t('backtest.maxDays', { count: maxDays })}` : ''}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <label className={LABEL_BASE}>{t('backtest.direction')}</label>
              <Select
                value={direction}
                onChange={(e) => persistDirection(e.target.value)}
                className={direction === 'long' ? '!text-trade-green' : '!text-trade-red'}
              >
                <option value="long" className="!text-trade-green">{t('backtest.directionLong')}</option>
                <option value="short" className="!text-trade-red">{t('backtest.directionShort')}</option>
              </Select>
            </div>
          </div>

          <div className="text-2xs text-text-muted italic">
            {t('backtest.timezoneNote', { tz: getTimezoneDisplay(timezone) })}
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 pt-3 pb-0 bg-surface-0 border-t border-border-subtle">
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="md"
            className="rounded-xl w-full"
            onClick={handleRunBacktest}
            disabled={!canRun}
          >
            {t('backtest.run')}
          </Button>
        </div>
      </div>
    </div>
  );
}
