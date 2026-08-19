import { AccountMonitor } from '../../../services/AccountMonitor.ts';
import { marketScanner } from '../../../services/MarketScanner.ts';
import { SymbolUtils } from '../../../lib/symbolUtils.ts';
import { loadSavedConfig } from '../../../services/configService.ts';
import { calculateLiquidationDistance } from '../../../lib/positionUtils.ts';
import { LogService } from '../../../services/logService.ts';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from '../../../services/errorMonitor.ts';
import { DIYStrategy, ConditionTemplate, ConditionBlock } from '../../../types/diy.ts';
import { OPERATOR_LABELS, OPERATOR_LOG_LABELS, COND_FIELD_LABELS, CONDITION_TYPE_LOG_LABELS } from '../../../constants/conditionLabels.ts';
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
  crossState: Map<string, boolean>;
  instrumentTriggered: Map<string, number>;
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

export interface TemplateEvalResult {
  allMatched: boolean;
  triggeredInstIds: string[];
}

export function evaluateTemplateCore(
  deps: ConditionEvaluatorDeps,
  strategy: DIYStrategy,
  template: ConditionTemplate,
  triggerAccountIdx: number,
  appConfig: AppConfig
): TemplateEvalResult {
  if (!template.conditions || template.conditions.length === 0) return { allMatched: false, triggeredInstIds: [] };
  if (!deps.checkSafetyLocks(strategy, template)) return { allMatched: false, triggeredInstIds: [] };

  const timeCondition = template.conditions.find(c => c.type === 'time_window');
  if (timeCondition) {
    const tcParams = (timeCondition.params || {}) as Record<string, unknown>;
    const startTime = String(tcParams.startTime || '');
    const endTime = String(tcParams.endTime || '');
    if (startTime && endTime) {
      const tz = deps.userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const now = Date.now();
      const d = new Date(now);
      const tStr = d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: tz });
      const days = Array.isArray(tcParams.days) ? (tcParams.days as number[]) : undefined;
      let dayMatched = true;
      if (days && days.length > 0) {
        const getTzDay = (date: Date, timeZone: string) => {
          const dayStr = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
            .formatToParts(date)
            .find(p => p.type === 'weekday')?.value;
          const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
          return dayStr ? map[dayStr] : date.getDay();
        };
        dayMatched = days.includes(getTzDay(d, tz));
      }
      let timeMatched = false;
      if (startTime <= endTime) timeMatched = tStr >= startTime && tStr <= endTime;
      else timeMatched = tStr >= startTime || tStr <= endTime;
      if (!(dayMatched && timeMatched)) {
        return { allMatched: false, triggeredInstIds: [] };
      }
    }
  }

  const hadPendingSignal = hasAnySignal(deps.pendingSignals, strategy.id);
  const results: { idx: number; type: string; matched: boolean; triggeredInstIds: string[]; pendingCrossUpdates: Map<string, boolean>; pendingTriggeredUpdates: Map<string, number> }[] = [];
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
    const { matched, triggeredInstIds, pendingCrossUpdates, pendingTriggeredUpdates } = evaluateSingleConditionCore(deps, strategy, condition, data, strategy.id, i, targetIdx);
    results.push({ idx: i, type: condition.type, matched, triggeredInstIds, pendingCrossUpdates, pendingTriggeredUpdates });
    if (!matched) allMatched = false;
  }

  for (const r of results) {
    for (const [k, v] of r.pendingCrossUpdates) {
      deps.crossState.set(k, v);
    }
    if (allMatched) {
      for (const [k, v] of r.pendingTriggeredUpdates) {
        deps.instrumentTriggered.set(k, v);
      }
    }
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

  const priceLists = results.filter(r => r.triggeredInstIds.length > 0).map(r => r.triggeredInstIds);
  const triggeredInstIds = priceLists.length === 0
    ? []
    : priceLists.length === 1
      ? priceLists[0]
      : priceLists.slice(1).reduce(
          (acc, list) => {
            const set = new Set(list);
            return acc.filter(id => set.has(id));
          },
          priceLists[0]
        );

  if (priceLists.length > 0 && triggeredInstIds.length === 0) {
    allMatched = false;
  }

  return { allMatched, triggeredInstIds };
}

