import React, { useState, useRef, useEffect, useMemo, memo } from 'react';
import { Terminal, X, Activity, AlertTriangle, Copy, Check, Server, Globe, Keyboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LogEntry, ErrorCategory } from '../../types/logs.ts';
import { useTradingData } from '../../hooks/useTradingData.ts';
import { translateExecutionLog } from '../../lib/logTranslatorPatch.ts';
import { LOG_TEMPLATES } from '../../lib/logTemplates.ts';
import Button from '../../ui/Button.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';

interface LogModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: LogEntry[];
  envStatus: Record<string, boolean>;
  hasError: boolean;
  onClear: () => void;
  timezone?: string;
}

type TabType = 'logs' | 'errors';

const ERROR_CATEGORY_CONFIG: Record<ErrorCategory, {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
  hint: string;
  tagColor: string;
}> = {
  USER: {
    icon: Keyboard,
    label: 'logModal.inputError',
    bgColor: 'bg-orange-500/10',
    textColor: 'text-orange-400',
    borderColor: 'border-orange-500/30',
    hint: 'logModal.inputErrorHint',
    tagColor: 'bg-orange-500/20 text-orange-400'
  },
  SYSTEM: {
    icon: Server,
    label: 'logModal.systemErrorLabel',
    bgColor: 'bg-trade-red/10',
    textColor: 'text-trade-red',
    borderColor: 'border-trade-red/30',
    hint: 'logModal.systemErrorHint',
    tagColor: 'bg-trade-red/20 text-trade-red'
  },
  API: {
    icon: Globe,
    label: 'logModal.apiErrorLabel',
    bgColor: 'bg-brand-blue/10',
    textColor: 'text-brand-blue',
    borderColor: 'border-brand-blue/30',
    hint: 'logModal.apiErrorHint',
    tagColor: 'bg-brand-blue/20 text-brand-blue'
  }
};

function extractCategory(log: LogEntry): ErrorCategory | undefined {
  if (log.category) return log.category;
  if (log.message.includes('[USER]')) return 'USER';
  if (log.message.includes('[SYSTEM]')) return 'SYSTEM';
  if (log.message.includes('[API]')) return 'API';
  return undefined;
}

const fmtTime = (ts: number, timezone?: string) => {
  const d = new Date(ts);
  
  if (timezone === 'UTC') {
    return d.toISOString().split('T')[1].split('.')[0];
  }

  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).formatToParts(d);
      const h = parts.find(p => p.type === 'hour')?.value || '00';
      const m = parts.find(p => p.type === 'minute')?.value || '00';
      const s = parts.find(p => p.type === 'second')?.value || '00';
      return `${h}:${m}:${s}`;
    } catch (e) {
      console.warn('LogModal timezone format error:', e);
    }
  }
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
};

