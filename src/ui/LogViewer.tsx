import React, { memo, useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FilePlus2, Edit3, Trash2, XCircle, ArrowLeftRight, Cpu, Copy, Check } from 'lucide-react';
import { translateExecutionLog } from '../lib/logTranslatorPatch.ts';
import { LOG_TEMPLATES } from '../lib/logTemplates.ts';
import Button from './Button.tsx';

interface LogItem {
  id?: number;
  message: string;
  level?: 'info' | 'warn' | 'error' | 'debug' | string;
  timestamp: number;
  category?: 'USER' | 'SYSTEM' | 'API';
  script?: string;
  logKey?: string;
  logParams?: Record<string, string | number | boolean>;
}

interface LogViewerProps {
  logs: LogItem[];
  title: string;
  icon: 'file-plus' | 'edit' | 'trash' | 'x-circle' | 'transfer' | 'cpu';
  running: boolean;
  autoScroll: boolean;
  onAutoScrollChange: (checked: boolean) => void;
  onClearLogs: () => void;
  height?: string;
  accountNames?: Record<string, string>;
  accountColors?: Record<string, string>;
  timezone?: string;
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
    } catch {
    }
  }
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
};

const KV_PATTERN = /([\u4e00-\u9fffdA-Z][\w\u4e00-\u9fff()₮%.+\-☆★✅❌⚠️\s]*[^:])(:\s*)(.*?)(?=(?:,\s*[\u4e00-\u9fffdA-Z][\w\u4e00-\u9fff()₮%.+\-☆★✅❌⚠️\s]*[^:]):|,|$)/g;

const LOG_VAR_REGEX = /(₮?-?\d+(?:\.\d+)?(?:ms|个|点|%|USDT|USDC|BTC|ETH)?|[A-Z0-9]+-[A-Z0-9]+(?:-[A-Z0-9]+)?|单向持仓|双向持仓|现货|逐仓|全仓|限价委托|市价委托|限价-Post only|限价-FOK|限价-IOC|单向止盈止损|双向止盈止损|追逐限价|计划委托|移动止盈止损)/g;

const LogLine = memo(({ l, accountNames = {}, accountColors = {}, timezone }: { 
  l: LogItem, 
  accountNames?: Record<string, string>,
  accountColors?: Record<string, string>,
  timezone?: string
}) => {
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
  const translatedMsg = useMemo(() => {
    const cleanMsg = displayMsg.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '').replace(/^(\[[A-Z][A-Za-z]*\]\s*)+/, '');

    if (l.logKey && LOG_TEMPLATES[l.logKey]) {
      const template = LOG_TEMPLATES[l.logKey];
      const isEnglish = i18n.language?.startsWith('en');
      if (isEnglish && template.en) {
        return template.en(l.logParams as any);
      }
      return cleanMsg;
    }

    return translateExecutionLog(cleanMsg, i18n.language);
  }, [displayMsg, i18n.language, l.logKey, l.logParams]);
  
  const names = useMemo(() => Object.values(accountNames).filter(Boolean), [accountNames]);
  const nameToColor = useMemo(() => {
    const map: Record<string, string> = {};
    Object.entries(accountNames).forEach(([idx, name]) => {
      if (name && accountColors[idx]) {
        map[name] = accountColors[idx];
      }
    });
    return map;
  }, [accountNames, accountColors]);

  const kwRegex = useMemo(() => {
    const keywordsPattern = '([^\\s]{1,10}成功|[^\\s]{1,10}失败|买|卖|多|空|sell|buy|long|short|✅|❌|开|关|On|Off)';
    const accountPattern = names.length > 0 ? `|(${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})` : '';
    return new RegExp(`${keywordsPattern}${accountPattern}`, 'g');
  }, [names]);

  const renderTextContent = (content: string) => {
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
          const isOnOff = ['开', '关', 'On', 'Off'].includes(kw);
          
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
  };

  const renderMessage = (text: string) => {
    const formatted = text.replace(/[：=]/g, ':').replace(/，/g, ', ');
    const pattern = KV_PATTERN;
    pattern.lastIndex = 0;

    const tokens = [];
    let lastIndex = 0;
    let match;
    
    while ((match = pattern.exec(formatted)) !== null) {
        if (match.index > lastIndex) {
             tokens.push({ type: 'text', content: formatted.slice(lastIndex, match.index) });
        }
        tokens.push({
            type: 'kv',
            key: match[1],
            colon: match[2],
            value: match[3]
        });
        lastIndex = pattern.lastIndex;
        if (match[0].length === 0) pattern.lastIndex++;
    }
    
    if (lastIndex < formatted.length) {
        tokens.push({ type: 'text', content: formatted.slice(lastIndex) });
    }

    return (
        <span className="text-text-primary">
            {tokens.map((t, i) => {
                if (t.type === 'text') {
                    return <span key={i}>{renderTextContent(t.content)}</span>;
                } else if (t.type === 'kv') {
                    return (
                        <span key={i}>
                            <span>{t.key}: </span>
                            <span className="text-brand-blue">{renderTextContent(t.value.trim())}</span>
                        </span>
                    );
                }
                return null;
            })}
        </span>
    );
  };

  return (
    <div className="flex gap-3 py-0.5 border-b border-white/[0.02] hover:bg-surface-3 transition-colors min-w-0 overflow-hidden">
      <span className="text-text-primary shrink-0">{fmtTime(l.timestamp, timezone)}</span>
      <span className={`${color} break-words whitespace-normal flex-1 min-w-0 overflow-hidden`}>
        {renderMessage(translatedMsg)}
      </span>
    </div>
  );
});

