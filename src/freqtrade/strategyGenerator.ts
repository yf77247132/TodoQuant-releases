
import type {
  FreqtradeStrategySpec,
  IndicatorCondition,
  FreqtradeIndicator,
  FreqtradeTimeframe,
  PriceSource,
  Operand,
  TimeWindowSpec,
} from '../types/freqtrade.ts';

import {
  INDICATOR_MAP,
  OPERATOR_MAP,
} from './transpileMap.ts';

const IND = '    ';
const IND2 = IND + IND;
const IND3 = IND2 + IND;

export function okxPairToFtPair(pair: string): string {
  if (pair.includes('/')) return pair;
  if (pair.endsWith('-SWAP')) {
    const base = pair.slice(0, -5);
    const parts = base.split('-');
    return `${parts[0]}/${parts[1]}:${parts[1]}`;
  }
  const parts = pair.split('-');
  return `${parts[0]}/${parts[1]}`;
}

export function ftPairToOkxPair(pair: string): string {
  if (!pair.includes('/')) return pair;
  if (pair.includes(':')) {
    const [main, quote] = pair.split(':');
    const [base, currency] = main.split('/');
    return `${base}-${currency}-SWAP`;
  }
  const [base, currency] = pair.split('/');
  return `${base}-${currency}`;
}

function pairToSafeVar(pair: string): string {
  return pair.replace(/[\/:\-]/g, '_').toLowerCase();
}

function informativeSuffix(pair?: string, tf?: string, mainPair?: string, mainTf?: string): string {
  const parts: string[] = [];
  if (pair && okxPairToFtPair(pair) !== mainPair) parts.push(pairToSafeVar(pair));
  if (tf && tf !== mainTf) parts.push(tf);
  return parts.length > 0 ? '_' + parts.join('_') : '';
}

function indicatorColumnName(
  indicator: FreqtradeIndicator,
  params: Record<string, number>,
  output?: string,
): string {
  if (indicator === 'price') {
    return output || 'close';
  }
  if (indicator === 'volume') {
    return 'volume';
  }

  const base = indicator.toLowerCase();

  if (indicator === 'VOL_MA') {
    return 'vol_ma';
  }

  if (output) {
    return `${base}_${output}`;
  }

  const mapping = INDICATOR_MAP[indicator];
  const suffix = mapping.args
    .filter((a) => params[a.name] !== undefined && params[a.name] !== a.default)
    .map((a) => `_${params[a.name]}`)
    .join('');

  return suffix ? `${base}${suffix}` : base;
}

function operandToPy(
  operand: Operand,
  allConditions: IndicatorCondition[],
  mainTimeframe: FreqtradeTimeframe,
  mainPair: string | undefined,
  cond?: IndicatorCondition,
): string {
  switch (operand.kind) {
    case 'constant':
      return String(operand.value);
    case 'price': {
      const suffix = informativeSuffix(cond?.pair, cond?.timeframe, mainPair, mainTimeframe);
      return `dataframe["${operand.source}${suffix}"]`;
    }
    case 'indicator': {
      const refCond = allConditions.find((c) => c.indicator === operand.indicator);
      const colName = indicatorColumnName(
        operand.indicator,
        refCond?.params ?? {},
        operand.output,
      );
      const suffix = informativeSuffix(refCond?.pair, refCond?.timeframe, mainPair, mainTimeframe);
      const effectiveColName = suffix ? `${colName}${suffix}` : colName;
      return `dataframe["${effectiveColName}"]`;
    }
  }
}

function conditionToPy(
  cond: IndicatorCondition,
  allConditions: IndicatorCondition[],
  mainTimeframe: FreqtradeTimeframe,
  mainPair: string | undefined,
): string {
  const leftCol = indicatorColumnName(cond.indicator, cond.params, cond.output || undefined);
  const suffix = informativeSuffix(cond.pair, cond.timeframe, mainPair, mainTimeframe);
  const effectiveLeftCol = suffix ? `${leftCol}${suffix}` : leftCol;
  const left = `dataframe["${effectiveLeftCol}"]`;
  const right = operandToPy(cond.operand, allConditions, mainTimeframe, mainPair, cond);

  const template = OPERATOR_MAP[cond.operator];
  return template.replace('{left}', left).replace('{right}', right);
}

