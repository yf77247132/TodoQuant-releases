import { AccountMonitor } from '../../../services/AccountMonitor.ts';
import { SymbolUtils } from '../../../lib/symbolUtils.ts';
import { loadSavedConfig } from '../../../services/configService.ts';
import { calculateLiquidationDistance } from '../../../lib/positionUtils.ts';
import { LogService } from '../../../services/logService.ts';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from '../../../services/errorMonitor.ts';
import { DIYStrategy, ConditionTemplate, ConditionBlock } from '../../../types/diy.ts';
import { OPERATOR_LABELS, COND_FIELD_LABELS, CONDITION_TYPE_LOG_LABELS } from '../../../constants/conditionLabels.ts';
import { AppConfig } from '../../../types/core.ts';
import { AccountData } from '../../../types/monitorTypes.ts';
import { OKXPosition } from '../../../types/okx.ts';
import { hasSignalForSource, getSignalForSource, hasAnySignal } from './signalQueue.ts';
import { t } from '../../../lib/translateKey.ts';

export interface ConditionEvaluatorDeps {
  conditionState: Map<string, { result: boolean; lastLoggedAt: number }>;
  liveStates: Map<string, { result: boolean; currentVal: string }>;
  userTimezone: string | null;
  lastTriggeredMap: Map<string, number>;
  pendingSignals: Map<string, { receivedAt: number; payload: unknown }>;
  fundingRateCache: Map<string, string>;
  checkSafetyLocks: (strategy: DIYStrategy, template: ConditionTemplate) => boolean;
}

function resolveAccountName(params: Record<string, unknown>, accountIdx: number, appConfig: AppConfig): string {
  const aid = String(params?.accountId || '').trim();
  if (aid && appConfig?.accounts) {
    const acc = appConfig.accounts.find((a) => a.id === aid);
    if (acc) return acc.name;
    if (appConfig.accountNames?.[aid]) return appConfig.accountNames[aid];
  }
  return appConfig?.accountNames?.[accountIdx] || `账户 #${accountIdx}`;
}

const getPositions = (
  accountData: AccountData | null,
  instId?: string
): OKXPosition[] => {
  const all = accountData?.positions || [];
  return instId ? all.filter((p) => SymbolUtils.isSameSymbol(p.instId, instId)) : all;
};

const forEachPosition = (
  accountData: AccountData | null,
  instId: string | undefined,
  cb: (p: OKXPosition) => void
): void => {
  for (const p of getPositions(accountData, instId)) cb(p);
};

export function evaluateTemplateCore(
  deps: ConditionEvaluatorDeps,
  strategy: DIYStrategy,
  template: ConditionTemplate,
  triggerAccountIdx: number,
  appConfig: AppConfig
): boolean {
  if (!template.conditions || template.conditions.length === 0) return false;
  if (!deps.checkSafetyLocks(strategy, template)) return false;

  const hadPendingSignal = hasAnySignal(deps.pendingSignals, strategy.id);
  const results: { idx: number; type: string; matched: boolean }[] = [];
  let allMatched = true;
  for (let i = 0; i < template.conditions.length; i++) {
    const condition = template.conditions[i];
    let targetIdx = triggerAccountIdx;
    const accountId = String(condition.params?.accountId || '').trim();
    if (accountId && appConfig.accounts) {
      const foundIdx = appConfig.accounts.findIndex((a) => a.id === accountId);
      if (foundIdx >= 0) targetIdx = foundIdx;
    }
    const data = AccountMonitor.getInstance().getAccountData(targetIdx);
    const ok = evaluateSingleConditionCore(deps, strategy, condition, data, strategy.id, i, targetIdx);
    results.push({ idx: i, type: condition.type, matched: ok });
    if (!ok) allMatched = false;
  }

  if (hadPendingSignal && !allMatched) {
    const failed = results.filter(r => !r.matched);
    const allFailedAreIndicator = failed.every(r => r.type === 'indicator');
    if (allFailedAreIndicator) {
      allMatched = true;
    } else {
      const warnKey = `__signalWarned:${strategy.id}`;
      if (!deps.conditionState.has(warnKey)) {
        const failedTypes = failed.map(r => r.type).join(', ');
        LogService.logKey('diy', 'diy.tv.unmatched', { name: strategy.name, failed: failedTypes }, 'warn', strategy.id);
        deps.conditionState.set(warnKey, { result: true, lastLoggedAt: Date.now() });
      }
    }
  }

  if (!hadPendingSignal) {
    deps.conditionState.delete(`__signalWarned:${strategy.id}`);
  }

  return allMatched;
}

