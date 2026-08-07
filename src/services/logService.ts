import { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import { AsyncLocalStorage } from 'async_hooks';
import { LogLevel } from '../types/logs.ts';
import type { LogEntry, LogKeyParams, ErrorCategory } from '../types/logs.ts';
import { LOG_TEMPLATES } from '../lib/logTemplates.ts';

let wssRef: WebSocketServer | null = null;

export class LogService {
  private static history: LogEntry[] = [];
  private static MAX_HISTORY = 2000;

  private static storage = new AsyncLocalStorage<{ channel: string; configId?: string }>();
  private static timezone: string | null = null;
  private static logCounter = 0;
  private static bootId = String(Date.now() + Math.random());

  private static readonly DEBOUNCE_CACHE = new Map<string, number>();
  private static readonly DEBOUNCE_TTL_MS = 1000;

  private static generateLogDebounceKey(scriptType: string, message: string, level: string, configId?: string): string {
    return `${scriptType}:${level}:${configId || ''}:${message}`;
  }

  private static shouldSuppressLog(scriptType: string, message: string, level: string, configId?: string): boolean {
    const key = this.generateLogDebounceKey(scriptType, message, level, configId);
    const now = Date.now();
    const lastTime = this.DEBOUNCE_CACHE.get(key);

    if (lastTime && (now - lastTime) < this.DEBOUNCE_TTL_MS) {
      return true;
    }

    this.DEBOUNCE_CACHE.set(key, now);

    for (const [cachedKey, cachedTime] of this.DEBOUNCE_CACHE.entries()) {
      if (now - cachedTime > this.DEBOUNCE_TTL_MS * 2) {
        this.DEBOUNCE_CACHE.delete(cachedKey);
      }
    }

    return false;
  }

  static clearDebounceCache(): void {
    this.DEBOUNCE_CACHE.clear();
  }

  static setTimezone(tz: string | null) {
    this.timezone = tz;
  }

  private static detectNetworkError(message: string): { logKey?: string; logParams?: Record<string, string | number | boolean> } {
    if (!message) return {};
    let logKey: string | undefined;

    if (message.includes('socket hang up')) {
      logKey = 'error.network.socket_hang_up';
    } else if (message.includes('ECONNRESET')) {
      logKey = 'error.network.ECONNRESET';
    } else if (message.includes('ETIMEDOUT')) {
      logKey = 'error.network.ETIMEDOUT';
    } else if (message.includes('ECONNREFUSED')) {
      logKey = 'error.network.ECONNREFUSED';
    } else if (message.includes('EHOSTUNREACH')) {
      logKey = 'error.network.EHOSTUNREACH';
    } else if (message.includes('ENOTFOUND')) {
      logKey = 'error.network.ENOTFOUND';
    }

    return { logKey, logParams: logKey ? {} : undefined };
  }

  private static parseCategoryFromPrefixedMessage(message: string): ErrorCategory | undefined {
    const matched = message.match(/^\[(USER|SYSTEM|API)\]/);
    if (!matched) return undefined;
    return matched[1] as ErrorCategory;
  }

  private static ensureCategoryPrefix(message: string, category?: ErrorCategory): string {
    if (!category) return message;
    const prefixed = this.parseCategoryFromPrefixedMessage(message);
    if (prefixed) return message;
    return `[${category}] ${message}`;
  }

  static runWithRedirect<T>(channel: string, configId: string | undefined, fn: () => T | Promise<T>): T | Promise<T> {
    return this.storage.run({ channel, configId }, fn);
  }

  private static redirectStack: Array<{ channel: string; configId?: string }> = [];

  static pushRedirect(channel: string, configId?: string) {
    this.redirectStack.push({ channel, configId });
  }

  static popRedirect() {
    this.redirectStack.pop();
  }

  static init(wss: WebSocketServer) {
    wssRef = wss;
  }

  static getHistory(): LogEntry[] {
    return this.history;
  }

  private static redactSensitive(message: string): string {
    if (!message) return message;
    let result = message;
    
    result = result.replace(
      /([?&])(apiKey|secretKey|passphrase|secret|key)=([^&\s]+)/gi,
      (_, prefix, _fieldName, _value) => `${prefix}${_fieldName}=***`
    );
    
    result = result.replace(
      /"((?:api|secret)Key|passphrase|secret)"\s*:\s*"[^"]*"/gi,
      (_, fieldName) => `"${fieldName}":"***"`
    );
    result = result.replace(
      /'((?:api|secret)Key|passphrase|secret)'\s*:\s*'[^']*'/gi,
      (_, fieldName) => `'${fieldName}':'***'`
    );
    
    result = result.replace(
      /(OK-ACCESS-(?:KEY|SIGN|TIMESTAMP|PASSPHRASE)):\s*\S+/gi,
      (_, headerName) => `${headerName}: ***`
    );
    
    result = result.replace(
      /((?:api|secret)Key|passphrase|secret)\s*[:=]\s*([a-zA-Z0-9]{4})[a-zA-Z0-9]+/gi,
      (_, fieldName, prefix4) => `${fieldName}: ${prefix4}***`
    );
    
    result = result.replace(
      /(Bearer\s+)[A-Za-z0-9_-]+/gi,
      (_, prefix) => `${prefix}***`
    );
    
    result = result.replace(
      /(["'])([a-zA-Z0-9]{32,})\1/g,
      (_, quote, _value) => `${quote}***${quote}`
    );
    
    return result;
  }

  static addLog(scriptType: string, message: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info', category?: ErrorCategory, configId?: string) {
    const context = this.storage.getStore();
    let effectiveScriptType = scriptType;
    let effectiveConfigId = configId;

    if (context) {
      effectiveScriptType = context.channel;
      if (context.configId) {
        effectiveConfigId = context.configId;
      }
    } else if (this.redirectStack.length > 0) {
      const top = this.redirectStack[this.redirectStack.length - 1];
      effectiveScriptType = top.channel;
      if (top.configId) {
        effectiveConfigId = top.configId;
      }
    }

    const inferredCategory = category || (level === 'error' ? this.parseCategoryFromPrefixedMessage(message) : undefined);
    const normalizedMessage = level === 'error' ? this.ensureCategoryPrefix(message, inferredCategory) : message;
    const { logKey: networkLogKey, logParams: networkLogParams } = this.detectNetworkError(normalizedMessage);
    if (this.shouldSuppressLog(scriptType, message, level, effectiveConfigId)) {
      return;
    }
    const redactedMessage = this.redactSensitive(normalizedMessage);
    const logMessage = `[${effectiveScriptType.toUpperCase()}] ${redactedMessage}`;
    const timestamp = Date.now();
    const logId = ++this.logCounter;

    const logEntry: LogEntry = {
      type: 'log',
      id: logId,
      bootId: this.bootId,
      script: effectiveScriptType,
      configId: effectiveConfigId,
      message: logMessage,
      level: level as LogLevel,
      timestamp: timestamp,
      category: inferredCategory,
      logKey: networkLogKey,
      logParams: networkLogParams as LogKeyParams | undefined,
    };

    this.history.push(logEntry);
    if (this.history.length > this.MAX_HISTORY) {
      this.history.shift();
    }

    const tz = this.timezone || 'UTC';
    let timeStr = '';
    try {
      timeStr = new Intl.DateTimeFormat('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit', 
        hour12: false,
        timeZone: tz
      }).format(new Date(timestamp));
    } catch {
      timeStr = new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
    }
    const consoleMessage = `[${timeStr}] ${logMessage}`;

    if (level === 'error') {
      console.error(consoleMessage);
    } else if (level === 'warn') {
      console.warn(consoleMessage);
    } else {
      console.log(consoleMessage);
    }

    const wsManager = globalThis.OKX_WS_MANAGER as any;

    if (wsManager && typeof wsManager.sendLog === 'function') {
      wsManager.sendLog(logEntry);
    } else if (wssRef) {
      const payload = JSON.stringify(logEntry);
      wssRef.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    }
  }

  static info(scriptType: string, message: string, category?: ErrorCategory, configId?: string) {
    this.addLog(scriptType, message, 'info', category, configId);
  }

  static warn(scriptType: string, message: string, category?: ErrorCategory, configId?: string) {
    this.addLog(scriptType, message, 'warn', category, configId);
  }

  static error(scriptType: string, message: string, category?: ErrorCategory, configId?: string) {
    this.addLog(scriptType, message, 'error', category, configId);
  }

  static userError(scriptType: string, message: string, category?: ErrorCategory, configId?: string) {
    this.addLog(scriptType, message, 'error', category || 'USER', configId);
  }

  static systemError(scriptType: string, message: string, configId?: string) {
    this.addLog(scriptType, message, 'error', 'SYSTEM', configId);
  }

  static apiError(scriptType: string, message: string, configId?: string) {
    this.addLog(scriptType, message, 'error', 'API', configId);
  }

  static logKey(
    scriptType: string,
    key: string,
    params: Record<string, string | number | boolean>,
    level: 'info' | 'warn' | 'error' | 'debug' = 'info',
    configId?: string
  ) {
    const template = LOG_TEMPLATES[key];
    if (!template) {
      console.warn(`[LogService] 未注册的日志模板 key: ${key}`);
      this.addLog(scriptType, `[${key}] ${JSON.stringify(params)}`, level, undefined, configId);
      return;
    }

    const zhMessage = template.zh(params as any);
    const category = template.category;
    this.addLogWithMeta(scriptType, zhMessage, level, category, configId, key, params, '');
  }

  private static addLogWithMeta(
    scriptType: string,
    message: string,
    level: 'info' | 'warn' | 'error' | 'debug',
    category?: ErrorCategory,
    configId?: string,
    logKey?: string,
    logParams?: Record<string, string | number | boolean>,
    raw?: string
  ) {
    const context = this.storage.getStore();
    let effectiveScriptType = scriptType;
    let effectiveConfigId = configId;

    if (context) {
      effectiveScriptType = context.channel;
      if (context.configId) { effectiveConfigId = context.configId; }
    } else if (this.redirectStack.length > 0) {
      const top = this.redirectStack[this.redirectStack.length - 1];
      effectiveScriptType = top.channel;
      if (top.configId) { effectiveConfigId = top.configId; }
    }

    const inferredCategory = category || (level === 'error' ? this.parseCategoryFromPrefixedMessage(message) : undefined);
    const normalizedMessage = level === 'error' ? this.ensureCategoryPrefix(message, inferredCategory) : message;
    const { logKey: networkLogKey, logParams: networkLogParams } = this.detectNetworkError(normalizedMessage);
    const redactedMessage = this.redactSensitive(normalizedMessage);

    if (this.shouldSuppressLog(effectiveScriptType, redactedMessage, level, effectiveConfigId)) {
      return;
    }

    const logMessage = `[${effectiveScriptType.toUpperCase()}] ${redactedMessage}`;
    const timestamp = Date.now();
    const logId = ++this.logCounter;

    const logEntry: LogEntry = {
      type: 'log',
      id: logId,
      script: effectiveScriptType,
      configId: effectiveConfigId,
      message: logMessage,
      level: level as LogLevel,
      timestamp: timestamp,
      category: inferredCategory,
      logKey: logKey || networkLogKey,
      logParams: (logParams || networkLogParams) as LogKeyParams | undefined,
      raw,
    };

    this.history.push(logEntry);
    if (this.history.length > this.MAX_HISTORY) { this.history.shift(); }

    const tz = this.timezone || 'UTC';
    let timeStr = '';
    try {
      timeStr = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: tz }).format(new Date(timestamp));
    } catch {
      timeStr = new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
    }
    console.log(`[${timeStr}] ${logMessage}`);

    const wsManager = globalThis.OKX_WS_MANAGER as any;
    if (wsManager && typeof wsManager.sendLog === 'function') {
      wsManager.sendLog(logEntry);
    } else if (wssRef) {
      const payload = JSON.stringify(logEntry);
      wssRef.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) { client.send(payload); }
      });
    }
  }
}
