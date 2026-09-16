
import type { ConditionBlock } from '../types/diy.ts';
import type {
  FreqtradeStrategySpec,
  IndicatorCondition,
  ConditionGroup,
  FreqtradeIndicator,
  FreqtradeOperator,
  Operand,
  PriceSource,
  FreqtradeTimeframe,
  TimeWindowSpec,
  ConditionClassification,
} from '../types/freqtrade.ts';
import { BACKTESTABLE_CONDITION_TYPES, CONDITION_TYPE_LOG_LABELS } from '../constants/conditionLabels.ts';

function localTimeToUtc(localTime: string, timezone?: string): string {
  const [h, m] = localTime.split(':').map(Number);
  const localMinutes = h * 60 + m;

  let offset: number;
  if (timezone && timezone !== '') {
    const now = new Date();
    const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr = now.toLocaleString('en-US', { timeZone: timezone });
    const utcDate = new Date(utcStr);
    const tzDate = new Date(tzStr);
    offset = -(tzDate.getTime() - utcDate.getTime()) / 60000;
  } else {
    offset = new Date().getTimezoneOffset();
  }

  const utcMinutes = ((localMinutes + offset) % 1440 + 1440) % 1440;
  const utcH = Math.floor(utcMinutes / 60);
  const utcM = utcMinutes % 60;
  return `${String(utcH).padStart(2, '0')}:${String(utcM).padStart(2, '0')}`;
}

export function buildSpecFromConditions(
  strategyId: string,
  strategyName: string,
  conditions: ConditionBlock[],
  timeframe?: FreqtradeTimeframe,
  exitConditions?: ConditionBlock[],
  mainPair?: string,
  timezone?: string,
): FreqtradeStrategySpec | null {
  const indicatorConds = conditions.filter(c => c.type === 'indicator');
  const timeWindowConds = conditions.filter(c => c.type === 'time_window');

  if (indicatorConds.length === 0) return null;

  const timeWindows: TimeWindowSpec[] = timeWindowConds
    .map(c => {
      const rawStart = String(c.params.startTime || '');
      const rawEnd = String(c.params.endTime || '');
      if (!rawStart || !rawEnd) return null;
      return {
        startTime: localTimeToUtc(rawStart, timezone),
        endTime: localTimeToUtc(rawEnd, timezone),
        days: (c.params.days as number[]) || [],
      };
    })
    .filter((tw): tw is TimeWindowSpec => tw !== null);

  const entryChildren = indicatorConds.map(c => convertBlockToIndicatorCondition(c, mainPair));

  const exitChildren = exitConditions
    ? exitConditions.filter(c => c.type === 'indicator').map(c => convertBlockToIndicatorCondition(c, mainPair))
    : [];

  const order = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M'];
  const resolvedTimeframe = timeframe || (() => {
    const tfs = [entryChildren, exitChildren].flat()
      .map(c => c.timeframe || '5m');
    const idxs = tfs.map(tf => order.indexOf(tf)).filter(i => i >= 0);
    return (idxs.length > 0 ? order[Math.min(...idxs)] : '5m') as FreqtradeTimeframe;
  })();

  return {
    id: strategyId,
    name: strategyName,
    timeframe: resolvedTimeframe,
    entry: { logic: 'AND', children: entryChildren },
    exit: { logic: 'AND', children: exitChildren },
    stoploss: -1,
    minimalRoi: { '0': 100 },
    tradingMode: deriveTradingMode(entryChildren),
    timeWindows: timeWindows.length > 0 ? timeWindows : undefined,
  };
}

function convertBlockToIndicatorCondition(block: ConditionBlock, mainPair?: string): IndicatorCondition {
  const p = block.params;
  const indicator = (p.indicator || 'RSI') as FreqtradeIndicator;
  const operator = (p.operator || '<') as FreqtradeOperator;

  let operand: Operand;
  const operandKind = String(p.operandKind || 'constant');
  if (operandKind === 'price') {
    operand = { kind: 'price', source: (p.operandSource || 'close') as PriceSource };
  } else if (operandKind === 'indicator') {
    operand = {
      kind: 'indicator',
      indicator: (p.operandIndicator || 'RSI') as FreqtradeIndicator,
      output: p.operandOutput as string | undefined,
    };
  } else {
    operand = { kind: 'constant', value: Number(p.operandValue || 0) };
  }

  const inner = (p.params && typeof p.params === 'object') ? p.params as Record<string, unknown> : {};
  const params: Record<string, number> = {};
  for (const [k, v] of Object.entries(inner)) {
    const n = Number(v);
    if (!isNaN(n) && n > 0) params[k] = n;
  }

  const rawPair = p.pair && p.pair !== '__custom__' ? String(p.pair) : undefined;
  const pair = (rawPair && mainPair && isSamePair(rawPair, mainPair)) ? undefined : rawPair;

  return {
    category: 'indicator',
    indicator,
    params,
    output: p.output as string | undefined,
    source: (p.source || 'close') as PriceSource | undefined,
    timeframe: undefined,
    pair,
    operator,
    operand,
  };
}

function isSamePair(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/-SWAP$/i, '').replace('-', '/').replace(/:USDT$/i, '').toUpperCase();
  return norm(a) === norm(b);
}

export function parseMinimalRoi(text: string): Record<string, number> {
  const result: Record<string, number> = {};
  if (!text.trim()) return { '0': 0.05 };

  const parts = text.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const val = Number(trimmed.slice(colonIdx + 1).trim());
    if (key !== '' && !isNaN(val)) {
      result[key] = val;
    }
  }

  return Object.keys(result).length > 0 ? result : { '0': 0.05 };
}

export function serializeMinimalRoi(roi: Record<string, number>): string {
  return Object.entries(roi)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
}

function deriveTradingMode(children: IndicatorCondition[]): 'futures' | 'spot' {
  const pairs = children.map(c => c.pair).filter(Boolean) as string[];
  if (pairs.length === 0) return 'futures';
  const hasSwap = pairs.some(p => p.toUpperCase().endsWith('-SWAP'));
  return hasSwap ? 'futures' : 'spot';
}

export function validatePairTypeConsistency(conditions: ConditionBlock[]): string | null {
  const indicatorConds = conditions.filter(c => c.type === 'indicator');
  const pairs = indicatorConds
    .map(c => c.params?.pair)
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '');

  if (pairs.length <= 1) return null;

  const types = pairs.map(p => p.toUpperCase().endsWith('-SWAP') ? 'swap' : 'spot');
  const firstType = types[0];
  const mismatched = types.find(t => t !== firstType);
  if (mismatched) {
    const swapPairs = pairs.filter(p => p.toUpperCase().endsWith('-SWAP'));
    const spotPairs = pairs.filter(p => !p.toUpperCase().endsWith('-SWAP'));
    return `交易对类型不统一：${swapPairs.join('、')} 为合约，${spotPairs.join('、')} 为现货，同一策略中不可混用`;
  }
  return null;
}

export function classifyConditions(conditions: ConditionBlock[]): ConditionClassification {
  const backtestable = conditions.filter(c => BACKTESTABLE_CONDITION_TYPES.has(c.type));
  const liveOnly = conditions.filter(c => !BACKTESTABLE_CONDITION_TYPES.has(c.type));
  return {
    backtestableCount: backtestable.length,
    liveOnlyCount: liveOnly.length,
    liveOnlyLabels: liveOnly.map(c => CONDITION_TYPE_LOG_LABELS[c.type] || c.type),
  };
}