export function evaluateSingleConditionCore(
  deps: ConditionEvaluatorDeps,
  strategy: DIYStrategy,
  condition: ConditionBlock,
  accountData: AccountData | null,
  configId: string,
  condIdx: number,
  accountIdx: number
): boolean {
  const { type, params } = condition;
  const now = Date.now();

  const stateKey = `${strategy.id}:${accountIdx}:${condIdx}`;
  const prevState = deps.conditionState.get(stateKey);
  const { result, currentVal } = doEvaluateCore(deps, strategy, condition, accountData, now);

  deps.liveStates.set(stateKey, { result, currentVal });

  if (!accountData && !['time_window', 'cooldown', 'count_limit', 'tv_signal', 'indicator'].includes(type)) {
    if (now % 30000 < 1000) LogService.logKey('diy', 'diy.condition.notReady', { id: configId }, 'warn', configId);
    return false;
  }

  const hasChanged = !prevState || prevState.result !== result;
  const isTimeout = prevState && (now - prevState.lastLoggedAt > 300000);
  const isSpecialType = ['time_window', 'cooldown', 'count_limit'].includes(type);

  if (hasChanged || isTimeout) {
    if ((type === 'tv_signal' || type === 'indicator') && !result && isTimeout) {
      deps.conditionState.set(stateKey, { result, lastLoggedAt: now });
    } else {
      const msg = getEvaluationLogMessageCore(deps, type, params, accountData, result, now, strategy, accountIdx);
      if (msg) LogService.logKey('diy', 'diy.condition.eval', { detail: msg }, 'info', configId);
      deps.conditionState.set(stateKey, { result, lastLoggedAt: now });
    }
  } else if (isSpecialType) {
    const msg = getSpecialPeriodicLogCore(deps, type, params, strategy, result, now);
    if (msg) LogService.logKey('diy', 'diy.condition.eval', { detail: msg }, 'info', configId);
  }

  return result;
}

