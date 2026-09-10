import { buildPlaceDescSegments } from '../PlaceModule.tsx';
import { buildAmendDescSegments } from '../AmendModule.tsx';
import { buildCancelDescSegments } from '../CancelModule.tsx';
import { buildCloseDescSegments } from '../CloseModule.tsx';
import { buildMarginDescSegments } from '../MarginModule.tsx';
import type { ConditionTemplate } from '../../types/index.ts';
import { CONDITION_TYPE_LABELS } from '../../constants/conditionLabels.ts';
import { ACCOUNT_FIELDS } from '../../constants/accountFields.ts';
import type { ActionType } from '../../types/diy.ts';
import type { FreqtradeIndicator, PriceSource } from '../../types/freqtrade.ts';
import { fmtHoldTimeThreshold } from '../../lib/holdTimeFormat.ts';
import { formatWeekDays } from '../../lib/formatWeekDays.ts';

const INDICATOR_LABELS: Record<string, string> = {
  price: 'indicators.price', volume: 'indicators.volume', VOL_MA: 'indicators.volMa',
  RSI: 'indicators.rsi', EMA: 'indicators.ema', SMA: 'indicators.ma', MACD: 'indicators.macd',
  BB: 'indicators.boll', ATR: 'indicators.atr', STOCH: 'indicators.kdj',
  ADX: 'indicators.adx', MFI: 'indicators.mfi', CCI: 'indicators.cci',
};

const PRICE_SUB_LABELS: Record<string, string> = {
  close: 'indicators.priceClose', open: 'indicators.priceOpen',
  high: 'indicators.priceHigh', low: 'indicators.priceLow',
};

const MACD_SUB_LABELS: Record<string, string> = {
  macd: 'indicators.macdDiff', macdsignal: 'indicators.macdDea', macdhist: 'indicators.macdStick',
};

const STOCH_SUB_LABELS: Record<string, string> = {
  slowk: 'indicators.kdjK', slowd: 'indicators.kdjD', j: 'indicators.kdjJ',
};

const BB_SUB_LABELS: Record<string, string> = {
  lower: 'indicators.bollLb', mid: 'indicators.bollMid', upper: 'indicators.bollUb',
};

function indicatorSummary(params: Record<string, unknown>, t: (key: string) => string): string {
  const indId = String(params.indicator || 'RSI');
  const indKey = INDICATOR_LABELS[indId] || indId;
  const operator = String(params.operator || '<');
  const value = params.operandValue ?? 0;

  let name = '';

  if (indId === 'price') {
    name = t(PRICE_SUB_LABELS[String(params.source || 'close')] || 'indicators.price');
  } else if (indId === 'volume') {
    name = t('indicators.volume');
  } else if (indId === 'MACD') {
    const subKey = MACD_SUB_LABELS[String(params.output || 'macd')];
    name = t(subKey || indKey);
  } else if (indId === 'STOCH') {
    const subKey = STOCH_SUB_LABELS[String(params.output || 'slowk')];
    name = t(subKey || indKey);
  } else if (indId === 'BB') {
    const subKey = BB_SUB_LABELS[String(params.output || 'lower')];
    const subLabel = subKey ? t(subKey) : '';
    const w = (params.params as Record<string, number>)?.window ?? 20;
    name = subLabel ? `${subLabel}(${w})` : `${t(indKey)}(${w})`;
  } else {
    const paramKey = indId === 'VOL_MA' ? 'window' : 'timeperiod';
    const p = (params.params as Record<string, number>)?.[paramKey];
    name = p ? `${t(indKey)}(${p})` : t(indKey);
  }

  const opSymbols: Record<string, string> = {
    '>': '>', '<': '<', '>=': '≥', '<=': '≤',
    cross_above: 'indicators.crossAbove', cross_below: 'indicators.crossBelow',
  };
  const opVal = opSymbols[operator];
  const opSymbol = opVal && ['>', '<', '≥', '≤'].includes(opVal) ? opVal : t(opVal || operator);

  const pair = String(params.pair || '');
  const timeframe = String(params.timeframe || '');
  const tfSuffix = timeframe ? ` [${timeframe}]` : '';

  return `${pair || '—'} ${name}${opSymbol}${value}${tfSuffix}`;
}

