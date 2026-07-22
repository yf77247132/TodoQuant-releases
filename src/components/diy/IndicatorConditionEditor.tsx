
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../../ui/Button.tsx';
import Select from '../../ui/Select.tsx';
import TextInput from '../../ui/TextInput.tsx';
import NumberInput from '../../ui/NumberInput.tsx';
import { Plus, Trash2, ChevronDown } from 'lucide-react';
import { INDICATOR_MAP } from '../../freqtrade/transpileMap.ts';
import type {
  FreqtradeStrategySpec,
  FreqtradeIndicator,
  FreqtradeOperator,
  FreqtradeTimeframe,
  PriceSource,
  IndicatorCondition,
  ConditionGroup,
  Operand,
  MacdOutput,
  BbOutput,
  StochOutput,
} from '../../types/freqtrade.ts';

const INDICATOR_LABELS: Record<FreqtradeIndicator, string> = {
  RSI: 'RSI — 相对强弱指数',
  EMA: 'EMA — 指数移动平均',
  MACD: 'MACD — 异同移动平均线',
  BB: 'BOLL — 布林带',
  SMA: 'SMA — 简单移动平均',
  ATR: 'ATR — 真实波动幅度均值',
  STOCH: 'STOCH — 随机指标',
  ADX: 'ADX — 平均方向指数',
  MFI: 'MFI — 资金流量指数',
  CCI: 'CCI — 商品通道指数',
  VOL_MA: 'VOL-MA — 成交量均线',
};

const OPERATOR_LABELS: Record<FreqtradeOperator, string> = {
  cross_above: '上穿 (cross_above)',
  cross_below: '下穿 (cross_below)',
  '>': '> (大于)',
  '<': '< (小于)',
  '>=': '>= (大于等于)',
  '<=': '<= (小于等于)',
};

const PRICE_LABELS: Record<PriceSource, string> = {
  close: 'indicators.priceClose',
  open: 'indicators.priceOpen',
  high: 'indicators.priceHigh',
  low: 'indicators.priceLow',
  volume: 'indicators.volume',
};

const TIMEFRAME_OPTIONS: FreqtradeTimeframe[] = [
  '1m', '3m', '5m', '15m', '30m',
  '1h', '2h', '4h', '6h', '8h', '12h',
  '1d', '3d', '1w', '1M',
];

const ALL_INDICATORS = Object.keys(INDICATOR_MAP) as FreqtradeIndicator[];
const ALL_OPERATORS = Object.keys(OPERATOR_LABELS) as FreqtradeOperator[];

const SUB_LABELS: Record<string, string> = {
  macd: 'DIFF',
  macdsignal: 'DEA',
  macdhist: 'STICK',
  lower: '下轨',
  mid: '中轨',
  upper: '上轨',
  slowk: 'KDJ-K',
  slowd: 'KDJ-D',
  j: 'KDJ-J',
};