export function doEvaluateCore(
  deps: ConditionEvaluatorDeps,
  strategy: DIYStrategy,
  condition: ConditionBlock,
  accountData: AccountData | null,
  now: number
): { result: boolean; currentVal: string } {
  const { type, params } = condition;
  if (!accountData && !['time_window', 'cooldown', 'count_limit', 'tv_signal', 'indicator'].includes(type)) {
    return { result: false, currentVal: '无数据' };
  }

  if (type === 'indicator') {
    const hasFtSignal = hasSignalForSource(deps.pendingSignals, strategy.id, 'ft');
    if (!hasFtSignal) return { result: false, currentVal: '等 freqtrade webhook' };
    return { result: true, currentVal: '收到FT信号' };
  }

  const sp = params as Record<string, string>;

  const comp = (a: number, op: string, b: number) => {
    const normalized = op === ':' ? '=' : op;
    switch (normalized) {
      case '>': return a > b;
      case '<': return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
      case '=': return a === b;
      default: return false;
    }
  };

  switch (type) {
    case 'balance_less': {
      const ccy = sp.ccy || 'USDT';
      const detail = accountData.balances?.details?.find((d) => d.ccy === ccy);
      const val = parseFloat(detail?.availBal || '0');
      const target = parseFloat(sp.threshold || '0');
      return { result: comp(val, sp.operator || '<', target), currentVal: `${val.toFixed(2)} ${ccy}` };
    }
    case 'pos_count': {
      const pos = getPositions(accountData, sp.instId);
      const count = pos.length;
      const target = parseFloat(sp.count || '0');
      return { result: comp(count, sp.operator || '=', target), currentVal: `${count} 个` };
    }
    case 'pos_sz_limit': {
      const target = parseFloat(sp.size || '0');
      let sum = 0;
      forEachPosition(accountData, sp.instId, (p) => {
        sum += Math.abs(parseFloat(p.pos || '0'));
      });
      return { result: comp(sum, sp.operator || '>', target), currentVal: sum.toFixed(2) };
    }
    case 'pos_pnl_rate': {
      const target = parseFloat(sp.rate || '0');
      let maxRate = -999;
      let matched = false;
      forEachPosition(accountData, sp.instId, (p) => {
        const r = parseFloat(p.uplRatio || '0') * 100;
        if (r > maxRate) maxRate = r;
        if (comp(r, sp.operator || '>', target)) matched = true;
      });
      return {
        result: matched,
        currentVal: `${(maxRate === -999 ? 0 : maxRate).toFixed(2)}%`
      };
    }
    case 'pos_liq_dist': {
      const target = parseFloat(sp.dist || '0');
      let minDist = 999999;
      let matched = false;
      forEachPosition(accountData, sp.instId, (p) => {
        const d = calculateLiquidationDistance(p);
        if (d !== null) {
          if (d < minDist) minDist = d;
          if (comp(d, sp.operator || '<', target)) matched = true;
        }
      });
      return {
        result: matched,
        currentVal: minDist === 999999 ? 'N/A' : minDist.toFixed(2)
      };
    }
    case 'pos_side': {
      const targetSide = sp.side || '';
      let matched = false;
      const currentSides: string[] = [];
      forEachPosition(accountData, sp.instId, (p) => {
        let current = 'none';
        if (p.posSide === 'long' || p.posSide === 'short') {
          current = p.posSide;
        } else {
          const v = parseFloat(p.pos || '0');
          current = v > 0 ? 'long' : (v < 0 ? 'short' : 'none');
        }
        if (current !== 'none') currentSides.push(current);
        if (current === targetSide) matched = true;
      });
      return { result: matched, currentVal: currentSides.length > 0 ? currentSides.join('/') : '无持仓' };
    }
    case 'pos_pnl_amount':
    case 'pos_pnl_limit': {
      const target = parseFloat(sp.amount || sp.threshold || '0');
      let total = 0;
      forEachPosition(accountData, sp.instId, (p) => {
        total += parseFloat(p.upl || '0');
      });
      return { result: comp(total, sp.operator || '>', target), currentVal: total.toFixed(2) };
    }
    case 'pos_margin':
    case 'pos_margin_less': {
      const target = parseFloat(sp.margin || sp.threshold || '0');
      let totalMargin = 0;
      forEachPosition(accountData, sp.instId, (p) => {
        const m = parseFloat(p.mgnMode === 'cross' ? p.imr : p.margin);
        totalMargin += m;
      });
      return { result: comp(totalMargin, sp.operator || '>', target), currentVal: totalMargin.toFixed(2) };
    }
    case 'pos_mgn_ratio':
    case 'pos_mgn_ratio_val': {
      const target = parseFloat(sp.ratio || sp.threshold || '0');
      let maxRatio = -1;
      forEachPosition(accountData, sp.instId, (p) => {
        const r = parseFloat(p.mgnRatio || '0') * 100;
        if (r > maxRatio) maxRatio = r;
      });
      return {
        result: comp(maxRatio === -1 ? 0 : maxRatio, sp.operator || '>', target),
        currentVal: `${(maxRatio === -1 ? 0 : maxRatio).toFixed(2)}%`
      };
    }
    case 'pos_funding_rate': {
      const target = parseFloat(sp.rate || sp.threshold || '0');
      const instId = sp.instId || '';
      if (!instId) return { result: false, currentVal: '未指定交易对' };
      const cachedRate = deps.fundingRateCache.get(instId);
      if (!cachedRate) return { result: false, currentVal: '数据未就绪' };
      const rateVal = parseFloat(cachedRate) * 100;
      return {
        result: comp(rateVal, sp.operator || '>', target),
        currentVal: `${rateVal.toFixed(4)}%`
      };
    }
    case 'time_window': {
      const { startTime, endTime, days } = params as { startTime?: string; endTime?: string; days?: number[] };
      if (!startTime || !endTime) return { result: true, currentVal: '未设置' };
      const tz = deps.userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const d = new Date(now);
      const tStr = d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: tz });
      const getTzDay = (date: Date, timeZone: string) => {
        const dayStr = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
          .formatToParts(date)
          .find(p => p.type === 'weekday')?.value;
        const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        return dayStr ? map[dayStr] : date.getDay();
      };
      const currentDay = getTzDay(d, tz);
      let dayMatched = true;
      if (Array.isArray(days) && days.length > 0) dayMatched = days.includes(currentDay);
      let timeMatched = false;
      if (startTime <= endTime) timeMatched = tStr >= startTime && tStr <= endTime;
      else timeMatched = tStr >= startTime || tStr <= endTime;
      return { result: dayMatched && timeMatched, currentVal: tStr };
    }
    case 'cooldown': {
      const ms = (parseInt(sp.minutes || '0') * 60 + parseInt(sp.seconds || '0')) * 1000;
      const last = deps.lastTriggeredMap.get(strategy.id) || strategy.lastTriggered || 0;
      const diff = now - last;
      return {
        result: ms === 0 || diff >= ms,
        currentVal: ms === 0 ? t('engine.noCooldown') : (diff < ms ? `还剩 ${Math.ceil((ms - diff) / 1000)}s` : '冷却完成')
      };
    }
    case 'count_limit': {
      const limit = parseInt(sp.limit || '1');
      const count = strategy.triggerCount || 0;
      return { result: count < limit, currentVal: `${count}/${limit}` };
    }
    case 'tv_signal': {
      const hasTvSignal = hasSignalForSource(deps.pendingSignals, strategy.id, 'tv');
      if (!hasTvSignal) return { result: false, currentVal: t('engine.no') };
      return { result: true, currentVal: t('engine.yes') };
    }
    default:
      return { result: false, currentVal: '未知类型' };
  }
}