interface DescSegment {
  label: string;
  value: string;
}

export function getConditionSummary(
  template: ConditionTemplate,
  accountNames: Record<string, string>,
  accounts: Array<{ id: string; name: string }> = [],
  t: (key: string) => string = (k) => k
): string {
  if (!template || !template.conditions || template.conditions.length === 0) return t('condition.noConditionConfig');

  return template.conditions.map((c) => {
    let summary = '';
    const params = c.params as Record<string, unknown>;

    let accountName = t('strategy.accountDeleted');
    const accountId = String(params.accountId || '').trim();
    if (accountId) {
      const found = accounts.find(a => a.id === accountId);
      if (found) {
        accountName = found.name;
      } else {
        accountName = accountNames[accountId] || accountName;
      }
    } else if (params.accountIdx !== undefined) {
      const idx = params.accountIdx;
      accountName = accountNames[idx] || `${t('account.account')} #${idx}`;
    }

    const typeLabel = t(CONDITION_TYPE_LABELS[c.type] || 'condition.blockDefault');

    switch (c.type) {
      case 'balance_less':
        summary = `[${accountName}]${t(ACCOUNT_FIELDS.AVAILABLE_BALANCE)}${params.operator}${params.threshold}`;
        break;
      case 'pos_count':
        summary = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.posCountDesc')}${params.operator}${params.count}`;
        break;
      case 'pos_sz_limit':
        summary = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.posSzDesc')}${params.operator}${params.size}`;
        break;
      case 'pos_side': {
        const sideMap: Record<string, string> = { long: t('position.long'), short: t('position.short'), net: t('position.net') };
        summary = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.posSideDesc')} ${sideMap[params.side] || params.side}`;
        break;
      }
      case 'pos_pnl_amount':
        summary = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.pnlAmtDesc')}${params.operator}${params.amount} USDT`;
        break;
      case 'pos_pnl_rate':
        summary = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.pnlRateDesc')}${params.operator}${params.rate}%`;
        break;
      case 'pos_margin':
        summary = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.marginDesc')}${params.operator}${params.margin} USDT`;
        break;
      case 'pos_mgn_ratio_val':
        summary = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.mgnRatioDesc')}${params.operator}${params.ratio}%`;
        break;
      case 'pos_liq_dist':
        summary = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.liqDistDesc')}${params.operator}${params.dist} USDT`;
        break;
      case 'pos_funding_rate':
        summary = `[${accountName}]${params.instId} ${t('strategy.fundingRateDesc')}${params.operator}${params.rate}%`;
        break;
      case 'pos_closed_pnl':
        summary = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.closedPnlDesc')}${params.operator}${params.amount} USDT`;
        break;
      case 'pos_hold_time':
        summary = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.holdTimeDesc')}${params.operator}${fmtHoldTimeThreshold(params.value, params.unit)}`;
        break;
      case 'time_window': {
        const days = params.days;
        const daysStr = formatWeekDays(days, t);
        summary = `[${typeLabel}]${params.startTime || '?'}-${params.endTime || '?'}${daysStr}`;
        break;
      }
      case 'cooldown':
        summary = `[${typeLabel}]${params.minutes}${t('strategy.minutes')}${params.seconds}${t('strategy.seconds')}`;
        break;
      case 'count_limit':
        summary = `[${typeLabel}]${params.limit}${t('strategy.times')}`;
        break;
      case 'tv_signal':
        summary = `[${typeLabel}](${t('strategy.secretLabel')}: ${params.secret})`;
        break;
      case 'indicator':
        summary = indicatorSummary(params, t);
        break;
      case 'price_change':
      case 'price_change_24h':
      case 'price_change_today':
      case 'price_change_high24h': {
        const pcExchange = String(params.exchange || 'okx').toUpperCase();
        const pcInstId = String(params.instId || '');
        const pcWindow = c.type === 'price_change_today' || params.window === 'today' ? t('condition.windowToday') : t('condition.window24h');
        const pcOpRaw = String(params.operator || '>');
        const pcOp = pcOpRaw === 'cross_above' ? t('indicators.crossAbove') : pcOpRaw === 'cross_below' ? t('indicators.crossBelow') : pcOpRaw;
        const pcThreshold = String(params.threshold || '0');
        const pcLabel = pcInstId || t('condition.anyInstrument');
        const rawRepeat = String(params.repeat || '');
        const repeatMode = rawRepeat === 'true' ? 'repeat' : rawRepeat === 'false' ? 'once' : (rawRepeat || 'once');
        const pcRepeat = repeatMode === 'repeat' ? t('condition.repeatMode.repeat') : repeatMode === 'daily' ? t('condition.repeatMode.daily') : '';
        summary = `[${pcExchange}] ${pcLabel} ${pcWindow} ${pcOp} ${pcThreshold}%${pcRepeat ? ` ${pcRepeat}` : ''}`;
        break;
      }
      default:
        summary = `${t('condition.blockDefault')}: ${c.type}`;
    }
    return summary;
  }).join('\n');
}