const BLUE_FIELDS = new Set([
  "下单配置", "改单配置", "撤单配置", "平仓配置", "转账配置", "转账配置",
  "触发价增幅", "委托价增幅", "止盈增减", "止损增减",
  "回调幅度比例", "回调幅度比例增减", "回调幅度价距",
  "止盈幅度 (点)", "止损幅度 (点)",
  "止盈幅度", "止损幅度", "委托价",
  "触发/委托价", "委托价",
  "开仓均价", "未实现盈亏",
  "当前盈亏", "当前持仓量", "持仓量", "最大保证金", "最大保证金率",
  "当前最大收益率", "最大收益率", "收益额", "强平距离", "保证金率",
  "剩余周期", "交易对", "方向", "匹配方向", "当前方向", "仓位模式", "持仓数量", "仓位", "模式", "递增", "类型",
  "账号", "测试", "跳过", "止盈", "止损", "实盘", "反手",
  "可用", "阈值", "回调比例", "激活价", "激活价格",
  "间隔", "订单", "数量", "当前个数", "仓位个数", "目标",
  "转账数量", "支付账户", "运算符", "结果", "品种",
  "订单ID", "触发价", "价距", "数量",
  "成功", "失败",
  "检测", "USDT 可用", "USDC 可用", "BTC 可用", "ETH 可用",

  "Order Configuration", "Amend Configuration", "Cancel Configuration", "Close Position Configuration", "Transfer Configuration", "Anti-Liquidation Configuration",
  "Trigger Px Increment", "Order Px Increment", "TP Increment", "SL Increment",
  "Callback Margin Ratio", "Callback Ratio Increment", "Callback Margin Spread",
  "TP Range (pts)", "SL Range (pts)",
  "Trigger", "TP", "SL", "Price", "Chase", "Pullback ratio", "Pullback gap", "Active", "Sz",
  "Trigger/Order Price", "Order Price",
  "Avg Entry Price", "Unrealized PNL",
  "Current PNL", "Current Position Size", "Position Size", "Max Margin", "Max Margin Ratio",
  "Current Max ROI", "Max ROI", "Est. Liq Distance",
  "Remaining Cycles", "Trading Pair", "Direction", "Margin Mode", "Position Size", "Position", "Mode", "Increment", "Type",
  "Account", "Test Mode", "Real Execution", "Skip", "Take Profit (TP)", "Stop Loss (SL)",
  "Available", "Callback Ratio", "Activation Price", "Activation Price", "Activation Px Increment",
  "Interval", "Order", "Size", "Current count", "Position count", "Target",
  "Transfer Amount", "Pay Account", "Operator", "Result", "Instrument",
  "Order ID", "Trigger Price", "Spread",
  "Success", "Failed",
  "Check", "USDT Available", "USDC Available", "BTC Available", "ETH Available",
]);

const KEYWORDS_PATTERN = '([^\\s]{1,10}成功|[^\\s]{1,10}失败|买|卖|多|空|sell|buy|long|short|✅|❌|开|关|On|Off)';

const BLUE_FIELD_KEYS = Array.from(BLUE_FIELDS)
  .sort((a, b) => b.length - a.length)
  .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const BLUE_FIELD_PATTERN = new RegExp(`(${BLUE_FIELD_KEYS})(:\\s*)(.*?(?=(?:,?\\s*)(?:${BLUE_FIELD_KEYS}):|,|$))`, 'g');

const LOG_VAR_REGEX = /(₮?-?\d+(?:\.\d+)?(?:ms|个|点|%|USDT|USDC|BTC|ETH)?|[A-Z0-9]+-[A-Z0-9]+(?:-[A-Z0-9]+)?|单向持仓|双向持仓|现货|逐仓|全仓|限价委托|市价委托|限价-Post only|限价-FOK|限价-IOC|单向止盈止损|双向止盈止损|追逐限价|计划委托|移动止盈止损)/g;

const ON_OFF_KEYWORDS = new Set(['开', '关', 'On', 'Off']);

let _kwRegexCache: { key: string; regex: RegExp } | null = null;
function getKeywordRegex(names: string[]): RegExp {
  const key = names.join(' ');
  if (_kwRegexCache && _kwRegexCache.key === key) return _kwRegexCache.regex;
  const accountPattern = names.length > 0
    ? `|(${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`
    : '';
  _kwRegexCache = { key, regex: new RegExp(`${KEYWORDS_PATTERN}${accountPattern}`, 'g') };
  return _kwRegexCache.regex;
}