function indicatorUniqueKey(
  indicator: FreqtradeIndicator,
  params: Record<string, number>,
  source?: PriceSource,
): string {
  const mapping = INDICATOR_MAP[indicator];
  const paramPart = mapping.args
    .map((a) => `${a.name}=${params[a.name] ?? a.default}`)
    .join(',');
  const sourcePart = source && source !== 'close' ? `@${source}` : '';
  return `${indicator}(${paramPart})${sourcePart}`;
}

function collectUniqueIndicators(
  conditions: IndicatorCondition[],
): Map<string, { indicator: FreqtradeIndicator; params: Record<string, number>; source?: PriceSource }> {
  const result = new Map<string, { indicator: FreqtradeIndicator; params: Record<string, number>; source?: PriceSource }>();
  for (const cond of conditions) {
    const key = indicatorUniqueKey(cond.indicator, cond.params, cond.source);
    if (!result.has(key)) {
      result.set(key, { indicator: cond.indicator, params: cond.params, source: cond.source });
    }
    if (cond.operand.kind === 'indicator') {
      const refCond = conditions.find(c => c.indicator === cond.operand.indicator);
      const params = refCond?.params || { timeperiod: 14 };
      const opKey = indicatorUniqueKey(cond.operand.indicator, params, refCond?.source);
      if (!result.has(opKey)) {
        result.set(opKey, { indicator: cond.operand.indicator, params, source: refCond?.source });
      }
    }
  }
  return result;
}

function collectInformativeTimeframes(
  conditions: IndicatorCondition[],
  mainTimeframe: FreqtradeTimeframe,
): Set<FreqtradeTimeframe> {
  const result = new Set<FreqtradeTimeframe>();
  for (const cond of conditions) {
    if (cond.timeframe && cond.timeframe !== mainTimeframe) {
      result.add(cond.timeframe);
    }
  }
  return result;
}

function generatePopulateIndicators(
  entryConditions: IndicatorCondition[],
  exitConditions: IndicatorCondition[],
  mainTimeframe: FreqtradeTimeframe,
): string {
  const allConditions = [...entryConditions, ...exitConditions];
  const mainConditions = allConditions.filter(
    (c) => (!c.timeframe || c.timeframe === mainTimeframe) && !c.pair,
  );
  const uniqueIndicators = collectUniqueIndicators(mainConditions);
  const lines: string[] = [];

  for (const [, { indicator, params, source }] of uniqueIndicators) {
    const mapping = INDICATOR_MAP[indicator];

    if (mapping.isBuiltin) continue;

    if (mapping.isRolling) {
      const window = params['window'] ?? mapping.args[0]!.default;
      lines.push(`dataframe["vol_ma"] = dataframe["volume"].rolling(window=${window}).mean()`);
      continue;
    }

    const kwargs = mapping.args
      .map((a) => `${a.name}=${params[a.name] ?? a.default}`)
      .join(', ');
    const kwargsStr = kwargs ? `, ${kwargs}` : '';

    const inputSeries = source && source !== 'close' ? `dataframe["${source}"]` : 'dataframe';

    if (mapping.output === 'single') {
      const colName = indicatorColumnName(indicator, params);
      lines.push(`dataframe["${colName}"] = ${mapping.fn}(${inputSeries}${kwargsStr})`);
    } else {
      const keys = mapping.keys ?? [];
      const tempVar = `_${indicator.toLowerCase()}`;
      const input = mapping.isQtpylib && mapping.inputFn ? mapping.inputFn : 'dataframe';
      lines.push(`${tempVar} = ${mapping.fn}(${input}${kwargsStr})`);
      for (const k of keys) {
        lines.push(`dataframe["${indicator.toLowerCase()}_${k}"] = ${tempVar}["${k}"]`);
      }
      if (indicator === 'STOCH') {
        const hasJ = allConditions.some(
          (c) => c.indicator === 'STOCH' && c.output === 'j',
        );
        if (hasJ) {
          lines.push(`dataframe["stoch_j"] = 3 * dataframe["stoch_slowk"] - 2 * dataframe["stoch_slowd"]`);
        }
      }
    }
  }

  if (lines.length === 0) {
    return `${IND2}pass`;
  }

  return lines.map((line) => `${IND2}${line}`).join('\n');
}

function generateConditionBlock(
  group: { logic: 'AND'; children: IndicatorCondition[] },
  allConditions: IndicatorCondition[],
  mainTimeframe: FreqtradeTimeframe,
  mainPair: string | undefined,
): string {
  if (group.children.length === 0) {
    return '';
  }

  const exprs = group.children.map((cond) => conditionToPy(cond, allConditions, mainTimeframe, mainPair));

  if (exprs.length === 1) {
    return `${IND3}${exprs[0]}`;
  }

  return exprs
    .map((expr, i) => {
      if (i === 0) {
        return `${IND3}${expr}`;
      }
      return `${IND3}& ${expr}`;
    })
    .join('\n');
}

