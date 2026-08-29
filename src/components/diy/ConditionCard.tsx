import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import ConfigCard from '../../ui/ConfigCard.tsx';
import { ConditionTemplate } from '../../types/index.ts';
import { ACCOUNT_FIELDS } from '../../constants/accountFields.ts';
import { BINANCE_YELLOW } from '../../constants/colors.ts';
import { POS_SIDE_LABELS, type PositionSide } from '../../constants/positionFields.ts';
import { fmtHoldTimeThreshold } from '../../lib/holdTimeFormat.ts';

const IND_LABELS: Record<string, string> = {
  price: 'indicators.price', volume: 'indicators.volume', VOL_MA: 'indicators.volMa',
  RSI: 'indicators.rsi', EMA: 'indicators.ema', SMA: 'indicators.ma', MACD: 'indicators.macd',
  BB: 'indicators.boll', ATR: 'indicators.atr', STOCH: 'indicators.kdj',
  ADX: 'indicators.adx', MFI: 'indicators.mfi', CCI: 'indicators.cci',
};
const PRICE_SUB: Record<string, string> = {
  close: 'indicators.priceClose', open: 'indicators.priceOpen',
  high: 'indicators.priceHigh', low: 'indicators.priceLow',
};
const MACD_SUB: Record<string, string> = {
  macd: 'indicators.macdDiff', macdsignal: 'indicators.macdDea', macdhist: 'indicators.macdStick',
};
const STOCH_SUB: Record<string, string> = {
  slowk: 'indicators.kdjK', slowd: 'indicators.kdjD', j: 'indicators.kdjJ',
};
const BB_SUB: Record<string, string> = {
  lower: 'indicators.bollLb', mid: 'indicators.bollMid', upper: 'indicators.bollUb',
};
const OP_SYM: Record<string, string> = {
  '>': '>', '<': '<', '>=': '≥', '<=': '≤',
  cross_above: 'indicators.crossAbove', cross_below: 'indicators.crossBelow',
};

function indShortSummary(params: Record<string, any>, t: (key: string) => string, templateTimeframe = ''): { name: string; op: string; value: string; pair: string; timeframe: string } {
  const indId = String(params.indicator || 'RSI');
  const indKey = IND_LABELS[indId] || indId;
  const operator = String(params.operator || '<');
  const value = String(params.operandValue ?? 0);
  const pair = String(params.pair || '');
  const timeframe = String(params.timeframe || templateTimeframe || '');

  let name = '';
  if (indId === 'price') name = t(PRICE_SUB[String(params.source || 'close')] || String(params.source));
  else if (indId === 'volume') name = t('indicators.volume');
  else if (indId === 'MACD') name = t(MACD_SUB[String(params.output || 'macd')] || indKey);
  else if (indId === 'STOCH') name = t(STOCH_SUB[String(params.output || 'slowk')] || indKey);
  else if (indId === 'BB') {
    const subKey = BB_SUB[String(params.output || 'lower')];
    const subLabel = subKey ? t(subKey) : '';
    const w = (params.params as Record<string, number>)?.window ?? 20;
    name = subLabel ? `${subLabel}(${w})` : `${t(indKey)}(${w})`;
  } else {
    const paramKey = indId === 'VOL_MA' ? 'window' : 'timeperiod';
    const p = (params.params as Record<string, number>)?.[paramKey];
    name = p ? `${t(indKey)}(${p})` : t(indKey);
  }

  const opVal = OP_SYM[operator];
  const op = ['>', '<', '≥', '≤'].includes(opVal) ? opVal : t(opVal || operator);

  return { name, op, value, pair, timeframe };
}

const CROSS_OP_MAP: Record<string, string> = { cross_above: 'indicators.crossAbove', cross_below: 'indicators.crossBelow' };
const normalizeOperator = (op: string, t: (key: string) => string) => {
  if (op === ':') return '=';
  const i18nKey = CROSS_OP_MAP[op];
  return i18nKey ? t(i18nKey) : op;
};
const getPosSideLabel = (side: string, t: (key: string) => string): string => {
  if (side === 'long' || side === 'short' || side === 'net') {
    return t(POS_SIDE_LABELS[side as PositionSide]);
  }
  return side;
};

interface ConditionCardProps {
  template: ConditionTemplate;
  accountNames: Record<string, string>;
  accountColors: Record<string, string>;
  accounts?: { id: string; name: string }[];
  onEdit: (template: ConditionTemplate) => void;
  onDuplicate?: () => void;
  onPin?: (id: string) => void;
  onDelete: (id: string) => void;
  batchMode?: boolean;
  isBatchSelected?: boolean;
  onToggleSelect?: () => void;
}