function renderTextContent(
  content: string,
  names: string[],
  nameToColor: Record<string, string>
): React.ReactNode[] {
  const kwRegex = getKeywordRegex(names);
  const matches = Array.from(content.matchAll(kwRegex));

  let lastIndex = 0;
  const elements: React.ReactNode[] = [];

  for (const match of matches) {
    const kw = match[0];
    const index = match.index!;

    if (index > lastIndex) {
      elements.push(content.slice(lastIndex, index));
    }

    let kwClass = "text-text-primary";
    let kwStyle: React.CSSProperties = {};

    const isSuccess = /成功$/.test(kw) || ['买', 'buy', '多', 'long', '✅'].includes(kw);
    const isFail = /失败$/.test(kw) || ['卖', 'sell', '空', 'short', '❌'].includes(kw);
    const isOnOff = ON_OFF_KEYWORDS.has(kw);

    if (nameToColor[kw]) {
      kwClass = "";
      kwStyle = { color: nameToColor[kw] };
    }
    else if (isSuccess) kwClass = "text-trade-green";
    else if (isFail) kwClass = "text-trade-red";
    else if (isOnOff) kwClass = "text-brand-blue";

    elements.push(<span key={index} className={kwClass} style={kwStyle}>{kw}</span>);
    lastIndex = index + kw.length;
  }

  if (lastIndex < content.length) {
    const remainingContent = content.slice(lastIndex);
    const varMatches = Array.from(remainingContent.matchAll(LOG_VAR_REGEX));

    let vLastIndex = 0;
    for (const vMatch of varMatches) {
      const vKw = vMatch[0];
      const vIndex = vMatch.index!;

      if (vIndex > vLastIndex) {
        elements.push(remainingContent.slice(vLastIndex, vIndex));
      }
      elements.push(<span key={`var_${vIndex}`} className="text-brand-blue">{vKw}</span>);
      vLastIndex = vIndex + vKw.length;
    }
    if (vLastIndex < remainingContent.length) {
      elements.push(remainingContent.slice(vLastIndex));
    }
  }

  return elements;
}

function renderMessage(
  text: string,
  names: string[],
  nameToColor: Record<string, string>
): React.ReactNode {
  const formatted = text.replace(/[：=]/g, ':').replace(/，/g, ', ');

  const tokens: Array<{ type: string; content?: string; key?: string; colon?: string; value?: string }> = [];
  let lastIndex = 0;

  for (const m of formatted.matchAll(BLUE_FIELD_PATTERN)) {
    const mIndex = m.index!;
    if (mIndex > lastIndex) {
      tokens.push({ type: 'text', content: formatted.slice(lastIndex, mIndex) });
    }
    tokens.push({ type: 'kv', key: m[1], colon: m[2], value: m[3] });
    lastIndex = mIndex + m[0].length;
  }

  if (lastIndex < formatted.length) {
    tokens.push({ type: 'text', content: formatted.slice(lastIndex) });
  }

  return (
    <span className="text-text-primary">
      {tokens.map((t, i) => {
        if (t.type === 'text') {
          return <span key={i}>{renderTextContent(t.content!, names, nameToColor)}</span>;
        } else if (t.type === 'kv') {
          return (
            <span key={i}>
              <span>{t.key}: </span>
              <span className="text-brand-blue">{renderTextContent(t.value!.trim(), names, nameToColor)}</span>
            </span>
          );
        }
        return null;
      })}
    </span>
  );
}

const SystemLogLine = memo(({ l, timezone, accountNames, accountColors }: { l: LogEntry, timezone?: string, accountNames: Record<string, string>, accountColors: Record<string, string> }) => {
  const displayMsg = l.message || '';
  let color = 'text-text-primary';
  const lowMsg = displayMsg.toLowerCase();

  if (l.level === 'error') {
    if (l.category === 'USER') {
      color = 'text-orange-400';
    } else if (l.category === 'API') {
      color = 'text-brand-blue';
    } else {
      color = 'text-trade-red';
    }
  } else if (l.level === 'warn' || lowMsg.includes('[warning]') || lowMsg.includes('[warn]')) {
    color = 'text-brand-yellow';
  } else if (l.level === 'debug') {
    color = 'text-text-tertiary';
  }

  const { i18n } = useTranslation();
  const cleanMsg = useMemo(() => {
    const rawClean = displayMsg.replace(/^(?:\[\d{2}:\d{2}:\d{2}\]\s*)?(?:\[[A-Z][A-Za-z]*\]\s*)+/, '');
    if (l.logKey && LOG_TEMPLATES[l.logKey]) {
      const template = LOG_TEMPLATES[l.logKey];
      const isEnglish = i18n.language?.startsWith('en');
      if (isEnglish && template.en) {
        return template.en(l.logParams as any);
      }
      return rawClean;
    }
    return translateExecutionLog(rawClean, i18n.language);
  }, [displayMsg, i18n.language, l.logKey, l.logParams]);

  const names = Object.values(accountNames).filter(Boolean);
  const nameToColor = useMemo(() => {
    const map: Record<string, string> = {};
    Object.entries(accountNames).forEach(([idx, name]) => {
      if (name && accountColors[idx]) {
        map[name] = accountColors[idx];
      }
    });
    return map;
  }, [accountNames, accountColors]);

  let processedMsg = cleanMsg;
  Object.entries(accountNames).forEach(([idx, name]) => {
    if (name) {
      processedMsg = processedMsg.replace(new RegExp(`账户\\s*${idx}`, 'g'), name);
      processedMsg = processedMsg.replace(new RegExp(`\\[Account ${idx}\\]`, 'g'), name);
    }
  });

  return (
    <div className="flex gap-3 py-0.5 border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors min-w-0">
      <span className="text-text-primary shrink-0">{fmtTime(l.timestamp, timezone)}</span>
      <span className={`${color} break-words whitespace-normal flex-1 min-w-0 overflow-hidden`}>
        {renderMessage(processedMsg, names, nameToColor)}
      </span>
    </div>
  );
});