function generateInformativePairs(
  informativeTimeframes: Set<FreqtradeTimeframe>,
  crossPairs: Set<string>,
  mainTimeframe: FreqtradeTimeframe,
  pairWhitelist: string[],
): string | null {
  if (informativeTimeframes.size === 0 && crossPairs.size === 0) {
    return null;
  }

  const lines: string[] = [
    `${IND}def informative_pairs(self):`,
    `${IND2}informative_pairs = []`,
  ];

  if (informativeTimeframes.size > 0) {
    for (const pair of pairWhitelist) {
      for (const tf of informativeTimeframes) {
        lines.push(`${IND2}informative_pairs.append(("${pair}", "${tf}"))`);
      }
    }
  }

  if (crossPairs.size > 0) {
    for (const pair of crossPairs) {
      const ftPair = okxPairToFtPair(pair);
      lines.push(`${IND2}informative_pairs.append(("${ftPair}", "${mainTimeframe}"))`);
      for (const tf of informativeTimeframes) {
        lines.push(`${IND2}informative_pairs.append(("${ftPair}", "${tf}"))`);
      }
    }
  }

  lines.push(`${IND2}return informative_pairs`);
  return lines.join('\n');
}

function generateInformativeBlock(
  allConditions: IndicatorCondition[],
  mainTimeframe: FreqtradeTimeframe,
  crossPairs: Set<string>,
  mainPair: string | undefined,
): string | null {
  type PairTfKey = string;
  const groupMap = new Map<PairTfKey, {
    pair: string | undefined;
    tf: FreqtradeTimeframe | undefined;
    indicators: Map<string, { indicator: FreqtradeIndicator; params: Record<string, number> }>;
    hasPriceOrVolume: boolean;
  }>();

  for (const cond of allConditions) {
    const condPairFt = cond.pair ? okxPairToFtPair(cond.pair) : undefined;
    const isSamePairAsMain = condPairFt && mainPair && condPairFt === mainPair;
    const isCrossPair = !!cond.pair && !isSamePairAsMain;
    const isCrossTf = !!cond.timeframe && cond.timeframe !== mainTimeframe;
    if (!isCrossPair && !isCrossTf) continue;

    const pair = isCrossPair ? cond.pair : undefined;
    const tf = isCrossTf ? cond.timeframe! : (isCrossPair ? mainTimeframe : undefined);
    const effectiveTf = tf ?? mainTimeframe;
    const key = `${pair ?? ''}|${effectiveTf}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        pair,
        tf: effectiveTf,
        indicators: new Map(),
        hasPriceOrVolume: false,
      });
    }

    const group = groupMap.get(key)!;

    const isPriceOnly = (cond.source && !cond.indicator);
    if (!isPriceOnly) {
      const indKey = indicatorUniqueKey(cond.indicator, cond.params);
      if (!group.indicators.has(indKey)) {
        group.indicators.set(indKey, { indicator: cond.indicator, params: cond.params });
      }
      if (cond.indicator === 'VOL_MA') {
        group.hasPriceOrVolume = true;
      }
    } else {
      group.hasPriceOrVolume = true;
    }
  }

  for (const cond of allConditions) {
    if (cond.operand.kind === 'price' && cond.pair) {
      const pair = cond.pair;
      const tf = cond.timeframe ?? mainTimeframe;
      const key = `${pair}|${tf}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          pair,
          tf,
          indicators: new Map(),
          hasPriceOrVolume: true,
        });
      } else {
        groupMap.get(key)!.hasPriceOrVolume = true;
      }
    }
  }

  if (groupMap.size === 0 && crossPairs.size === 0) {
    return null;
  }

  if (groupMap.size === 0) {
    return null;
  }

  const lines: string[] = [];

  for (const [, group] of groupMap) {
    const { pair, tf, indicators } = group;
    const effectiveTf = tf ?? mainTimeframe;

    const isCurrentPair = !pair;
    const varName = isCurrentPair
      ? `informative_${effectiveTf}`
      : `inf_${pairToSafeVar(pair!)}_${effectiveTf}`;

    const suffix = informativeSuffix(pair, effectiveTf, undefined, mainTimeframe);
    const mergeSuffix = suffix.slice(1);

    const pairArg = isCurrentPair ? 'metadata["pair"]' : `"${okxPairToFtPair(pair!)}"`;
    lines.push(`${IND2}${varName} = self.dp.get_pair_dataframe(pair=${pairArg}, timeframe="${effectiveTf}")`);

    for (const [, { indicator, params }] of indicators) {
      const mapping = INDICATOR_MAP[indicator];

      if (mapping.isBuiltin) continue;

      if (mapping.isRolling) {
        const window = params['window'] ?? mapping.args[0]!.default;
        lines.push(`${IND2}${varName}["vol_ma"] = ${varName}["volume"].rolling(window=${window}).mean()`);
        continue;
      }

      const kwargs = mapping.args
        .map((a) => `${a.name}=${params[a.name] ?? a.default}`)
        .join(', ');
      const kwargsStr = kwargs ? `, ${kwargs}` : '';

      if (mapping.output === 'single') {
        const colName = indicatorColumnName(indicator, params);
        if (mapping.inputFn) {
          const infInputFn = mapping.inputFn.replace('dataframe', varName);
          lines.push(`${IND2}${varName}["${colName}"] = ${mapping.fn}(${infInputFn}${kwargsStr})`);
        } else {
          lines.push(`${IND2}${varName}["${colName}"] = ${mapping.fn}(${varName}${kwargsStr})`);
        }
      } else {
        const keys = mapping.keys ?? [];
        if (mapping.isQtpylib && mapping.inputFn) {
          const prefix = indicator.toLowerCase();
          const leftVars = keys.map((k) => `${prefix}_${k}`).join(', ');
          const infInputFn = mapping.inputFn.replace('dataframe', varName);
          lines.push(`${IND2}${leftVars} = ${mapping.fn}(${infInputFn}${kwargsStr})`);
          for (const k of keys) {
            lines.push(`${IND2}${varName}["${indicator.toLowerCase()}_${k}"] = ${prefix}_${k}`);
          }
        } else {
          const leftVars = keys.map((k) => k).join(', ');
          lines.push(`${IND2}${leftVars} = ${mapping.fn}(${varName}${kwargsStr})`);
          for (const k of keys) {
            lines.push(`${IND2}${varName}["${indicator.toLowerCase()}_${k}"] = ${k}`);
          }
        }
      }
    }

    lines.push(`${IND2}dataframe = merge_informative_pair(dataframe, ${varName}, "${mainTimeframe}", "${effectiveTf}", ffill=True, append_timeframe=False, suffix="${mergeSuffix}")`);
  }

  return lines.join('\n');
}