const INDICATOR_DEFAULT_PERIOD: Record<string, number> = {
  RSI: 14, EMA: 21, SMA: 21, ATR: 14, ADX: 14, CCI: 14, MFI: 14, MACD: 12, STOCH: 14, BB: 20, VOL_MA: 20,
};

const INDICATOR_DISPLAY: Record<string, string> = {
  STOCH: 'KDJ', VOL_MA: 'VOL-MA', volume: 'VOL', BB: 'BOLL',
};

const SUB_LABELS: Record<string, string> = {
  macd: 'DIFF', macdsignal: 'DEA', macdhist: 'STICK',
  lower: 'LB', mid: 'BOLL', upper: 'UB',
  slowk: 'KDJ-K', slowd: 'KDJ-D', j: 'KDJ-J',
};

const PRICE_LABELS: Record<string, string> = {
  open: t('indicators.priceOpen'), high: t('indicators.priceHigh'),
  low: t('indicators.priceLow'), close: t('indicators.priceClose'), volume: t('indicators.volume'),
};

function formatIndicatorName(name: string, params: Record<string, unknown>): string {
  const sp = params as Record<string, string | number | undefined>;
  const inner = (sp.params && typeof sp.params === 'object' && !Array.isArray(sp.params))
    ? sp.params as Record<string, string | number | undefined>
    : null;

  if (name === 'price') {
    const source = String(sp.source || inner?.source || 'close');
    return PRICE_LABELS[source] || name;
  }

  const display = INDICATOR_DISPLAY[name] || name;

  const period = sp.timeperiod ?? sp.window ?? inner?.timeperiod ?? inner?.window ?? INDICATOR_DEFAULT_PERIOD[name];
  const base = period !== undefined ? `${display}(${period})` : display;

  const output = String(sp.output || inner?.output || '');
  const subLabel = SUB_LABELS[output];
  if (!subLabel) return base;
  return period !== undefined ? `${base}/${subLabel}(${period})` : `${base}/${subLabel}`;
}