SystemLogLine.displayName = 'SystemLogLine';

export const LogModal: React.FC<LogModalProps> = React.memo(({ isOpen, onClose, logs, envStatus, onClear, timezone }) => {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>('logs');
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);
  const errorEndRef = useRef<HTMLDivElement>(null);
  const { config } = useTradingData();
  
  const accountNames = config?.accountNames || {};
  const accountColors = config?.accountColors || {};

  const sortedLogs = React.useMemo(() => {
    return [...logs].filter(Boolean).sort((a, b) => a.timestamp - b.timestamp);
  }, [logs]);

  useEffect(() => {
    if (isOpen && autoScroll) {
      const timer = setTimeout(() => {
        if (activeTab === 'logs' && logEndRef.current) {
          logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        } else if (activeTab === 'errors' && errorEndRef.current) {
          errorEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [sortedLogs, activeTab, isOpen, autoScroll]);

  const errorStats = React.useMemo(() => {
    interface ErrorStat {
      count: number; lastSeen: number; level: string; script?: string;
      category?: ErrorCategory; logKey?: string;
      logParams?: Record<string, string | number | boolean>; message: string;
    }
    const stats: Record<string, ErrorStat> = {};
    logs.filter(l => l && l.level === 'error').forEach(log => {
      const dedupKey = log.logKey || log.message;
      if (!stats[dedupKey]) {
        stats[dedupKey] = {
          count: 0, lastSeen: 0,
          level: log.level || 'error', script: log.script,
          category: extractCategory(log),
          logKey: log.logKey, logParams: log.logParams,
          message: log.message,
        };
      }
      stats[dedupKey].count++;
      stats[dedupKey].lastSeen = Math.max(stats[dedupKey].lastSeen, log.timestamp);
    });
    return Object.entries(stats).sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  }, [logs]);

  const handleCopyLogs = async () => {
    const isEnglish = i18n.language?.startsWith('en');
    const logText = logs
      .filter(Boolean)
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(log => {
        const cleanMsg = (log.message || '').replace(/^(\[.*?\]\s*)+/, '');
        let translatedMsg: string;
        if (log.logKey && LOG_TEMPLATES[log.logKey]) {
          const template = LOG_TEMPLATES[log.logKey];
          if (isEnglish && template.en) {
            translatedMsg = template.en(log.logParams as any);
          } else {
            translatedMsg = cleanMsg;
          }
        } else {
          translatedMsg = translateExecutionLog(cleanMsg, i18n.language);
        }
        return `[${fmtTime(log.timestamp, timezone)}] [${(log.level || 'info').toUpperCase()}] ${translatedMsg}`;
      })
      .join('\n');

    try {
      await navigator.clipboard.writeText(logText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="bg-surface-2 border border-border-default rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-border-default bg-surface-2 shrink-0">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Terminal className="w-6 h-6 text-brand-blue" />
              <div className="flex flex-col">
                <h2 className="font-bold text-text-secondary text-base leading-tight">{t('logModal.title')}</h2>
                <p className="text-3xs text-text-tertiary mt-1">{t('logModal.subtitle')}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-surface-3 rounded-full transition-all text-text-muted hover:text-text-primary"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex gap-1.5 p-1 bg-surface-1 rounded-xl w-fit border border-border-default">
            <TabButton
              active={activeTab === 'logs'}
              icon={Activity}
              label={t('logModal.realTimeLogs')}
              onClick={() => setActiveTab('logs')}
            />
            <TabButton
              active={activeTab === 'errors'}
              icon={AlertTriangle}
              label={t('logModal.errorStats')}
              onClick={() => setActiveTab('errors')}
              badge={logs.filter(l => l && l.level === 'error').length}
            />
          </div>
        </div>

        <div 
          className="flex-1 overflow-y-auto bg-surface-1 custom-scrollbar p-4 font-sans text-xs space-y-1"
          onScroll={(e) => {
            const el = e.currentTarget;
            const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
            if (!isNearBottom) {
              setAutoScroll(false);
            } else {
              setAutoScroll(true);
            }
          }}
        >
          {activeTab === 'logs' && Object.keys(envStatus || {}).length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {Object.entries(envStatus).map(([key, ok]) => (
                <div key={key} className="p-3 flex items-center justify-between rounded-xl border border-border-default bg-surface-2 shadow-sm">
                  <span className="text-2xs uppercase tracking-wider font-bold text-text-tertiary">{key}</span>
                  <div className={`flex items-center gap-2`}>
                    <span className={`text-2xs font-bold ${ok ? 'text-trade-green' : 'text-trade-red'}`}>{ok ? t('logModal.envStatusOK') : t('logModal.envStatusERR')}</span>
                    <div className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-trade-green shadow-[0_0_8px_color-mix(in_srgb,var(--color-trade-green)_50%,transparent)]' : 'bg-trade-red shadow-[0_0_8px_color-mix(in_srgb,var(--color-trade-red)_50%,transparent)]'}`}></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'logs' && (
            <>
              {sortedLogs.length === 0 ? (
                <EmptyState
                  icon={<Activity className="w-full h-full animate-pulse" />}
                  title={t('logModal.waitingLogs')}
                  variant="minimal"
                />
              ) : (
                <>
                  {sortedLogs.map((log, i) => (
                    <SystemLogLine key={`${log.timestamp}-${i}`} l={log} timezone={timezone} accountNames={accountNames} accountColors={accountColors} />
                  ))}
                  <div ref={logEndRef} />
                </>
              )}
            </>
          )}

          {activeTab === 'errors' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-text-tertiary uppercase tracking-widest">{t('logModal.errorAnalysis')}</h3>
                <div className="flex items-center gap-4 text-2xs">
                  <span className="flex items-center gap-1 text-orange-400">
                    <Keyboard className="w-3 h-3" /> {t('logModal.userInput')}
                  </span>
                  <span className="flex items-center gap-1 text-trade-red">
                    <Server className="w-3 h-3" /> {t('logModal.systemError')}
                  </span>
                  <span className="flex items-center gap-1 text-brand-blue">
                    <Globe className="w-3 h-3" /> {t('logModal.apiError')}
                  </span>
                </div>
              </div>

              {errorStats.length === 0 ? (
                <div className="py-20 flex flex-col items-center justify-center text-text-muted italic">
                  <Check className="w-12 h-12 mb-4 opacity-5" />
                  <p className="text-sm font-medium tracking-widest">{t('logModal.noErrors')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {errorStats.map(([msg, stat], i) => {
                    const category = stat.category;
                    const config = category ? ERROR_CATEGORY_CONFIG[category] : null;
                    const CategoryIcon = config?.icon || AlertTriangle;
                    const bgColor = config?.bgColor || (stat.level === 'error' ? 'bg-trade-red/10' : 'bg-brand-yellow/10');
                    const borderColor = config?.borderColor || (stat.level === 'error' ? 'border-trade-red/30' : 'border-brand-yellow/30');
                    const textColor = config?.textColor || (stat.level === 'error' ? 'text-trade-red' : 'text-brand-yellow');
                    const hint = config?.hint || t('log.checkErrorInfo');
                    const tagColor = config?.tagColor || (stat.level === 'error' ? 'bg-trade-red/20 text-trade-red' : 'bg-brand-yellow/20 text-brand-yellow');

                    return (
                      <div key={i} className={`p-4 rounded-xl border ${borderColor} ${bgColor} transition-all group opacity-80 hover:opacity-100`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${tagColor}`}>
                                {stat.level}
                              </span>
                              {category && (
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${tagColor}`}>
                                  {t(ERROR_CATEGORY_CONFIG[category].label)}
                                </span>
                              )}
                              <span className="text-[9px] text-text-muted font-sans">[{stat.script?.toUpperCase() || 'SYSTEM'}]</span>
                            </div>
                            <p className={`text-sm font-medium ${textColor}`}>
                              {stat.logKey && LOG_TEMPLATES[stat.logKey]
                                ? (i18n.language?.startsWith('en') && LOG_TEMPLATES[stat.logKey].en
                                    ? LOG_TEMPLATES[stat.logKey].en(stat.logParams as any)
                                    : stat.message.replace(/^(\[.*?\]\s*)+/, ''))
                                : translateExecutionLog(msg.replace(/^(\[.*?\]\s*)+/, ''), i18n.language)}
                            </p>
                            {category && (
                              <div className={`flex items-center gap-1.5 text-2xs ${config?.textColor || 'text-text-tertiary'}`}>
                                <span className="font-medium">→ {t(hint)}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-4 text-2xs text-text-muted">
                              <span className="flex items-center gap-1">
                                <Activity className="w-3 h-3" />
                                {t('logModal.occurrences')}: <b className="text-text-secondary">{stat.count}</b>
                              </span>
                              <span className="flex items-center gap-1">
                                <Terminal className="w-3 h-3" />
                                {t('logModal.lastSeen')}: <b className="text-text-secondary">{fmtTime(stat.lastSeen, timezone)}</b>
                              </span>
                            </div>
                          </div>
                          <div className="shrink-0">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${borderColor.replace('border', 'border-').replace('/30', '/5')} ${bgColor}`}>
                              <CategoryIcon className={`w-5 h-5 ${textColor}`} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={errorEndRef} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-border-default bg-surface-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs font-bold text-text-tertiary uppercase tracking-wider cursor-pointer hover:text-text-primary">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded border-border-default bg-surface-1 text-brand-yellow focus:ring-focus-ring cursor-pointer"
              />
              {t('logModal.autoScroll')}
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleCopyLogs}>
              {copied ? <Check className="w-3.5 h-3.5 text-trade-green" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? t('logModal.copied') : t('logModal.copyLogs')}
            </Button>
            <Button className="hover:text-trade-red" onClick={onClear}>
              {t('logModal.clearLogs')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
});

LogModal.displayName = 'LogModal';

interface TabButtonProps {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  badge?: number;
}

const TabButton: React.FC<TabButtonProps> = React.memo(({ active, icon: Icon, label, onClick, badge }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
      active
        ? 'bg-brand-blue text-text-primary shadow-lg shadow-brand-blue/20'
        : 'text-text-tertiary hover:text-text-primary hover:bg-surface-3'
    }`}
  >
    <Icon className={`w-3.5 h-3.5 ${active ? 'text-text-primary' : 'text-current'}`} />
    <span>{label}</span>
    {badge !== undefined && badge > 0 && (
      <span className={`px-1.5 py-0.5 rounded-md text-2xs font-black ${
        active ? 'bg-white text-brand-blue' : 'bg-trade-red text-text-primary'
      }`}>
        {badge}
      </span>
    )}
  </button>
));

TabButton.displayName = 'TabButton';