function computeStartupCandles(allConditions: IndicatorCondition[]): number {
  let maxPeriod = 0;

  for (const cond of allConditions) {
    const mapping = INDICATOR_MAP[cond.indicator];

    if (mapping.isBuiltin) continue;

    for (const arg of mapping.args) {
      const value = cond.params[arg.name] ?? arg.default;
      if (value > maxPeriod) maxPeriod = value;
    }

    if (cond.indicator === 'MACD') {
      const slow = cond.params['slow'] ?? 26;
      if (slow > maxPeriod) maxPeriod = slow;
    }
    if (cond.indicator === 'STOCH') {
      const slowk = cond.params['slowk_period'] ?? 14;
      if (slowk > maxPeriod) maxPeriod = slowk;
    }
    if (cond.indicator === 'BB') {
      const window = cond.params['window'] ?? 20;
      if (window > maxPeriod) maxPeriod = window;
    }
    if (cond.indicator === 'VOL_MA') {
      const w = cond.params['window'] ?? 20;
      if (w > maxPeriod) maxPeriod = w;
    }
  }

  return maxPeriod > 0 ? maxPeriod + 5 : 0;
}

function generateTimeWindowCheck(timeWindows: TimeWindowSpec[]): string {
  const parts: string[] = [];

  for (const tw of timeWindows) {
    const [startH, startM] = tw.startTime.split(':').map(Number);
    const [endH, endM] = tw.endTime.split(':').map(Number);
    const startMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;

    const timeCond = startMin <= endMin
      ? `(dataframe["date"].dt.hour * 60 + dataframe["date"].dt.minute >= ${startMin}) & (dataframe["date"].dt.hour * 60 + dataframe["date"].dt.minute < ${endMin})`
      : `((dataframe["date"].dt.hour * 60 + dataframe["date"].dt.minute >= ${startMin}) | (dataframe["date"].dt.hour * 60 + dataframe["date"].dt.minute < ${endMin}))`;

    if (tw.days.length > 0) {
      const daysPy = `[${tw.days.join(', ')}]`;
      parts.push(`(${timeCond} & (dataframe["date"].dt.dayofweek.isin(${daysPy})))`);
    } else {
      parts.push(`(${timeCond})`);
    }
  }

  return parts.length === 1 ? parts[0] : `(${parts.join(' |\n    ')})`;
}