interface SingleConditionResult {
  matched: boolean;
  triggeredInstIds: string[];
  pendingCrossUpdates: Map<string, boolean>;
  pendingTriggeredUpdates: Map<string, number>;
}

export function evaluateSingleConditionCore(
  deps: ConditionEvaluatorDeps,
  strategy: DIYStrategy,
  condition: ConditionBlock,
  accountData: AccountData | null,
  configId: string,
  condIdx: number,
  accountIdx: number
): SingleConditionResult {
  const { type, params } = condition;
  const now = Date.now();

  const stateKey = `${strategy.id}:${accountIdx}:${condIdx}`;
  const prevState = deps.conditionState.get(stateKey);
  const { result, currentVal, triggeredInstIds, pendingCrossUpdates, pendingTriggeredUpdates } = doEvaluateCore(deps, strategy, condition, accountData, now, condIdx);

  deps.liveStates.set(stateKey, { result, currentVal });

  if (!accountData && !['time_window', 'cooldown', 'count_limit', 'tv_signal', 'indicator', 'price_change', 'price_change_24h', 'price_change_today'].includes(type)) {
    if (now % 30000 < 1000) LogService.logKey('diy', 'diy.condition.notReady', { id: configId }, 'warn', configId);
    return { matched: false, triggeredInstIds: [] };
  }

  const hasChanged = !prevState || prevState.result !== result;
  const isTimeout = prevState && (now - prevState.lastLoggedAt > 300000);
  const isSpecialType = ['time_window', 'cooldown', 'count_limit'].includes(type);

  if (hasChanged || isTimeout) {
    if ((type === 'tv_signal' || type === 'indicator') && !result && isTimeout) {
      deps.conditionState.set(stateKey, { result, lastLoggedAt: now });
    } else {
      const msg = getEvaluationLogMessageCore(deps, type, params, accountData, result, now, strategy, accountIdx, condIdx);
      if (msg) LogService.logKey('diy', 'diy.condition.eval', { detail: msg }, 'info', configId);
      deps.conditionState.set(stateKey, { result, lastLoggedAt: now });
    }
  } else if (isSpecialType) {
    const msg = getSpecialPeriodicLogCore(deps, type, params, strategy, result, now);
    if (msg) LogService.logKey('diy', 'diy.condition.eval', { detail: msg }, 'info', configId);
  }

  return { matched: result, triggeredInstIds, pendingCrossUpdates, pendingTriggeredUpdates };
}

interface DoEvaluateResult {
  result: boolean;
  currentVal: string;
  triggeredInstIds: string[];
  pendingCrossUpdates: Map<string, boolean>;
  pendingTriggeredUpdates: Map<string, number>;
}