const ConditionCard = memo(({
  template,
  accountNames,
  accountColors,
  accounts = [],
  onEdit,
  onDuplicate,
  onPin,
  onDelete,
  batchMode = false,
  isBatchSelected = false,
  onToggleSelect,
}: ConditionCardProps) => {
  const { t } = useTranslation();
  const resolveAccountDisplay = (params: Record<string, any>): { name: string; color: string } => {
    const accountId = String(params.accountId || '').trim();
    
    let name = t('strategy.accountDeleted');
    if (accountId) {
      const found = accounts.find(a => a.id === accountId);
      if (found) {
        name = found.name;
      } else {
        name = accountNames[accountId] || name;
      }
    }
    
    const color = accountColors[accountId] || BINANCE_YELLOW;
    return { name, color };
  };

  const exchange = (template as any).exchange as 'okx' | 'binance' | undefined;
  const timeframe = (template as any).timeframe as string | undefined;
  const exchangeBadge = exchange ? (
    <span
      className="px-1.5 py-0.5 rounded text-2xs font-mono bg-surface-3 border border-border-default text-brand-yellow"
      title="该条件模板运行在指定交易所"
    >
      {exchange.toUpperCase()}
    </span>
  ) : undefined;
  const timeframeBadge = timeframe ? (
    <span
      className="px-1.5 py-0.5 rounded text-2xs font-mono bg-surface-3 border border-border-default text-text-secondary"
      title="所有指标共用该 K线周期"
    >
      {timeframe}
    </span>
  ) : undefined;

  return (
    <ConfigCard
      name={template.name}
      extraBadge={
        <>
          {exchangeBadge}
          {timeframeBadge}
        </>
      }
      isRunning={false}
      isSelected={false}
      testMode={false}
      onEdit={() => onEdit(template)}
      onDuplicate={onDuplicate}
      onPin={onPin ? () => onPin(template.id) : undefined}
      onDelete={() => onDelete(template.id)}
      onStart={() => {}}
      onStop={() => {}}
      showStatus={false}
      showStartStop={false}
      batchMode={batchMode}
      isBatchSelected={isBatchSelected}
      onToggleSelect={onToggleSelect}
    >
      <div className="flex flex-wrap items-center gap-1">
        {template.conditions.map((c) => {
          const { name: accName, color: accColor } = resolveAccountDisplay(c.params);

          let category = '';
          let categoryColor: string | undefined = undefined;
          let categoryClassName = 'text-text-tertiary';
          let content: React.ReactNode = null;
          let isLong = c.type === 'tv_signal';

          if (c.type === 'balance_less') {
            category = accName; categoryColor = accColor; categoryClassName = 'font-bold';
            content = (
              <>
                <span className="text-text-secondary">{t(ACCOUNT_FIELDS.AVAILABLE_BALANCE)}</span>
                <span className="text-text-tertiary mx-1">{normalizeOperator(c.params.operator, t)}</span>
                <span className="text-brand-blue font-medium">{c.params.threshold}</span>
              </>
            );
          } else if (c.type === 'pos_count') {
            category = accName; categoryColor = accColor; categoryClassName = 'font-bold';
            content = (
              <>
                <span className="text-brand-blue font-medium mr-1">{c.params.instId || t('strategy.all')}</span>
                <span className="text-text-secondary">{t('strategy.posCountDesc')}</span>
                <span className="text-text-tertiary mx-1">{normalizeOperator(c.params.operator, t)}</span>
                <span className="text-brand-blue font-medium">{c.params.count}</span>
              </>
            );
          } else if (c.type === 'pos_sz_limit') {
            category = accName; categoryColor = accColor; categoryClassName = 'font-bold';
            content = (
              <>
                <span className="text-brand-blue font-medium mr-1">{c.params.instId || t('strategy.all')}</span>
                <span className="text-text-secondary">{t('strategy.posSzDesc')}</span>
                <span className="text-text-tertiary mx-1">{normalizeOperator(c.params.operator, t)}</span>
                <span className="text-brand-blue font-medium">{c.params.size}</span>
              </>
            );
          } else if (c.type === 'pos_pnl_amount') {
            category = accName; categoryColor = accColor; categoryClassName = 'font-bold';
            content = (
              <>
                <span className="text-brand-blue font-medium mr-1">{c.params.instId || t('strategy.all')}</span>
                <span className="text-text-secondary">{t('strategy.pnlAmtDesc')}</span>
                <span className="text-text-tertiary mx-1">{normalizeOperator(c.params.operator, t)}</span>
                <span className="text-brand-blue font-medium">{c.params.amount}</span>
              </>
            );
          } else if (c.type === 'pos_pnl_rate') {
            category = accName; categoryColor = accColor; categoryClassName = 'font-bold';
            content = (
              <>
                <span className="text-brand-blue font-medium mr-1">{c.params.instId || t('strategy.all')}</span>
                <span className="text-text-secondary">{t('strategy.pnlRateDesc')}</span>
                <span className="text-text-tertiary mx-1">{normalizeOperator(c.params.operator, t)}</span>
                <span className="text-brand-blue font-medium">{c.params.rate}%</span>
              </>
            );
          } else if (c.type === 'pos_margin') {
            category = accName; categoryColor = accColor; categoryClassName = 'font-bold';
            content = (
              <>
                <span className="text-brand-blue font-medium mr-1">{c.params.instId || t('strategy.all')}</span>
                <span className="text-text-secondary">{t('strategy.marginDesc')}</span>
                <span className="text-text-tertiary mx-1">{normalizeOperator(c.params.operator, t)}</span>
                <span className="text-brand-blue font-medium">{c.params.margin}</span>
              </>
            );
          } else if (c.type === 'pos_mgn_ratio_val') {
            category = accName; categoryColor = accColor; categoryClassName = 'font-bold';
            content = (
              <>
                <span className="text-brand-blue font-medium mr-1">{c.params.instId || t('strategy.all')}</span>
                <span className="text-text-secondary">{t('strategy.mgnRatioDesc')}</span>
                <span className="text-text-tertiary mx-1">{normalizeOperator(c.params.operator, t)}</span>
                <span className="text-brand-blue font-medium">{c.params.ratio}%</span>
              </>
            );
          } else if (c.type === 'pos_liq_dist') {
            category = accName; categoryColor = accColor; categoryClassName = 'font-bold';
            content = (
              <>
                <span className="text-brand-blue font-medium mr-1">{c.params.instId || t('strategy.all')}</span>
                <span className="text-text-secondary">{t('strategy.liqDistDesc')}</span>
                <span className="text-text-tertiary mx-1">{normalizeOperator(c.params.operator, t)}</span>
                <span className="text-brand-blue font-medium">{c.params.dist}</span>
              </>
            );
          } else if (c.type === 'pos_funding_rate') {
            category = accName; categoryColor = accColor; categoryClassName = 'font-bold';
            content = (
              <>
                <span className="text-brand-blue font-medium mr-1">{c.params.instId || t('strategy.all')}</span>
                <span className="text-text-secondary">{t('strategy.fundingRateDesc')}</span>
                <span className="text-text-tertiary mx-1">{normalizeOperator(c.params.operator, t)}</span>
                <span className="text-brand-blue font-medium">{c.params.rate}%</span>
              </>
            );
          } else if (c.type === 'pos_closed_pnl') {
            category = accName; categoryColor = accColor; categoryClassName = 'font-bold';
            content = (
              <>
                <span className="text-brand-blue font-medium mr-1">{c.params.instId || t('strategy.all')}</span>
                <span className="text-text-secondary">{t('strategy.closedPnlDesc')}</span>
                <span className="text-text-tertiary mx-1">{normalizeOperator(c.params.operator, t)}</span>
                <span className="text-brand-blue font-medium">{c.params.amount}</span>
              </>
            );
          } else if (c.type === 'pos_hold_time') {
            category = accName; categoryColor = accColor; categoryClassName = 'font-bold';
            content = (
              <>
                <span className="text-brand-blue font-medium mr-1">{c.params.instId || t('strategy.all')}</span>
                <span className="text-text-secondary">{t('strategy.holdTimeDesc')}</span>
                <span className="text-text-tertiary mx-1">{normalizeOperator(c.params.operator, t)}</span>
                <span className="text-brand-blue font-medium">{fmtHoldTimeThreshold(c.params.value, c.params.unit)}</span>
              </>
            );
          } else if (c.type === 'pos_side') {
            category = accName; categoryColor = accColor; categoryClassName = 'font-bold';
            content = (
              <>
                <span className="text-brand-blue font-medium mr-1">{c.params.instId || t('strategy.all')}</span>
                <span className="text-text-secondary">{t('strategy.posSideDesc')}</span>
                <span className="text-brand-blue font-medium ml-1">{getPosSideLabel(String(c.params.side), t)}</span>
              </>
            );
          } else if (c.type === 'time_window') {
            category = t('strategy.timeWindow');
            content = (
              <>
                <span className="text-brand-blue font-medium">{c.params.startTime}-{c.params.endTime}</span>
                <span className="text-text-secondary ml-1">
                  {c.params.days?.length === 7
                    ? t('strategy.everyDay')
                    : `${t('strategy.weekPrefix')}${[...c.params.days].sort((a, b) => a - b).map((d: number) => t('strategy.dayNames')[d]).join('')}`
                  }
                </span>
              </>
            );
          } else if (c.type === 'cooldown') {
            category = t('strategy.cooldown');
            content = (
              <>
                <span className="text-brand-blue font-medium">{c.params.minutes}{t('strategy.minutes')}{c.params.seconds}{t('strategy.seconds')}</span>
              </>
            );
          } else if (c.type === 'count_limit') {
            category = t('strategy.dailyLimit');
            content = (
              <>
                <span className="text-brand-blue font-medium">{c.params.limit}{t('strategy.times')}</span>
              </>
            );
          } else if (c.type === 'tv_signal') {
            category = t('strategy.tvSignal');
            content = (
              <>
                <span className="text-text-secondary">{t('strategy.secretLabel')}</span>
                <span className="text-brand-blue font-medium ml-1">{c.params.secret}</span>
              </>
            );
          } else if (c.type === 'price_change' || c.type === 'price_change_24h' || c.type === 'price_change_today' || c.type === 'price_change_high24h') {
            const pcExchange = String(c.params.exchange || 'okx').toUpperCase();
            const pcInstId = String(c.params.instId || '');
            const pcWindow = c.type === 'price_change_high24h'
              ? t('condition.typePriceChangeHigh24h')
              : c.type === 'price_change_today' || c.params.window === 'today' ? t('condition.windowToday') : t('condition.window24h');
            const pcOp = normalizeOperator(String(c.params.operator || '>'), t);
            const pcThreshold = String(c.params.threshold || '0');
            const rawRepeat = String(c.params.repeat || '');
            const repeatMode = rawRepeat === 'true' ? 'repeat' : rawRepeat === 'false' ? 'once' : (rawRepeat || 'once');
            const pcRepeatLabel = repeatMode === 'repeat' ? t('condition.repeatMode.repeat') : repeatMode === 'daily' ? t('condition.repeatMode.daily') : '';
            category = (
              <>
                <span className="text-text-tertiary">{pcExchange}</span>
                {pcInstId && <span className="text-brand-blue font-bold ml-1">{pcInstId}</span>}
                {!pcInstId && <span className="text-brand-blue font-bold ml-1">{t('condition.anyInstrument')}</span>}
              </>
            );
            categoryClassName = '';
            content = (
              <>
                <span className="text-text-secondary font-medium ml-1">{pcWindow}</span>
                <span className="text-text-tertiary mx-0.5">{pcOp}</span>
                <span className="text-brand-blue font-medium">{pcThreshold}%</span>
                {pcRepeatLabel && <span className="px-1 rounded text-2xs bg-surface-3 text-text-tertiary ml-1">{pcRepeatLabel}</span>}
              </>
            );
          } else if (c.type === 'indicator') {
            const { name: indName, op: indOp, value: indVal, pair: indPair } = indShortSummary(c.params as Record<string, any>, t, (template as any).timeframe);
            category = indPair || '—';
            categoryClassName = 'font-bold text-brand-blue';
            content = (
              <>
                <span className="text-text-secondary font-medium">{indName}</span>
                <span className="text-text-tertiary mx-0.5">{indOp}</span>
                <span className="text-brand-blue font-medium">{indVal}</span>
              </>
            );
          } else {
            category = c.type;
            content = <span className="text-text-tertiary">{c.type}</span>;
          }

          return (
            <div key={c.id} className="px-1.5 py-0.5 rounded-full text-xs flex items-center gap-1 border border-border-default bg-surface-1 w-fit max-w-full">
              <span
                className={`shrink-0 ${categoryClassName}`}
                style={categoryColor ? { color: categoryColor } : undefined}
              >
                {category}
              </span>
              <div className={`flex items-center min-w-0 ${isLong ? 'overflow-hidden break-all' : 'truncate'}`}>
                {content}
              </div>
            </div>
          );
        })}
      </div>
    </ConfigCard>
  );
});

ConditionCard.displayName = 'ConditionCard';

export default ConditionCard;