export function generateStrategyFile(spec: FreqtradeStrategySpec, mainPair?: string, mode: 'live' | 'backtest' = 'live'): string {
  const allConditions = [...spec.entry.children, ...spec.exit.children];
  const isBacktest = mode === 'backtest';

  const informativeTimeframes = new Set<FreqtradeTimeframe>();
  for (const tf of collectInformativeTimeframes(spec.entry.children, spec.timeframe)) {
    informativeTimeframes.add(tf);
  }
  for (const tf of collectInformativeTimeframes(spec.exit.children, spec.timeframe)) {
    informativeTimeframes.add(tf);
  }

  const crossPairs = new Set<string>();
  for (const cond of allConditions) {
    if (cond.pair && okxPairToFtPair(cond.pair) !== mainPair) crossPairs.add(cond.pair);
    if (cond.operand.kind === 'price' && cond.pair && okxPairToFtPair(cond.pair) !== mainPair) {
      crossPairs.add(cond.pair);
    }
  }

  const needsQtpylib =
    allConditions.some((c) => c.operator === 'cross_above' || c.operator === 'cross_below') ||
    allConditions.some((c) => INDICATOR_MAP[c.indicator]?.isQtpylib);

  const needsMerge = informativeTimeframes.size > 0 || crossPairs.size > 0;

  const headerLines: string[] = [
    '# Auto-generated by TodoQuant transpile — DO NOT EDIT MANUALLY',
    'import numpy as np',
    'import pandas as pd',
    'from pandas import DataFrame',
    'from freqtrade.strategy import IStrategy',
    'from datetime import datetime',
    'import talib.abstract as ta',
  ];
  if (needsQtpylib) {
    headerLines.push('from technical import qtpylib');
  }
  if (needsMerge) {
    headerLines.push('from freqtrade.strategy import merge_informative_pair');
  }

  const effectiveStoploss = isBacktest && spec.backtest ? spec.backtest.stoploss : spec.stoploss;
  const effectiveMinimalRoi = isBacktest && spec.backtest ? spec.backtest.minimalRoi : spec.minimalRoi;

  const roiItems = Object.entries(effectiveMinimalRoi)
    .map(([k, v]) => `"${k}": ${v}`)
    .join(', ');
  const minimalRoiPy = `{${roiItems}}`;

  const safeId = spec.id.replace(/[^a-zA-Z0-9]/g, '_');
  const className = `GenStrategy_${safeId}`;

  const indicatorsCode = generatePopulateIndicators(spec.entry.children, spec.exit.children, spec.timeframe);
  const informativeBlock = generateInformativeBlock(allConditions, spec.timeframe, crossPairs, mainPair);
  const isIndicatorsJustPass = indicatorsCode.trim() === 'pass';
  const fullIndicatorsBody = informativeBlock
    ? (isIndicatorsJustPass ? informativeBlock : `${informativeBlock}\n${indicatorsCode}`)
    : indicatorsCode;

  let entryConditions = generateConditionBlock(spec.entry, allConditions, spec.timeframe, mainPair);
  if (spec.timeWindows && spec.timeWindows.length > 0) {
      const timeWindowCheck = generateTimeWindowCheck(spec.timeWindows);
      if (entryConditions) {
          entryConditions = timeWindowCheck + ' &\n' + entryConditions;
      } else {
          entryConditions = timeWindowCheck;
      }
  }
  const hasEntryConditions = entryConditions !== '';

  const exitConditions = generateConditionBlock(spec.exit, allConditions, spec.timeframe, mainPair);
  const hasExitConditions = exitConditions !== '';

  const informativePairsCode = generateInformativePairs(informativeTimeframes, crossPairs, spec.timeframe, spec.pairWhitelist);

  const startupCandles = computeStartupCandles(allConditions);

  const parts: string[] = [];

  parts.push(headerLines.join('\n'));
  parts.push('');

  parts.push(`class ${className}(IStrategy):`);
  parts.push(`${IND}INTERFACE_VERSION = 3`);
  const isLongOnly = mode === 'backtest' && spec.tradingDirection !== 'short';
  const isShortOnly = mode === 'backtest' && spec.tradingDirection === 'short';
  parts.push(`${IND}can_short: bool = ${isShortOnly ? 'True' : 'False'}`);
  parts.push(`${IND}timeframe = "${spec.timeframe}"`);
  parts.push(`${IND}stoploss = ${effectiveStoploss}`);
  if (isBacktest) {
    parts.push(`${IND}minimal_roi = ${minimalRoiPy}`);
  } else {
    parts.push(`${IND}minimal_roi = ${minimalRoiPy}  # 已禁用：平仓由 OKTS ClosePositionAction 接管`);
  }

  parts.push(`${IND}process_only_new_candles = False  # 逐根K线完整处理`);

  if (!isBacktest) {
    parts.push(`${IND}use_custom_stoploss = True  # 阻止 freqtrade 自身下单平仓`);
  }

  if (isBacktest && spec.backtest?.trailingStopEnabled) {
    parts.push(`${IND}trailing_stop = True`);
    if (spec.backtest.trailingStopPositive != null) {
      parts.push(`${IND}trailing_stop_positive = ${spec.backtest.trailingStopPositive}`);
    }
    if (spec.backtest.trailingOnlyOffsetIsReached !== false) {
      parts.push(`${IND}trailing_only_offset_is_reached = True`);
    }
  }

  if (startupCandles > 0) {
    parts.push(`${IND}startup_candle_count: int = ${startupCandles}`);
  }
  parts.push('');

  if (informativePairsCode) {
    parts.push(informativePairsCode);
    parts.push('');
  }

  if (!isBacktest) {
    parts.push(`${IND}def custom_stoploss(self, pair: str, trade: "Trade", current_time: datetime, current_rate: float, current_profit: float, after_fill: bool, **kwargs) -> float:`);
    parts.push(`${IND2}# 永不返回有效值：阻止 freqtrade 自己平仓`);
    parts.push(`${IND2}return -1`);
    parts.push('');
  }

  if (!isBacktest) {
    parts.push(`${IND}def custom_exit(self, pair: str, trade: "Trade", current_time: datetime, current_rate: float, current_profit: float, **kwargs) -> str | None:`);
    parts.push(`${IND2}# ⚠️ 每根K线都退出虚拟仓位（OKTS 侧忽略 exit webhook，不触发真实平仓）`);
    parts.push(`${IND2}return "force_exit"`);
    parts.push('');
  }

  parts.push(`${IND}def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:`);
  const needsFixes = fullIndicatorsBody !== `${IND2}pass`;
  if (needsFixes) {
    parts.push(`${IND2}# ⚠️ 确保 OHLCV 列为 float64（CCXT live 数据可能混入 pyarrow string）`);
    parts.push(`${IND2}for col in ["open","high","low","close","volume"]:`);
    parts.push(`${IND2}    dataframe[col] = dataframe[col].astype(float)`);
  }
  parts.push(fullIndicatorsBody);
  parts.push(`${IND}    return dataframe`);
  parts.push('');

  parts.push(`${IND}def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:`);
  if (hasEntryConditions) {
    const canShort = isShortOnly;
    const emitLong = !isShortOnly;
    const emitShort = canShort;
    if (emitLong) {
      parts.push(`${IND2}#做多入场`);
      parts.push(`${IND2}dataframe.loc[`);
      parts.push(entryConditions);
      parts.push(`${IND3}& (dataframe["volume"] > 0),`);
      parts.push(`${IND3}"enter_long"`);
      parts.push(`${IND2}] = 1`);
    }
    if (emitShort) {
      parts.push(`${IND2}#做空入场`);
      parts.push(`${IND2}dataframe.loc[`);
      parts.push(entryConditions);
      parts.push(`${IND3}& (dataframe["volume"] > 0),`);
      parts.push(`${IND3}"enter_short"`);
      parts.push(`${IND2}] = 1`);
    }
  } else {
    parts.push(`${IND2}pass`);
  }
  parts.push(`${IND}    return dataframe`);
  parts.push('');

  parts.push(`${IND}def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:`);
  if (hasExitConditions) {
    parts.push(`${IND2}dataframe.loc[`);
    parts.push(exitConditions);
    parts.push(`${IND3},`);
    parts.push(`${IND3}"exit_long"`);
    parts.push(`${IND2}] = 1`);
    parts.push(`${IND2}#做空出场（v1 暂不实现，保留空位）`);
  } else {
    parts.push(`${IND2}pass`);
  }
  parts.push(`${IND}    return dataframe`);

  return parts.join('\n') + '\n';
}