function condId(): string {
  return `ftc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function defaultSource(indicator: FreqtradeIndicator): PriceSource | undefined {
  if (indicator === 'VOL_MA') return 'volume';
  return undefined;
}

function blankCondition(indicator: FreqtradeIndicator = 'RSI'): IndicatorCondition {
  return {
    category: 'indicator',
    indicator,
    params: buildDefaultParams(indicator),
    operator: 'cross_below',
    operand: { kind: 'constant', value: 30 },
  };
}

function buildDefaultParams(indicator: FreqtradeIndicator): Record<string, number> {
  const mapping = INDICATOR_MAP[indicator];
  const p: Record<string, number> = {};
  for (const arg of mapping.args) {
    p[arg.name] = arg.default;
  }
  return p;
}

interface IndicatorConditionEditorProps {
  strategyId: string;
  strategyName: string;
  onChange: (spec: FreqtradeStrategySpec) => void;
  initialSpec?: FreqtradeStrategySpec | null;
  compact?: boolean;
}

interface ConditionCardProps {
  condition: IndicatorCondition;
  onChange: (c: IndicatorCondition) => void;
  onRemove: () => void;
  allConditions: IndicatorCondition[];
  compact?: boolean;
}

function ConditionCard({ condition, onChange, onRemove, allConditions, compact }: ConditionCardProps) {
  const { t } = useTranslation();
  const c = condition;
  const mapping = INDICATOR_MAP[c.indicator];
  const isMulti = mapping.output === 'multi';

  return (
    <div className="p-3 bg-surface-3 border border-border-subtle rounded-lg space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Select
          className="text-xs"
          containerClassName="min-w-[110px]"
          value={c.indicator}
          onChange={(e) => {
            const newInd = e.target.value as FreqtradeIndicator;
            const source = defaultSource(newInd);
            onChange({
              ...blankCondition(newInd),
              operator: c.operator,
              operand: c.operand,
              timeframe: c.timeframe,
              source,
            });
          }}
        >
          {ALL_INDICATORS.map((ind) => (
            <option key={ind} value={ind}>{INDICATOR_LABELS[ind]}</option>
          ))}
        </Select>

        <Select
          className="text-xs"
          containerClassName="min-w-[100px]"
          value={c.operator}
          onChange={(e) => onChange({ ...c, operator: e.target.value as FreqtradeOperator })}
        >
          {ALL_OPERATORS.map((op) => (
            <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
          ))}
        </Select>

        <button
          className="p-1 rounded text-text-tertiary hover:text-trade-red hover:bg-trade-red/10 transition-colors ml-auto"
          onClick={onRemove}
          title="删除条件"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {mapping.args.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {mapping.args.map((arg) => (
            <label key={arg.name} className="flex items-center gap-1 text-xs text-text-tertiary">
              {arg.name}
              <input
                type="number"
                className="w-16 h-7 px-1.5 rounded border border-border-subtle bg-surface-4 text-xs text-text-primary focus:border-brand-blue focus:outline-none"
                value={c.params[arg.name] ?? arg.default}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val > 0) {
                    onChange({ ...c, params: { ...c.params, [arg.name]: val } });
                  }
                }}
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {isMulti && (
          <Select
            className="text-xs"
            containerClassName="min-w-[80px]"
            value={c.output ?? ''}
            onChange={(e) => onChange({ ...c, output: (e.target.value || undefined) as MacdOutput | BbOutput | StochOutput | undefined })}
          >
            <option value="">默认输出</option>
            {mapping.keys?.map((k) => (
              <option key={k} value={k}>{SUB_LABELS[k] || k}</option>
            ))}
          </Select>
        )}

        <Select
          className="text-xs"
          containerClassName="min-w-[70px]"
          value={c.operand.kind}
          onChange={(e) => {
            const kind = e.target.value as 'constant' | 'price' | 'indicator';
            if (kind === 'constant') {
              onChange({ ...c, operand: { kind: 'constant', value: 0 } });
            } else if (kind === 'price') {
              onChange({ ...c, operand: { kind: 'price', source: 'close' } });
            } else {
              onChange({ ...c, operand: { kind: 'indicator', indicator: 'RSI' } });
            }
          }}
        >
          <option value="constant">常量</option>
          <option value="price">价格</option>
          <option value="indicator">指标</option>
        </Select>

        {c.operand.kind === 'constant' && (
          <input
            type="number"
            className="w-24 h-7 px-1.5 rounded border border-border-subtle bg-surface-4 text-xs text-text-primary focus:border-brand-blue focus:outline-none"
            value={c.operand.value}
            step="any"
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val)) {
                onChange({ ...c, operand: { kind: 'constant', value: val } });
              }
            }}
          />
        )}

        {c.operand.kind === 'price' && (
          <Select
            className="text-xs"
            containerClassName="min-w-[70px]"
            value={c.operand.source}
            onChange={(e) => onChange({ ...c, operand: { kind: 'price', source: e.target.value as PriceSource } })}
          >
            {Object.entries(PRICE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{t(v)}</option>
            ))}
          </Select>
        )}

        {c.operand.kind === 'indicator' && (
          <Select
            className="text-xs"
            containerClassName="min-w-[90px]"
            value={c.operand.indicator}
            onChange={(e) => onChange({ ...c, operand: { kind: 'indicator', indicator: e.target.value as FreqtradeIndicator } })}
          >
            {ALL_INDICATORS.map((ind) => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </Select>
        )}

      </div>

      {!isMulti && c.indicator !== 'VOL_MA' && !compact && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">输入源:</span>
          <Select
            className="text-xs"
            containerClassName="min-w-[70px]"
            value={c.source ?? 'close'}
            onChange={(e) => {
              const src = e.target.value as PriceSource;
              onChange({ ...c, source: src === 'close' ? undefined : src });
            }}
          >
            {Object.entries(PRICE_LABELS).filter(([k]) => k !== 'volume').map(([k, v]) => (
              <option key={k} value={k}>{t(v)}</option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}

export default function IndicatorConditionEditor({
  strategyId,
  strategyName,
  onChange,
  initialSpec,
  compact = false,
}: IndicatorConditionEditorProps) {
  const { t } = useTranslation();
  const [stoploss, setStoploss] = useState(initialSpec?.stoploss ?? -0.10);
  const [minimalRoiStr, setMinimalRoiStr] = useState(
    initialSpec ? Object.entries(initialSpec.minimalRoi).map(([k,v]) => `${k}:${v}`).join(', ') : '0:0.05'
  );

  const [entryConditions, setEntryConditions] = useState<IndicatorCondition[]>(
    initialSpec?.entry?.children ?? []
  );
  const [exitConditions, setExitConditions] = useState<IndicatorCondition[]>(
    initialSpec?.exit?.children ?? []
  );

  const derivedTimeframe = initialSpec?.timeframe ?? '5m';

  const buildSpec = useCallback((): FreqtradeStrategySpec => {
    const roi: Record<string, number> = {};
    minimalRoiStr.split(',').forEach((part) => {
      const [k, v] = part.trim().split(':');
      if (k && v !== undefined) {
        const n = parseFloat(v.trim());
        if (!isNaN(n)) roi[k.trim()] = n;
      }
    });
    if (Object.keys(roi).length === 0) roi['0'] = 0.05;

    return {
      id: strategyId,
      name: strategyName,
      timeframe: derivedTimeframe,
      entry: { logic: 'AND', children: entryConditions },
      exit: { logic: 'AND', children: exitConditions },
      stoploss,
      minimalRoi: roi,
    };
  }, [strategyId, strategyName, derivedTimeframe, entryConditions, exitConditions, stoploss, minimalRoiStr]);

  const spec = useMemo(buildSpec, [buildSpec]);

  useEffect(() => {
    onChange(spec);
  }, [spec, onChange]);

  const addEntry = () => setEntryConditions([...entryConditions, { ...blankCondition('RSI'), id: condId() as any }]);
  const addExit = () => setExitConditions([...exitConditions, { ...blankCondition('RSI'), id: condId() as any }]);

  const updateEntry = (idx: number, cond: IndicatorCondition) => {
    const next = [...entryConditions];
    next[idx] = cond;
    setEntryConditions(next);
  };

  const updateExit = (idx: number, cond: IndicatorCondition) => {
    const next = [...exitConditions];
    next[idx] = cond;
    setExitConditions(next);
  };

  const removeEntry = (idx: number) => setEntryConditions(entryConditions.filter((_, i) => i !== idx));
  const removeExit = (idx: number) => setExitConditions(exitConditions.filter((_, i) => i !== idx));

  const allConditions = [...entryConditions, ...exitConditions];

  const labelCls = 'text-xs font-medium text-text-tertiary mb-1';

  return (
    <div className={`space-y-4 ${compact ? 'text-xs' : ''}`}>
      {!compact && (
        <div className="p-3 bg-surface-2 border border-border-subtle rounded-lg space-y-3">
          <h4 className="text-sm font-semibold text-text-secondary">策略配置</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className={labelCls}>止损比例 (负数)</div>
              <input
                type="number"
                className="w-full h-8 px-2 rounded border border-border-subtle bg-surface-3 text-sm text-text-primary focus:border-brand-blue focus:outline-none"
                value={stoploss}
                step="0.01"
                min={-1}
                max={0}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v <= 0) setStoploss(v);
                }}
              />
            </div>

            <div>
              <div className={labelCls}>最小止盈 (ROI 表)</div>
              <TextInput
                value={minimalRoiStr}
                defaultValue="0:0.05"
                onChange={setMinimalRoiStr}
                placeholder="0:0.05, 60:0.02"
              />
            </div>
          </div>
          <p className="text-2xs text-text-muted">K线周期由各条件自动推导（取最短的）</p>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-trade-green">入场条件 (AND)</h4>
          <Button variant="ghost" size="xs" onClick={addEntry}>
            <Plus className="w-3 h-3 mr-1" />
            添加
          </Button>
        </div>

        {entryConditions.length === 0 && (
          <div className="p-3 text-xs text-text-muted bg-surface-2 border border-dashed border-border-subtle rounded-lg text-center">
            尚未添加入场条件 — 点击「添加」选择一个指标
          </div>
        )}

        {entryConditions.map((cond, idx) => (
          <ConditionCard
            key={idx}
            condition={cond}
            onChange={(c) => updateEntry(idx, c)}
            onRemove={() => removeEntry(idx)}
            allConditions={allConditions}
            compact={compact}
          />
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-trade-red">出场条件 (AND)</h4>
          <Button variant="ghost" size="xs" onClick={addExit}>
            <Plus className="w-3 h-3 mr-1" />
            添加
          </Button>
        </div>

        {exitConditions.length === 0 && (
          <div className="p-3 text-xs text-text-muted bg-surface-2 border border-dashed border-border-subtle rounded-lg text-center">
            尚未添加出场条件 — 点击「添加」选择一个指标
          </div>
        )}

        {exitConditions.map((cond, idx) => (
          <ConditionCard
            key={idx}
            condition={cond}
            onChange={(c) => updateExit(idx, c)}
            onRemove={() => removeExit(idx)}
            allConditions={allConditions}
            compact={compact}
          />
        ))}
      </div>

      <div className="text-xs text-text-muted p-2 bg-surface-2 rounded">
        策略: {strategyName} | 周期: {derivedTimeframe} | 入场条件: {entryConditions.length} 个 | 出场条件: {exitConditions.length} 个 | 止损: {stoploss}
      </div>
    </div>
  );
}