export function getConfigSummary(
  type: ActionType | string,
  cfg: Record<string, unknown>,
  accountNames: Record<number, string>,
  accountColors: Record<number, string>,
  accounts: Array<{ id: string; name: string }> = [],
  t: (key: string) => string = (k) => k
): string {
  if (!cfg) return t('config.error.notExist');

  let segments: DescSegment[] = [];
  try {
    switch (type) {
      case 'place_order':
        segments = buildPlaceDescSegments(cfg as unknown as Parameters<typeof buildPlaceDescSegments>[0], accountNames, accountColors, accounts, t);
        break;
      case 'amend_order':
        segments = buildAmendDescSegments(cfg as unknown as Parameters<typeof buildAmendDescSegments>[0], accountNames, accountColors, accounts, t);
        break;
      case 'cancel_order':
        segments = buildCancelDescSegments(cfg as unknown as Parameters<typeof buildCancelDescSegments>[0], accountNames, accountColors, accounts, t);
        break;
      case 'close_pos':
        segments = buildCloseDescSegments(cfg as unknown as Parameters<typeof buildCloseDescSegments>[0], accountNames, accountColors, accounts, t);
        break;
      case 'prevent_margin_risk':
        segments = buildMarginDescSegments(cfg as unknown as Parameters<typeof buildMarginDescSegments>[0], accountNames, accountColors, accounts, t);
        break;
      case 'stop_strategy': {
        const targetId = (cfg.targetConfigId || (cfg.params as Record<string, unknown>)?.targetId || (cfg.params as Record<string, unknown>)?.targetScript) as string;
        if (targetId === 'all') return `${t('strategy.actionStop')}: ${t('strategy.allStrategies')}`;
        const targetName = (cfg._resolvedName as string) || targetId || t('strategy.unspecified');
        return `${t('strategy.actionStop')}: ${targetName}`;
      }
      case 'notify': {
        const nt = (cfg.params as Record<string, string>)?.notify_type || 'pc';
        if (nt === 'email') {
          return `${t('strategy.actionNotify')}: ${((cfg.params as Record<string, unknown>)?.email as string) || t('strategy.emailUnfilled')}`;
        }
        return t(nt === 'telegram' ? 'strategy.actionNotifyTelegram' : 'strategy.actionNotifyPc');
      }
      default:
        return t('strategy.unknownConfig');
    }
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error('Failed to generate config summary:', err.message);
    return t('config.error.parseFailed');
  }

  if (segments.length === 0) return t('config.error.noData');
  return segments.map(s => `${s.label}: ${s.value}`).join('\n');
}
