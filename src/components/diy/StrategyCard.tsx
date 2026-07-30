import React, { memo, useState, useEffect, useMemo } from 'react';
import DashedHint from '../../ui/DashedHint'
import { useTranslation } from 'react-i18next';
import { Copy, Check, ExternalLink, RefreshCcw, FlaskConical } from 'lucide-react';
import ConfigCard from '../../ui/ConfigCard.tsx';
import Button from '../../ui/Button.tsx';
import { Tooltip } from '../../ui/Tooltip.tsx';
import { DIYStrategy, ConditionTemplate } from '../../types/index.ts';
import { PlaceConfigItem } from '../PlaceModule.tsx';
import { CancelConfigItem } from '../CancelModule.tsx';
import { AmendConfigItem } from '../AmendModule.tsx';
import { CloseConfigItem } from '../CloseModule.tsx';
import { MarginConfigItem } from '../MarginModule.tsx';
import { getConfigSummary } from './configSummarizer.ts';

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

interface StrategyCardProps {
  strategy: DIYStrategy;
  conditionTemplates: ConditionTemplate[];
  placeConfigs: PlaceConfigItem[];
  cancelConfigs: CancelConfigItem[];
  amendConfigs: AmendConfigItem[];
  closeConfigs: CloseConfigItem[];
  marginConfigs: MarginConfigItem[];
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  accounts?: { id: string; name: string }[];
  isSelected?: boolean;
  onClick?: () => void;
  onEdit: (strategy: DIYStrategy) => void;
  onDuplicate?: () => void;
  onPin?: (id: string) => void;
  onDelete: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  allStrategies?: DIYStrategy[];
  batchMode?: boolean;
  isBatchSelected?: boolean;
  onToggleSelect?: () => void;
  onBacktest?: (id: string) => void;
}