export function doEvaluateCore(
  deps: ConditionEvaluatorDeps,
  strategy: DIYStrategy,
  condition: ConditionBlock,
  accountData: AccountData | null,
  now: number,
  condIdx: number
): DoEvaluateResult {
  const { type, params } = condition;
  const NO_IDS: string[] = [];
  const EMPTY_CROSS = new Map<string, boolean>();
  const EMPTY_TRIGGERED = new Map<string, number>();

  const r = (result: boolean, currentVal: string, triggeredInstIds: string[] = NO_IDS): DoEvaluateResult =>
    ({ result, currentVal, triggeredInstIds, pendingCrossUpdates: EMPTY_CROSS, pendingTriggeredUpdates: EMPTY_TRIGGERED });
  const rWithPending = (result: boolean, currentVal: string, triggeredInstIds: string[], pendingCrossUpdates: Map<string, boolean>, pendingTriggeredUpdates: Map<string, number>): DoEvaluateResult =>
    ({ result, currentVal, triggeredInstIds, pendingCrossUpdates, pendingTriggeredUpdates });

  if (!accountData && !['time_window', 'cooldown', 'count_limit', 'tv_signal', 'indicator', 'price_change', 'price_change_24h', 'price_change_today'].includes(type)) {
    return { result: false, currentVal: '无数据', triggeredInstIds: NO_IDS, pendingCrossUpdates: EMPTY_CROSS, pendingTriggeredUpdates: EMPTY_TRIGGERED };
  }

  if (type === 'indicator') {
    const hasFtSignal = hasSignalForSource(deps.pendingSignals, strategy.id, 'ft');
    if (!hasFtSignal) return { result: false, currentVal: '等 freqtrade webhook', triggeredInstIds: NO_IDS, pendingCrossUpdates: EMPTY_CROSS, pendingTriggeredUpdates: EMPTY_TRIGGERED };
    return { result: true, currentVal: '收到FT信号', triggeredInstIds: NO_IDS, pendingCrossUpdates: EMPTY_CROSS, pendingTriggeredUpdates: EMPTY_TRIGGERED };
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
      case 'cross_above':
      case 'cross_below': return false;
      default: return false;
    }
  };

  switch (type) {
    case 'balance_less': {
      const ccy = sp.ccy || 'USDT';
      const detail = accountData.balances?.details?.find((d) => d.ccy === ccy);
      const val = parseFloat(detail?.availBal || '0');
      const target = parseFloat(sp.threshold || '0');
      return r(comp(val, sp.operator || '<', target), `${val.toFixed(2)} ${ccy}`);
    }
    case 'pos_count': {
      const pos = getPositions(accountData, sp.instId);
      const count = pos.length;
      const target = parseFloat(sp.count || '0');
      return r(comp(count, sp.operator || '=', target), `${count} 个`);
    }
    case 'pos_sz_limit': {
      const target = parseFloat(sp.size || '0');
      let sum = 0;
      forEachPosition(accountData, sp.instId, (p) => {
        sum += Math.abs(parseFloat(p.pos || '0'));
      });
      return r(comp(sum, sp.operator || '>', target), sum.toFixed(2));
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
      return r(matched, `${(maxRate === -999 ? 0 : maxRate).toFixed(2)}%`);
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
      return r(matched, minDist === 999999 ? 'N/A' : minDist.toFixed(2));
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
      return r(matched, currentSides.length > 0 ? currentSides.join('/') : '无持仓');
    }
    case 'pos_pnl_amount':
    case 'pos_pnl_limit': {
      const target = parseFloat(sp.amount || sp.threshold || '0');
      let total = 0;
      forEachPosition(accountData, sp.instId, (p) => {
        total += parseFloat(p.upl || '0');
      });
      return r(comp(total, sp.operator || '>', target), total.toFixed(2));
    }
    case 'pos_margin':
    case 'pos_margin_less': {
      const target = parseFloat(sp.margin || sp.threshold || '0');
      let totalMargin = 0;
      forEachPosition(accountData, sp.instId, (p) => {
        const m = parseFloat(p.mgnMode === 'cross' ? p.imr : p.margin);
        totalMargin += m;
      });
      return r(comp(totalMargin, sp.operator || '>', target), totalMargin.toFixed(2));
    }
    case 'pos_mgn_ratio':
    case 'pos_mgn_ratio_val': {
      const target = parseFloat(sp.ratio || sp.threshold || '0');
      let maxRatio = -1;
      forEachPosition(accountData, sp.instId, (p) => {
        const r = parseFloat(p.mgnRatio || '0') * 100;
        if (r > maxRatio) maxRatio = r;
      });
      return r(
        comp(maxRatio === -1 ? 0 : maxRatio, sp.operator || '>', target),
        `${(maxRatio === -1 ? 0 : maxRatio).toFixed(2)}%`
      );
    }
    case 'pos_funding_rate': {
      const target = parseFloat(sp.rate || sp.threshold || '0');
      const instId = sp.instId || '';
      if (!instId) return r(false, '未指定交易对');
      const cachedRate = deps.fundingRateCache.get(instId);
      if (!cachedRate) return r(false, '数据未就绪');
      const rateVal = parseFloat(cachedRate) * 100;
      return r(comp(rateVal, sp.operator || '>', target), `${rateVal.toFixed(4)}%`);
    }
    case 'time_window': {
      const { startTime, endTime, days } = params as { startTime?: string; endTime?: string; days?: number[] };
      if (!startTime || !endTime) return r(true, '未设置');
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
      return r(dayMatched && timeMatched, tStr);
    }
    case 'cooldown': {
      const ms = (parseInt(sp.minutes || '0') * 60 + parseInt(sp.seconds || '0')) * 1000;
      const last = deps.lastTriggeredMap.get(strategy.id) || strategy.lastTriggered || 0;
      const diff = now - last;
      return r(
        ms === 0 || diff >= ms,
        ms === 0 ? t('engine.noCooldown') : (diff < ms ? `还剩 ${Math.ceil((ms - diff) / 1000)}s` : '冷却完成')
      );
    }
    case 'count_limit': {
      const limit = parseInt(sp.limit || '1');
      const count = strategy.triggerCount || 0;
      return r(count < limit, `${count}/${limit}`);
    }
    case 'tv_signal': {
      const hasTvSignal = hasSignalForSource(deps.pendingSignals, strategy.id, 'tv');
      if (!hasTvSignal) return r(false, t('engine.no'));
      return r(true, t('engine.yes'));
    }
    case 'price_change':
    case 'price_change_24h':
    case 'price_change_today': {
      const exchange = sp.exchange || 'okx';
      const instId = sp.instId || '';
      const operator = sp.operator || '>';
      const target = parseFloat(sp.threshold || '0');
      const window = sp.window === 'today' ? 'today' : '24h';
      const isCrossAbove = operator === 'cross_above';
      const isCrossBelow = operator === 'cross_below';
      const rawRepeat = sp.repeat || '';
      const repeatMode = rawRepeat === 'true' ? 'repeat' : rawRepeat === 'false' ? 'once' : (rawRepeat || 'once');
      const allowRepeat = repeatMode === 'repeat';

      const pendingCross = new Map<string, boolean>();
      const pendingTriggered = new Map<string, number>();
      const triggerMs = new Date().setHours(0, 0, 0, 0);

      const isAlreadyTriggered = (iid: string): boolean => {
        if (allowRepeat) return false;
        const key = `${strategy.id}:${condIdx}:${iid}`;
        const triggeredMs = deps.instrumentTriggered.get(key);
        if (triggeredMs === undefined) return false;
        if (repeatMode === 'daily') {
          return triggeredMs === triggerMs;
        }
        return true;
      };

      if (instId) {
        const ticker = marketScanner.getTicker(exchange, instId);
        if (!ticker) return r(false, '数据未就绪');
        const val = window === 'today' ? ticker.changeToday : ticker.change24h;
        if (isNaN(val)) return r(false, '数据预热中');
        const currentlyAbove = val > target;
        const currentlyBelow = val < target;
        if (isCrossAbove || isCrossBelow) {
          const crossKey = `${strategy.id}:${condIdx}:${instId}`;
          const prevState = deps.crossState.get(crossKey);
          pendingCross.set(crossKey, currentlyAbove);
          if (prevState === undefined) {
            return rWithPending(false, `首次检测(当前${val.toFixed(2)}%)`, NO_IDS, pendingCross, EMPTY_TRIGGERED);
          }
          const triggered = isCrossAbove ? (!prevState && currentlyAbove) : (prevState && currentlyBelow);
          if (triggered && isAlreadyTriggered(instId)) {
            return rWithPending(false, `${val.toFixed(2)}%(已触发过)`, NO_IDS, pendingCross, EMPTY_TRIGGERED);
          }
          if (triggered) pendingTriggered.set(`${strategy.id}:${condIdx}:${instId}`, triggerMs);
          return rWithPending(triggered, `${val.toFixed(2)}%`, triggered ? [instId] : NO_IDS, pendingCross, pendingTriggered);
        }
        const matched = comp(val, operator, target);
        if (matched && isAlreadyTriggered(instId)) {
          return r(false, `${val.toFixed(2)}%(已触发过)`);
        }
        if (matched) pendingTriggered.set(`${strategy.id}:${condIdx}:${instId}`, triggerMs);
        return rWithPending(matched, `${val.toFixed(2)}%`, matched ? [instId] : NO_IDS, EMPTY_CROSS, pendingTriggered);
      }

      const allTickers = marketScanner.getAllTickers(exchange);
      const matched: string[] = [];
      const skipped: string[] = [];
      let maxVal = -Infinity;
      for (const ticker of allTickers) {
        const val = window === 'today' ? ticker.changeToday : ticker.change24h;
        if (isNaN(val)) continue;
        if (val > maxVal) maxVal = val;

        if (isCrossAbove || isCrossBelow) {
          const currentlyAbove = val > target;
          const currentlyBelow = val < target;
          const crossKey = `${strategy.id}:${condIdx}:${ticker.instId}`;
          const prevState = deps.crossState.get(crossKey);
          pendingCross.set(crossKey, currentlyAbove);
          if (prevState === undefined) continue;
          const triggered = isCrossAbove ? (!prevState && currentlyAbove) : (prevState && currentlyBelow);
          if (triggered) {
            if (isAlreadyTriggered(ticker.instId)) {
              skipped.push(ticker.instId);
            } else {
              pendingTriggered.set(`${strategy.id}:${condIdx}:${ticker.instId}`, triggerMs);
              matched.push(ticker.instId);
            }
          }
        } else {
          if (comp(val, operator, target)) {
            if (isAlreadyTriggered(ticker.instId)) {
              skipped.push(ticker.instId);
            } else {
              pendingTriggered.set(`${strategy.id}:${condIdx}:${ticker.instId}`, triggerMs);
              matched.push(ticker.instId);
            }
          }
        }
      }
      const names = matched.slice(0, 5).join(', ');
      const suffix = matched.length > 5 ? '等' : '';
      const skiplist = skipped.slice(0, 3);
      const skipNames = skiplist.length > 0 ? `，${skiplist.length > 0 ? skiplist.join(', ') : ''}${skipped.length > 3 ? '等' : ''}已触发过` : '';
      return rWithPending(
        matched.length > 0,
        matched.length > 0 ? `${matched.length}个交易对满足(${names}${suffix})${skipNames}` : `最高${(maxVal === -Infinity ? 0 : maxVal).toFixed(2)}%`,
        matched,
        pendingCross,
        pendingTriggered
      );
    }
    default:
      return r(false, '未知类型');
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
  accountIdx: number,
  condIdx: number
): string | null {
  if (!accountData && !['time_window', 'cooldown', 'count_limit', 'indicator', 'price_change', 'price_change_24h', 'price_change_today'].includes(type)) return null;
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
      const opL = OPERATOR_LOG_LABELS[sp.operator || '<'] || sp.operator;
      return `${t('engine.detecting')}: ${acc}, ${COND_FIELD_LABELS.bl_field}: ${bal}, ${COND_FIELD_LABELS.bl_threshold}: ${sp.threshold}, ${COND_FIELD_LABELS.bl_operator}: ${opL}, 结果: ${resStr}`;
    }
    case 'pos_count': {
      const pos = getPositions(accountData, sp.instId);
      const opL = OPERATOR_LOG_LABELS[sp.operator || '='] || sp.operator;
      return `${t('engine.detecting')}: ${acc}, ${COND_FIELD_LABELS.pc_instrument}: ${sp.instId || t('engine.all')}, ${COND_FIELD_LABELS.pc_field}: ${pos.length}, ${COND_FIELD_LABELS.pc_target}: ${sp.count}, ${COND_FIELD_LABELS.pc_operator}: ${opL}, 结果: ${resStr}`;
    }
    case 'pos_sz_limit': {
      let sz = 0;
      const targetId = sp.instId || '';
      forEachPosition(accountData, targetId, (p) => {
        sz += Math.abs(parseFloat(p.pos || '0'));
      });
      const opL = OPERATOR_LOG_LABELS[sp.operator || '>'] || sp.operator;
      return `${t('engine.detecting')}: ${acc}, ${COND_FIELD_LABELS.psl_instrument}: ${targetId || t('engine.all')}, ${COND_FIELD_LABELS.psl_field}: ${sz}, ${COND_FIELD_LABELS.psl_target}: ${sp.size}, ${COND_FIELD_LABELS.psl_operator}: ${opL}, 结果: ${resStr}`;
    }
    case 'pos_pnl_rate': {
      const targetId = sp.instId || '';
      let max = -999;
      forEachPosition(accountData, targetId, (p) => {
        const r = parseFloat(p.uplRatio || '0') * 100;
        if (r > max) max = r;
      });
      const opL = OPERATOR_LOG_LABELS[sp.operator || '>'] || sp.operator;
      return `${t('engine.detecting')}: ${acc}, ${COND_FIELD_LABELS.pr_instrument}: ${targetId || t('engine.all')}, ${COND_FIELD_LABELS.pr_field}: ${(max === -999 ? 0 : max).toFixed(2)}%, ${COND_FIELD_LABELS.pr_target}: ${sp.rate}%, ${COND_FIELD_LABELS.pr_operator}: ${opL}, 结果: ${resStr}`;
    }
    case 'pos_liq_dist': {
      const targetId = sp.instId || '';
      let min = 999999;
      forEachPosition(accountData, targetId, (p) => {
        const d = calculateLiquidationDistance(p);
        if (d !== null && d < min) min = d;
      });
      const opL = OPERATOR_LOG_LABELS[sp.operator || '<'] || sp.operator;
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
      const opL = OPERATOR_LOG_LABELS[sp.operator || '>'] || sp.operator;
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
      const opL = OPERATOR_LOG_LABELS[sp.operator || '>'] || sp.operator;
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
      const opL = OPERATOR_LOG_LABELS[sp.operator || '>'] || sp.operator;
      return `${t('engine.detecting')}: ${acc}, ${COND_FIELD_LABELS.mr_instrument}: ${targetId || t('engine.all')}, ${COND_FIELD_LABELS.mr_field}: ${(max === -1 ? 0 : max).toFixed(2)}%, ${COND_FIELD_LABELS.mr_target}: ${targetValue}%, ${COND_FIELD_LABELS.mr_operator}: ${opL}, 结果: ${resStr}`;
    }
    case 'pos_funding_rate': {
      const targetId = sp.instId || '';
      const targetValue = parseFloat(sp.rate || sp.threshold || '0');
      const cachedRate = deps.fundingRateCache.get(targetId);
      const currentRate = cachedRate ? (parseFloat(cachedRate) * 100).toFixed(4) : 'N/A';
      const opL = OPERATOR_LOG_LABELS[sp.operator || '>'] || sp.operator;
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
    case 'price_change':
    case 'price_change_24h':
    case 'price_change_today': {
      const exchange = sp.exchange || 'okx';
      const instId = sp.instId || '';
      const opL = OPERATOR_LOG_LABELS[sp.operator || '>'] || sp.operator;
      if (instId) {
        const ticker = marketScanner.getTicker(exchange, instId);
        const val = ticker ? (sp.window === 'today' ? ticker.changeToday : ticker.change24h).toFixed(2) : 'N/A';
        return `${t('engine.detecting')}: ${typeLabel}，${exchange}/${instId}，${sp.window === 'today' ? '当日' : '24h'}涨幅: ${val}%，阈值: ${sp.threshold}%，判断逻辑: ${opL}，结果: ${resStr}`;
      }
      const liveKey = `${strategy.id}:${accountIdx}:${condIdx}`;
      const liveVal = deps.liveStates.get(liveKey);
      const valDisplay = liveVal?.currentVal || '扫描中';
      return `${t('engine.detecting')}: ${typeLabel}，${exchange}/全部，${sp.window === 'today' ? '当日' : '24h'}涨幅: ${valDisplay}，阈值: ${sp.threshold}%，判断逻辑: ${opL}，结果: ${resStr}`;
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