export function getEvaluationLogMessageCore(
  deps: ConditionEvaluatorDeps,
  type: string,
  params: Record<string, unknown>,
  accountData: AccountData | null,
  result: boolean,
  now: number,
  strategy: DIYStrategy,
  accountIdx: number
): string | null {
  if (!accountData && !['time_window', 'cooldown', 'count_limit', 'indicator'].includes(type)) return null;
  const resStr = result ? t('engine.triggered') : t('engine.notTriggered');
  const sp = params as Record<string, string>;

  const acc = resolveAccountName(params, accountIdx, (() => {
    try { return loadSavedConfig(); } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      LogService.logKey('diy', 'diy.configLoadFailed', { msg: error.message }, 'error');
      ErrorMonitor.captureError(error, ErrorLevel.MEDIUM, ErrorCategory.SYSTEM);
      return { accounts: [], accountNames: {} } as AppConfig;
    }
  })());
  const typeLabel = CONDITION_TYPE_LOG_LABELS[type] || type;

  switch (type) {
    case 'balance_less': {
      const ccy = sp.ccy || 'USDT';
      const bal = parseFloat(accountData?.balances?.details?.find((d) => d.ccy === ccy)?.availBal || '0');
      const opL = OPERATOR_LABELS[sp.operator || '<'] || sp.operator;
      return `${t('engine.detecting')}: ${acc}, ${COND_FIELD_LABELS.bl_field}: ${bal}, ${COND_FIELD_LABELS.bl_threshold}: ${sp.threshold}, ${COND_FIELD_LABELS.bl_operator}: ${opL}, 结果: ${resStr}`;
    }
    case 'pos_count': {
      const pos = getPositions(accountData, sp.instId);
      const opL = OPERATOR_LABELS[sp.operator || '='] || sp.operator;
      return `${t('engine.detecting')}: ${acc}, ${COND_FIELD_LABELS.pc_instrument}: ${sp.instId || t('engine.all')}, ${COND_FIELD_LABELS.pc_field}: ${pos.length}, ${COND_FIELD_LABELS.pc_target}: ${sp.count}, ${COND_FIELD_LABELS.pc_operator}: ${opL}, 结果: ${resStr}`;
    }
    case 'pos_sz_limit': {
      let sz = 0;
      const targetId = sp.instId || '';
      forEachPosition(accountData, targetId, (p) => {
        sz += Math.abs(parseFloat(p.pos || '0'));
      });
      const opL = OPERATOR_LABELS[sp.operator || '>'] || sp.operator;
      return `${t('engine.detecting')}: ${acc}, ${COND_FIELD_LABELS.psl_instrument}: ${targetId || t('engine.all')}, ${COND_FIELD_LABELS.psl_field}: ${sz}, ${COND_FIELD_LABELS.psl_target}: ${sp.size}, ${COND_FIELD_LABELS.psl_operator}: ${opL}, 结果: ${resStr}`;
    }
    case 'pos_pnl_rate': {
      const targetId = sp.instId || '';
      let max = -999;
      forEachPosition(accountData, targetId, (p) => {
        const r = parseFloat(p.uplRatio || '0') * 100;
        if (r > max) max = r;
      });
      const opL = OPERATOR_LABELS[sp.operator || '>'] || sp.operator;
      return `${t('engine.detecting')}: ${acc}, ${COND_FIELD_LABELS.pr_instrument}: ${targetId || t('engine.all')}, ${COND_FIELD_LABELS.pr_field}: ${(max === -999 ? 0 : max).toFixed(2)}%, ${COND_FIELD_LABELS.pr_target}: ${sp.rate}%, ${COND_FIELD_LABELS.pr_operator}: ${opL}, 结果: ${resStr}`;
    }
    case 'pos_liq_dist': {
      const targetId = sp.instId || '';
      let min = 999999;
      forEachPosition(accountData, targetId, (p) => {
        const d = calculateLiquidationDistance(p);
        if (d !== null && d < min) min = d;
      });
      const opL = OPERATOR_LABELS[sp.operator || '<'] || sp.operator;
      return `${t('engine.detecting')}: ${acc}, ${COND_FIELD_LABELS.pl_instrument}: ${targetId || t('engine.all')}, ${COND_FIELD_LABELS.pl_field}: ${min === 999999 ? t('engine.none') : min.toFixed(2)}, ${COND_FIELD_LABELS.pl_target}: ${sp.dist}, ${COND_FIELD_LABELS.pl_operator}: ${opL}, 结果: ${resStr}`;
    }
    case 'pos_side': {
      const targetId = sp.instId || '';
      const rawTargetSide = sp.side || '';
      const sideLabelMap: Record<string, string> = { long: t('engine.positionLong'), short: t('engine.positionShort') };
      const targetSideLabel = sideLabelMap[rawTargetSide] || rawTargetSide || t('engine.none');
      let currentSides: string[] = [];
      forEachPosition(accountData, targetId, (p) => {
        let s = 'none';
        if (p.posSide === 'long' || p.posSide === 'short') s = p.posSide;
        else {
          const v = parseFloat(p.pos || '0');
          s = v > 0 ? 'long' : (v < 0 ? 'short' : 'none');
        }
        if (s !== 'none') currentSides.push(sideLabelMap[s] || s);
      });
      const currentDisplay = currentSides.length > 0 ? currentSides.join('/') : t('engine.none');
      return `${t('engine.detecting')}: ${acc}, ${COND_FIELD_LABELS.ps_instrument}: ${targetId || t('engine.all')}, 仓位方向: ${currentDisplay}, 目标: ${targetSideLabel}, 结果: ${resStr}`;
    }
    case 'pos_pnl_amount':
    case 'pos_pnl_limit': {
      const targetId = sp.instId || '';
      const target = parseFloat(sp.amount || sp.threshold || '0');
      let total = 0;
      forEachPosition(accountData, targetId, (p) => {
        total += parseFloat(p.upl || '0');
      });
      const opL = OPERATOR_LABELS[sp.operator || '>'] || sp.operator;
      return `${t('engine.detecting')}: ${acc}, ${COND_FIELD_LABELS.pa_instrument}: ${targetId || t('engine.all')}, ${COND_FIELD_LABELS.pa_field}: ${total.toFixed(2)}, ${COND_FIELD_LABELS.pa_target}: ${target}, ${COND_FIELD_LABELS.pa_operator}: ${opL}, 结果: ${resStr}`;
    }
    case 'pos_margin':
    case 'pos_margin_less': {
      const targetId = sp.instId || '';
      const target = parseFloat(sp.margin || sp.threshold || '0');
      let total = 0;
      forEachPosition(accountData, targetId, (p) => {
        const m = parseFloat(p.mgnMode === 'cross' ? p.imr : p.margin);
        total += m;
      });
      const opL = OPERATOR_LABELS[sp.operator || '>'] || sp.operator;
      return `${t('engine.detecting')}: ${acc}, ${COND_FIELD_LABELS.pm_instrument}: ${targetId || t('engine.all')}, ${COND_FIELD_LABELS.pm_field}: ${total.toFixed(2)}, ${COND_FIELD_LABELS.pm_target}: ${target}, ${COND_FIELD_LABELS.pm_operator}: ${opL}, 结果: ${resStr}`;
    }
    case 'pos_mgn_ratio':
    case 'pos_mgn_ratio_val': {
      const targetId = sp.instId || '';
      const targetValue = parseFloat(sp.ratio || sp.threshold || '0');
      let max = -1;
      forEachPosition(accountData, targetId, (p) => {
        const r = parseFloat(p.mgnRatio || '0') * 100;
        if (r > max) max = r;
      });
      const opL = OPERATOR_LABELS[sp.operator || '>'] || sp.operator;
      return `${t('engine.detecting')}: ${acc}, ${COND_FIELD_LABELS.mr_instrument}: ${targetId || t('engine.all')}, ${COND_FIELD_LABELS.mr_field}: ${(max === -1 ? 0 : max).toFixed(2)}%, ${COND_FIELD_LABELS.mr_target}: ${targetValue}%, ${COND_FIELD_LABELS.mr_operator}: ${opL}, 结果: ${resStr}`;
    }
    case 'pos_funding_rate': {
      const targetId = sp.instId || '';
      const targetValue = parseFloat(sp.rate || sp.threshold || '0');
      const cachedRate = deps.fundingRateCache.get(targetId);
      const currentRate = cachedRate ? (parseFloat(cachedRate) * 100).toFixed(4) : 'N/A';
      const opL = OPERATOR_LABELS[sp.operator || '>'] || sp.operator;
      return `${t('engine.detecting')}: ${acc}, ${COND_FIELD_LABELS.fr_instrument}: ${targetId}, ${COND_FIELD_LABELS.fr_field}: ${currentRate}%, ${COND_FIELD_LABELS.fr_target}: ${targetValue}%, ${COND_FIELD_LABELS.fr_operator}: ${opL}, 结果: ${resStr}`;
    }
    case 'time_window': {
      const tw = params as { startTime?: string; endTime?: string; days?: number[] };
      const tz = deps.userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const d = new Date(now);
      const timeStr = d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: tz });
      const weekdayName = d.toLocaleDateString('zh-CN', { weekday: 'long', timeZone: tz });
      let dayLimitLabel = '日, 一, 二, 三, 四, 五, 六';
      const weekdayNamesShort = ['日', '一', '二', '三', '四', '五', '六'];
      if (Array.isArray(tw.days) && tw.days.length > 0) {
        dayLimitLabel = [...tw.days].sort((a, b) => a - b).map((idx: number) => weekdayNamesShort[idx]).join(', ');
      }
      return `${t('engine.detecting')}: ${typeLabel}，当前: ${timeStr}(${weekdayName}), 允许: ${tw.startTime}-${tw.endTime} (${dayLimitLabel}), 结果: ${resStr}`;
    }
    case 'cooldown': {
      const last = deps.lastTriggeredMap.get(strategy.id) || strategy.lastTriggered || 0;
      const ms = (parseInt(sp.minutes || '0') * 60 + parseInt(sp.seconds || '0')) * 1000;
      const remaining = ms === 0 ? 0 : (last === 0 ? 0 : Math.max(0, Math.ceil((ms - (now - last)) / 1000)));
      return `${t('engine.detecting')}: ${typeLabel}，${ms === 0 ? t('engine.noCooldown') : (last === 0 ? t('engine.neverUsed') : `${t('engine.remaining')}: ${remaining}s`)}，结果: ${resStr}`;
    }
    case 'count_limit':
      return `${t('engine.detecting')}: ${typeLabel}，${t('engine.alreadyTriggered')}: ${strategy.triggerCount || 0}/${sp.limit}, 结果: ${resStr}`;
    case 'tv_signal': {
      const hasTvSignal = hasSignalForSource(deps.pendingSignals, strategy.id, 'tv');
      return `${t('engine.detecting')}: ${typeLabel}，信号: ${hasTvSignal ? t('engine.yes') : t('engine.no')}, 结果: ${resStr}`;
    }
    case 'indicator': {
      const indName = formatIndicatorName(sp.indicator || '未知', params);
      const op = sp.operator || '<';
      return `${t('engine.detecting')}: ${typeLabel}，指标: ${indName} ${op} ${sp.operandKind === 'price' ? sp.operandSource || 'close' : sp.operandValue || '0'}，结果: ${resStr}`;
    }
    default:
      return `${t('engine.detecting')}: ${typeLabel}, 结果: ${resStr}`;
  }
}

export function getSpecialPeriodicLogCore(
  deps: ConditionEvaluatorDeps,
  type: string,
  params: Record<string, unknown>,
  strategy: DIYStrategy,
  result: boolean,
  now: number
): string | null {
  const typeLabel = CONDITION_TYPE_LOG_LABELS[type] || type;
  const sp = params as Record<string, string>;
  if (type === 'cooldown' && !result && (now % 5000 < 1000)) {
    const last = deps.lastTriggeredMap.get(strategy.id) || strategy.lastTriggered || 0;
    const ms = (parseInt(sp.minutes || '0') * 60 + parseInt(sp.seconds || '0')) * 1000;
    if (ms === 0) return null;
    const remaining = Math.max(0, Math.ceil((ms - (now - last)) / 1000));
    return `${t('engine.detecting')}: ${typeLabel}，${t('engine.remaining')}: ${remaining}s`;
  }
  if (type === 'count_limit' && !result && (now % 10000 < 1000)) {
    return `${t('engine.detecting')}: ${typeLabel}，${t('engine.alreadyTriggered')}: ${strategy.triggerCount || 0}/${sp.limit}`;
  }
  return null;
}