const StrategyCard = memo(({
  strategy,
  conditionTemplates,
  placeConfigs,
  cancelConfigs,
  amendConfigs,
  closeConfigs,
  marginConfigs,
  accountNames,
  accountColors,
  accounts,
  isSelected = false,
  onClick,
  onEdit,
  onDuplicate,
  onPin,
  onDelete,
  onStart,
  onStop,
  allStrategies = [],
  batchMode = false,
  isBatchSelected = false,
  onToggleSelect,
  onBacktest,
}: StrategyCardProps) => {
  const { t } = useTranslation();
  const template = conditionTemplates.find(c => c.id === strategy.conditionTemplateId);
  const templateName = template?.name || t('strategy.unknown');
  
  const getLiveSummary = () => {
    if (!template || !template.conditions || template.conditions.length === 0) return t('strategy.noConditionConfig');
    
    return template.conditions.map((c, idx) => {
      const live = strategy.liveStates?.[idx];
      const statusIcon = strategy.running ? (live?.result ? '✅' : '❌') : '⚪';
      const currentVal = (strategy.running && live?.currentVal) ? ` (${t('strategy.current')}: ${live.currentVal})` : '';
      
      const params = c.params;
      let accountName = t('strategy.accountDeleted');
      const accountId = String(params.accountId || '').trim();
      if (accountId && accounts) {
        const found = accounts.find(a => a.id === accountId);
        accountName = found?.name || accountName;
      }
      
      let desc = '';
      switch (c.type) {
        case 'balance_less': desc = `[${accountName}]${t('strategy.balanceDesc')}${params.operator}${params.threshold}`; break;
        case 'pos_count': desc = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.posCountDesc')}${params.operator}${params.count}`; break;
        case 'pos_sz_limit': desc = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.posSzDesc')}${params.operator}${params.size}`; break;
        case 'pos_side': 
          const sideMap: any = { long: t('strategy.longPos'), short: t('strategy.shortPos'), net: t('strategy.netPos') };
          desc = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.posSideDesc')}${t('strategy.direction')}${sideMap[params.side] || params.side}`; 
          break;
        case 'pos_pnl_amount': desc = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.pnlAmtDesc')}${params.operator}${params.amount} USDT`; break;
        case 'pos_pnl_rate': desc = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.pnlRateDesc')}${params.operator}${params.rate}%`; break;
        case 'pos_margin': desc = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.marginDesc')}${params.operator}${params.margin} USDT`; break;
        case 'pos_mgn_ratio_val': desc = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.mgnRatioDesc')}${params.operator}${params.ratio}%`; break;
        case 'pos_liq_dist': desc = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.liqDistDesc')}${params.operator}${params.dist} USDT`; break;
        case 'pos_funding_rate': desc = `[${accountName}]${params.instId || t('strategy.all')} ${t('strategy.fundingRateDesc')}${params.operator}${params.rate}%`; break;
        case 'time_window': 
          const daysStr = params.days?.length === 7 ? t('strategy.everyDay') : `${t('strategy.weekPrefix')}${[...params.days].sort((a,b) => a-b).map((d: number) => t('strategy.dayNames')[d]).join('')}`;
          desc = `[${t('strategy.timeWindow')}]${params.startTime}-${params.endTime}${daysStr}`; 
          break;
        case 'cooldown': desc = `[${t('strategy.cooldown')}]${params.minutes}${t('strategy.minutes')}${params.seconds}${t('strategy.seconds')}`; break;
        case 'count_limit': desc = `[${t('strategy.dailyLimit')}]${params.limit}${t('strategy.times')}`; break;
        case 'tv_signal': desc = `[${t('strategy.tvSignal')}]${t('strategy.secretLabel')} ${params.secret}`; break;
        case 'indicator': {
          const { name, op, value, pair } = indShortSummary(params as Record<string, any>, t, (template as any)?.timeframe);
          desc = `[${pair || '—'}] ${name} ${op} ${value}`;
          break;
        }
        case 'price_change':
        case 'price_change_24h':
        case 'price_change_today': {
          const pcExchange = String(params.exchange || 'okx').toUpperCase();
          const pcInstId = String(params.instId || '');
          const pcWindow = c.type === 'price_change_today' || params.window === 'today' ? t('condition.windowToday') : t('condition.window24h');
          const pcOpRaw = String(params.operator || '>');
          const pcOp = pcOpRaw === 'cross_above' ? t('indicators.crossAbove') : pcOpRaw === 'cross_below' ? t('indicators.crossBelow') : pcOpRaw;
          const pcThreshold = String(params.threshold || '0');
          const pcLabel = pcInstId || t('condition.anyInstrument');
          const rawRepeat = String(params.repeat || '');
          const repeatMode = rawRepeat === 'true' ? 'repeat' : rawRepeat === 'false' ? 'once' : (rawRepeat || 'once');
          const pcRepeat = repeatMode === 'repeat' ? ` ${t('condition.repeatMode.repeat')}` : repeatMode === 'daily' ? ` ${t('condition.repeatMode.daily')}` : '';
          desc = `[${pcExchange}] [${pcLabel}] ${pcWindow} ${pcOp} ${pcThreshold}%${pcRepeat}`;
          break;
        }
        default: desc = `[${c.type}]`;
      }
      
      return `${statusIcon} ${desc}${currentVal}`;
    }).join('\n');
  };

  const conditionSummary = getLiveSummary();

  const matchedCount = strategy.liveStates?.filter(s => s.result).length || 0;
  const totalCount = template?.conditions.length || 0;

  const tvSignalCondition = template?.conditions?.find(c => c.type === 'tv_signal');
  const [tunnelUrl, setTunnelUrl] = useState('');
  const [tunnelStatus, setTunnelStatus] = useState<'idle' | 'starting' | 'running' | 'error' | 'stopped'>('idle');
  const [restarting, setRestarting] = useState(false);

  const getApiBase = async () => {
    if (window.electronAPI) {
      const port = await window.electronAPI.getBackendPort();
      return `http://localhost:${port}`;
    }
    return '';
  };

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const check = async () => {
      try {
        const base = await getApiBase();
        const r = await fetch(`${base}/api/tunnel/status`, { signal: controller.signal });
        const data = await r.json();
        if (!cancelled) {
          setTunnelStatus(data.status);
          if (data.url) {
            setTunnelUrl(data.url);
            clearInterval(timer);
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    };
    check();
    const timer = setInterval(check, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      controller.abort();
    };
  }, []);

  const handleRestartTunnel = async () => {
    setRestarting(true);
    setTunnelStatus('starting');
    setTunnelUrl('');
    try {
      const base = await getApiBase();
      const r = await fetch(`${base}/api/tunnel/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 3000 })
      });
      const data = await r.json();
      if (data.ok && data.url) {
        setTunnelUrl(data.url);
        setTunnelStatus('running');
      } else {
        setTunnelStatus('error');
      }
    } catch {
      setTunnelStatus('error');
    } finally {
      setRestarting(false);
    }
  };

  const webhookBaseUrl = tunnelUrl || window.location.origin;
  const webhookUrl = `${webhookBaseUrl}/api/webhooks/tradingview`;
  const webhookPayload = useMemo(() => JSON.stringify({
    strategyId: strategy.id,
    secret: tvSignalCondition?.params?.secret || 'YOUR_SECRET'
  }, null, 2), [strategy.id, tvSignalCondition?.params?.secret]);

  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);

  const handleCopyWebhook = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      navigator.clipboard.writeText(webhookUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
    }
  };

  const handleCopyPayload = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      navigator.clipboard.writeText(webhookPayload);
      setCopiedPayload(true);
      setTimeout(() => setCopiedPayload(false), 2000);
    } catch {
    }
  };

  return (
    <ConfigCard
      name={strategy.name}
      isRunning={strategy.running}
      isSelected={isSelected}
      testMode={strategy.testMode}
      shortcutKey={strategy.shortcut_key}
      onClick={onClick}
      onEdit={() => onEdit(strategy)}
      onDuplicate={onDuplicate}
      onPin={onPin ? () => onPin(strategy.id) : undefined}
      onDelete={() => onDelete(strategy.id)}
      onStart={() => onStart(strategy.id)}
      onStop={() => onStop(strategy.id)}
      batchMode={batchMode}
      isBatchSelected={isBatchSelected}
      onToggleSelect={onToggleSelect}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <div className="px-1.5 py-0.5 rounded-full text-xs flex items-center gap-1 border border-border-default bg-surface-1 w-fit max-w-full">
            <span className="text-text-tertiary font-normal shrink-0">
              {t('strategy.condition')}
            </span>
            <div className="flex items-center min-w-0">
              <Tooltip content={conditionSummary}>
                <DashedHint className="text-brand-blue font-medium border-brand-blue/40 hover:border-brand-blue cursor-help inline-flex items-center gap-1.5 truncate block w-full">
                  {templateName}
                  
                  {strategy.running && totalCount > 0 && (
                    <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-surface-3 rounded-full border border-border-subtle">
                      {template?.conditions.map((_, idx) => {
                        const isMatched = strategy.liveStates?.[idx]?.result;
                        return (
                          <div 
                            key={idx}
                            className={`w-1.5 h-1.5 rounded-full ${isMatched ? 'bg-trade-green' : 'bg-trade-red/40'}`}
                          />
                        );
                      })}
                      <span className="ml-1 text-2xs text-text-tertiary scale-90 origin-left">
                        {matchedCount}/{totalCount}
                      </span>
                    </div>
                  )}
                </DashedHint>
              </Tooltip>
            </div>
          </div>

          <div className="px-1.5 py-0.5 rounded-full text-xs flex items-center gap-1 border border-border-default bg-surface-1 w-fit max-w-full">
            <span className="text-text-tertiary font-normal shrink-0">
              {t('strategy.liveTrading')}
            </span>
            <div className="flex items-center min-w-0">
              <span className={`font-medium ${!strategy.testMode ? 'text-brand-yellow' : 'text-text-tertiary'}`}>
                {!strategy.testMode ? t('strategy.on') : t('strategy.off')}
              </span>
            </div>
          </div>

          {tvSignalCondition && (
            <a 
              href="https://3c.wiki/TRADINGVIEW-3CSIGNAL" 
              target="_blank" 
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs px-2 py-0.5 bg-brand-blue/10 text-brand-blue border border-brand-blue/20 rounded-md hover:bg-brand-blue/20 transition-all font-bold flex items-center gap-1.5"
            >
              {t('strategy.goToTV')}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}

          {onBacktest && (
            <Tooltip content="回测">
              <button
                onClick={(e) => { e.stopPropagation(); onBacktest(strategy.id); }}
                className="p-1 rounded-md text-text-tertiary hover:text-brand-blue hover:bg-brand-blue/10 border border-transparent hover:border-brand-blue/20 transition-all"
              >
                <FlaskConical className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
        </div>

        {tvSignalCondition && (
          <div className="flex flex-col gap-1.5 p-2 bg-surface-3 rounded-xl border border-border-subtle mt-1">
            <div className="flex items-center gap-2">
              <span className="text-2xs text-text-muted font-bold uppercase tracking-tight shrink-0 w-[72px] whitespace-nowrap">Webhook URL</span>
              <Tooltip 
                content={
                  <div className="space-y-1">
                    <p className="text-2xs text-text-secondary font-bold">{t('strategy.tvWebhookTitle')}</p>
                    <code className="block p-1.5 bg-surface-3 rounded text-2xs text-brand-blue break-all">{webhookUrl}</code>
                    <p className="text-2xs text-trade-red font-medium">{t('strategy.tvUrlWarning')}</p>
                  </div>
                }
                className="flex-1 min-w-0"
              >
                <DashedHint as="div" className="text-2xs text-brand-blue font-mono truncate cursor-help">
                  {tunnelUrl ? webhookUrl : tunnelStatus === 'error' ? t('strategy.urlFailed') : t('strategy.urlGenerating')}
                </DashedHint>
              </Tooltip>
              {tunnelStatus === 'error' && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRestartTunnel}
                  title={t('strategy.restartTunnel')}
                  disabled={restarting}
                >
                  {restarting ? <RefreshCcw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
                </Button>
              )}
              {tunnelUrl && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCopyWebhook}
                  title={t('strategy.copyUrl')}
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-trade-green" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-2xs text-text-muted font-bold uppercase tracking-tight shrink-0 w-[72px] whitespace-nowrap">Webhook MSG</span>
              <Tooltip 
                content={
                  <div className="space-y-2">
                    <p className="text-2xs text-text-secondary font-bold">{t('strategy.tvMsgTitle')}</p>
                    <pre className="p-2 bg-surface-3 rounded text-2xs text-trade-green whitespace-pre-wrap">{webhookPayload}</pre>
                  </div>
                }
                className="flex-1 min-w-0"
              >
                <DashedHint as="div" className="text-2xs text-trade-green font-mono truncate cursor-help">
                  {webhookPayload.replace(/\s+/g, ' ')}
                </DashedHint>
              </Tooltip>
              <Button 
                variant="ghost"
                size="icon"
                onClick={handleCopyPayload}
                title={t('strategy.copyJson')}
              >
                {copiedPayload ? <Check className="w-3.5 h-3.5 text-trade-green" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1">
          {strategy.actions.map((action, idx) => {
            const label = action.type === 'place_order' ? t('strategy.actionPlace') : 
                         action.type === 'amend_order' ? t('strategy.actionAmend') :
                         action.type === 'cancel_order' ? t('strategy.actionCancel') :
                         action.type === 'close_pos' ? t('strategy.actionClose') :
                         action.type === 'prevent_margin_risk' ? t('strategy.actionTransfer') : 
                         action.type === 'notify' ? t('strategy.actionNotify') :
                         action.type === 'stop_strategy' ? t('strategy.actionStop') : t('strategy.actionDefault');
            
            let value = t('strategy.unknownConfig');
            let targetConfig: any = null;

            if (['notify', 'stop_strategy'].includes(action.type)) {
              if (action.type === 'notify') {
                const notifyType = action.params?.notify_type || 'pc';
                if (notifyType === 'email') {
                  value = action.params?.email || t('strategy.admin');
                } else if (notifyType === 'telegram') {
                  value = 'Telegram';
                } else {
                  value = 'PC';
                }
              } else {
                const targetId = action.targetConfigId || action.params?.targetId || action.params?.targetScript;
                if (targetId === 'all') {
                  value = t('strategy.allStrategies');
                } else if (targetId) {
                  const s = allStrategies.find(x => String(x.id) === String(targetId) || x.name === targetId);
                  value = s ? s.name : t('strategy.strategyColon', { id: targetId });
                } else {
                  value = t('strategy.unspecified');
                }
              }
              targetConfig = { ...action, _resolvedName: value };
            } else {
              const configs = (
                action.type === 'place_order' ? placeConfigs : 
                action.type === 'amend_order' ? amendConfigs :
                action.type === 'cancel_order' ? cancelConfigs :
                action.type === 'close_pos' ? closeConfigs :
                action.type === 'prevent_margin_risk' ? marginConfigs : []
              );
              targetConfig = configs.find(c => String(c.id) === String(action.targetConfigId));
              value = targetConfig?.name || t('strategy.unknownConfig');
            }
            
            const configSummary = getConfigSummary(action.type, targetConfig, accountNames, accountColors, accounts, t);

            return (
              <div key={idx} className="px-1.5 py-0.5 rounded-full text-xs flex items-center gap-1 border border-border-default bg-surface-1 w-fit max-w-full">
                <span className="text-text-tertiary font-normal shrink-0">
                  {label}
                </span>
                <div className="flex items-center min-w-0">
                  <Tooltip content={configSummary}>
                    <DashedHint className="text-brand-blue font-medium border-brand-blue/40 hover:border-brand-blue cursor-help truncate block w-full">
                      {value}
                    </DashedHint>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ConfigCard>
  );
});

StrategyCard.displayName = 'StrategyCard';

export default StrategyCard;