LogLine.displayName = 'LogLine';

export default memo(function LogViewer({
  logs,
  title,
  icon,
  running,
  autoScroll,
  onAutoScrollChange,
  onClearLogs,
  height = "flex-1",
  accountNames = {},
  accountColors = {},
  timezone
}: LogViewerProps) {
  const { t } = useTranslation();
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [, setIsAtBottom] = useState(true);
  const mountedRef = useRef(true);

  const IconComponent = {
    'file-plus': FilePlus2,
    'edit': Edit3,
    'trash': Trash2,
    'x-circle': XCircle,
    'transfer': ArrowLeftRight,
    'cpu': Cpu
  }[icon];

  const handleAutoScrollChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onAutoScrollChange(e.target.checked);
  }, [onAutoScrollChange]);

  const handleClearLogs = useCallback(() => {
    onClearLogs();
  }, [onClearLogs]);

  const { i18n } = useTranslation();

  const copyWithFallback = useCallback((text: string): boolean => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }, []);

  const handleCopyLogs = useCallback(async () => {
    const isEnglish = i18n.language?.startsWith('en');
    const logText = logs
      .filter(Boolean)
      .map(log => {
        const timeStr = `[${fmtTime(log.timestamp, timezone)}] `;
        const cleanMsg = (log.message || '').replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '').replace(/^(\[[A-Z][A-Za-z]*\]\s*)+/, '');
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
        return `${timeStr}${translatedMsg}`;
      })
      .join('\n');

    setCopied(false);
    setCopyFailed(false);

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(logText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      }

      const fallbackOk = copyWithFallback(logText);
      if (fallbackOk) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      }

      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 2500);
    } catch (error) {
      const fallbackOk = copyWithFallback(logText);
      if (fallbackOk) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        console.error('Failed to copy logs', error);
        setCopyFailed(true);
        setTimeout(() => setCopyFailed(false), 2500);
      }
    }
  }, [logs, timezone, copyWithFallback, i18n.language]);

  const isAutoScrolling = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToBottom = useCallback(() => {
    if (!logContainerRef.current || !mountedRef.current) return;
    const el = logContainerRef.current;

    isAutoScrolling.current = true;

    const performScroll = () => {
      if (!mountedRef.current) return;
      el.scrollTop = el.scrollHeight;
    };

    performScroll();

    requestAnimationFrame(() => {
      if (!mountedRef.current) return;
      performScroll();

      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        performScroll();
        setTimeout(() => {
          if (mountedRef.current) {
            isAutoScrolling.current = false;
          }
        }, 150);
      }, 60);
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleScroll = useCallback(() => {
    if (!logContainerRef.current) return;
    
    if (isAutoScrolling.current) return; 
    
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 5;
    setIsAtBottom(atBottom);
  }, []);

  const detectManualStop = useCallback((event?: React.WheelEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!autoScroll || !logContainerRef.current) return;

    if (event && 'deltaY' in event && event.deltaY < 0) {
      onAutoScrollChange(false);
      return;
    }

    setTimeout(() => {
      if (!logContainerRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
      const atBottom = scrollHeight - scrollTop - clientHeight < 50;
      if (!atBottom && autoScroll) {
        onAutoScrollChange(false);
      }
    }, 50);
  }, [autoScroll, onAutoScrollChange]);

  useEffect(() => {
    if (!autoScroll || !logContainerRef.current) return;
    
    const observer = new MutationObserver(() => {
      if (autoScroll) scrollToBottom();
    });
    
    observer.observe(logContainerRef.current, { childList: true, subtree: true });

    const poller = setInterval(() => {
      if (autoScroll && logContainerRef.current && !isAutoScrolling.current) {
        const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
        const atBottom = scrollHeight - scrollTop - clientHeight < 30;
        if (!atBottom) {
          scrollToBottom();
        }
      }
    }, 2000);

    return () => {
      observer.disconnect();
      clearInterval(poller);
    };
  }, [autoScroll, scrollToBottom]);

  useEffect(() => {
    if (!logContainerRef.current || !autoScroll) return;
    const observer = new ResizeObserver(() => {
      if (autoScroll) scrollToBottom();
    });
    observer.observe(logContainerRef.current);
    return () => observer.disconnect();
  }, [autoScroll, scrollToBottom]);

  useEffect(() => {
    if (autoScroll) scrollToBottom();
  }, [autoScroll, scrollToBottom]);

  useEffect(() => {
    if (autoScroll && logs.length > 0) {
      scrollToBottom();
    }
  }, [logs.length, autoScroll, scrollToBottom]);

  return (
    <div className={`bg-surface-2 border border-border-default rounded-2xl flex flex-col overflow-hidden ${height || 'h-full'}`}>
      <div className="px-6 py-4 border-b border-border-default flex items-center justify-between bg-surface-2">
        <div className="flex items-center gap-2">
          <IconComponent className="w-4 h-4 text-brand-blue" />
          <h3 className="text-sm font-bold text-text-secondary">{title}</h3>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-2xs font-sans text-text-tertiary uppercase tracking-widest">{t('ui.logViewer.records', { count: logs.length })}</span>
        </div>
      </div>

      <div 
        className="flex-1 overflow-y-auto overflow-x-hidden p-4 font-sans text-xs space-y-1 bg-surface-1 min-w-0" 
        ref={logContainerRef} 
        onScroll={handleScroll}
        onWheel={detectManualStop}
        onTouchMove={detectManualStop}
      >
        {logs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-text-muted italic">
            <IconComponent className="w-12 h-12 mb-4 opacity-30" />
            {t('ui.logViewer.waiting')}
          </div>
        ) : (
          <>
            {logs.map((l, i) => <LogLine key={l.id || `${l.timestamp}-${i}`} l={l} accountNames={accountNames} accountColors={accountColors} timezone={timezone} />)}
            <div ref={logEndRef} />
          </>
        )}
      </div>

      <div className="px-6 py-3 border-t border-border-default bg-surface-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs font-bold text-text-tertiary uppercase tracking-wider cursor-pointer hover:text-text-primary">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={handleAutoScrollChange}
              className="rounded border-border-default bg-surface-1 text-brand-yellow focus:ring-focus-ring cursor-pointer"
            />
            {t('ui.logViewer.autoScroll')}
          </label>
          <div className="flex items-center gap-2 h-[17.14px]">
            <div className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-trade-green animate-pulse' : 'bg-surface-4'}`}></div>
            <span className="text-xs font-normal text-text-tertiary uppercase tracking-wider">{running ? t('ui.logViewer.running') : t('ui.logViewer.idle')}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={handleCopyLogs}>
            {copied ? <Check className="w-3.5 h-3.5 text-trade-green" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? t('ui.logViewer.copied') : copyFailed ? t('ui.logViewer.copyFailed') : t('ui.logViewer.copyLogs')}
          </Button>
          <Button className="hover:text-trade-red" onClick={handleClearLogs}>
            {t('ui.logViewer.clearLogs')}
          </Button>
        </div>
      </div>
    </div>
  );
});
