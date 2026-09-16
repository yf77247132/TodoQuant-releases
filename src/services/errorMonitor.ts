
import { LogService } from './logService.ts';
import { dbService } from './dbService.ts';
import type { ErrorCategory as UnifiedErrorCategory } from '../types/logs.ts';

export enum ErrorLevel {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFO = 'info'
}

export enum ErrorCategory {
  NETWORK = 'network',
  TRADING = 'trading',
  AUTH = 'auth',
  VALIDATION = 'validation',
  SYSTEM = 'system',
  CONFIG = 'config',
  STRATEGY = 'strategy',
  UNKNOWN = 'unknown'
}

export interface ErrorRecord {
  id: string;
  level: ErrorLevel;
  category: ErrorCategory;
  message: string;
  details?: Record<string, unknown>;
  stack?: string;
  script?: string;
  timestamp: number;
  userId?: string;
  resolved: boolean;
  errorClass?: UnifiedErrorCategory;
}

export interface ErrorStats {
  total: number;
  byLevel: Record<ErrorLevel, number>;
  byCategory: Record<ErrorCategory, number>;
  byScript: Record<string, number>;
  criticalCount: number;
  highCount: number;
}

interface ErrorMonitorConfig {
  maxRecords: number;
  alertThresholds: {
    critical: number;
    high: number;
  };
  timeWindow: number;
}

export class ErrorMonitor {
  private static errors: ErrorRecord[] = [];
  private static config: ErrorMonitorConfig = {
    maxRecords: 1000,
    alertThresholds: {
      critical: 3,
      high: 10
    },
    timeWindow: 5 * 60 * 1000
  };
  private static alertCallbacks: Array<(error: ErrorRecord) => void> = [];
  private static _lastWsDisconnectLog = 0;
  private static _networkErrCooldown = new Map<string, number>();
  private static readonly NETWORK_TRANSIENT_MARKERS = [
    'fetch failed',
    'socket hang up',
    'socket closed',
    'getaddrinfo',
    'AbortError',
  ];

  private static resolveUnifiedErrorClass(
    category: ErrorCategory,
    details?: Record<string, unknown>
  ): UnifiedErrorCategory {
    const raw = details?.errorClass;
    if (raw === 'USER' || raw === 'SYSTEM' || raw === 'API') return raw;

    if (category === ErrorCategory.VALIDATION || category === ErrorCategory.CONFIG) {
      return 'USER';
    }
    if (category === ErrorCategory.NETWORK || category === ErrorCategory.TRADING || category === ErrorCategory.AUTH) {
      return 'API';
    }
    return 'SYSTEM';
  }

  static async init(): Promise<void> {
    try {
      this.setupGlobalHandlers();
    } catch (error) {
      console.error('[ErrorMonitor] 初始化失败:', error);
    }
  }

  private static setupGlobalHandlers(): void {
    process.on('uncaughtException', (error) => {
      this.captureError(
        error as Error,
        ErrorLevel.HIGH,
        ErrorCategory.SYSTEM,
        { type: 'uncaughtException' }
      );
    });

    process.on('unhandledRejection', (reason) => {
      this.captureError(
        new Error(String(reason)),
        ErrorLevel.HIGH,
        ErrorCategory.SYSTEM,
        { type: 'unhandledRejection', reason: String(reason) }
      );
    });
  }

  static captureError(
    error: Error | string,
    level: ErrorLevel = ErrorLevel.MEDIUM,
    category: ErrorCategory = ErrorCategory.UNKNOWN,
    details?: Record<string, unknown>,
    script?: string
  ): ErrorRecord {
    const message = typeof error === 'string' ? error : error.message;
    const stack = typeof error === 'string' ? undefined : error.stack;

    if (
      message.includes('WebSocket closed without opened') ||
      message.includes('WebSocket was closed before the connection was established') ||
      message.includes('Client network socket disconnected before secure TLS connection was established') ||
      message.includes('ECONNRESET') ||
      message.includes('ETIMEDOUT') ||
      message.includes('ENOENT')
    ) {
      const now = Date.now();
      if (now - this._lastWsDisconnectLog < 3000) {
        return { id: 'skipped', level: ErrorLevel.INFO, category: ErrorCategory.NETWORK,
          message: 'WebSocket 连接断开（正常网络波动），马上自动重连', timestamp: now, resolved: true };
      }
      this._lastWsDisconnectLog = now;
      LogService.logKey(script || 'WS_RECONNECT', 'ws.disconnect.normal', {}, 'info');
      return {
        id: 'skipped',
        level: ErrorLevel.INFO,
        category: ErrorCategory.NETWORK,
        message: 'WebSocket 连接断开（正常网络波动），马上自动重连',
        timestamp: Date.now(),
        resolved: true
      };
    }

    if (ErrorMonitor.NETWORK_TRANSIENT_MARKERS.some((m) => message.includes(m))) {
      const now = Date.now();
      const last = ErrorMonitor._networkErrCooldown.get(message);
      if (last && now - last < 5000) {
        return {
          id: 'skipped',
          level,
          category,
          message,
          timestamp: now,
          resolved: false,
        };
      }
      ErrorMonitor._networkErrCooldown.set(message, now);
      if (ErrorMonitor._networkErrCooldown.size > 500) {
        for (const [k, ts] of ErrorMonitor._networkErrCooldown) {
          if (now - ts > 30000) ErrorMonitor._networkErrCooldown.delete(k);
        }
      }
    }

    const unifiedErrorClass = this.resolveUnifiedErrorClass(category, details);
    const normalizedDetails = {
      ...details,
      errorClass: unifiedErrorClass
    };

    const errorRecord: ErrorRecord = {
      id: this.generateErrorId(),
      level,
      category,
      message,
      details: normalizedDetails,
      stack,
      script,
      timestamp: Date.now(),
      resolved: false,
      errorClass: unifiedErrorClass
    };

    this.errors.push(errorRecord);

    if (this.errors.length > this.config.maxRecords) {
      this.errors.shift();
    }

    const logLevel = level === ErrorLevel.CRITICAL || level === ErrorLevel.HIGH ? 'error' : 'warn';
    LogService.addLog(script || 'ErrorMonitor', message, logLevel, unifiedErrorClass);

    dbService.saveError(errorRecord);

    this.cleanupOldErrors();

    this.checkAlertThreshold(errorRecord);

    this.triggerAlert(errorRecord);

    console.error(`[ErrorMonitor] ${level.toUpperCase()} [${category}] ${message}`);

    return errorRecord;
  }

  private static generateErrorId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private static checkAlertThreshold(error: ErrorRecord): void {
    const now = Date.now();
    const timeWindow = this.config.timeWindow;

    const recentErrors = this.errors.filter(e => 
      now - e.timestamp < timeWindow
    );

    const criticalCount = recentErrors.filter(e => e.level === ErrorLevel.CRITICAL).length;
    const highCount = recentErrors.filter(e => e.level === ErrorLevel.HIGH).length;

    if (error.level === ErrorLevel.CRITICAL && 
        criticalCount >= this.config.alertThresholds.critical) {
      console.error(`[ErrorMonitor] ALERT: ${criticalCount} critical errors in ${timeWindow / 1000} seconds`);
    }

    if (error.level === ErrorLevel.HIGH && 
        highCount >= this.config.alertThresholds.high) {
      console.error(`[ErrorMonitor] ALERT: ${highCount} high priority errors in ${timeWindow / 1000} seconds`);
    }
  }

  private static triggerAlert(error: ErrorRecord): void {
    this.alertCallbacks.forEach(callback => {
      try {
        callback(error);
      } catch (e) {
        console.error('[ErrorMonitor] 警报回调失败:', e);
      }
    });
  }

  static onAlert(callback: (error: ErrorRecord) => void): void {
    this.alertCallbacks.push(callback);
  }

  static getAllErrors(): ErrorRecord[] {
    return [...this.errors];
  }

  static getErrorsByLevel(level: ErrorLevel): ErrorRecord[] {
    return this.errors.filter(e => e.level === level);
  }

  static getErrorsByCategory(category: ErrorCategory): ErrorRecord[] {
    return this.errors.filter(e => e.category === category);
  }

  static getErrorsByScript(script: string): ErrorRecord[] {
    return this.errors.filter(e => e.script === script);
  }

  static getRecentErrors(count: number = 50): ErrorRecord[] {
    return this.errors.slice(-count);
  }

  static getUnresolvedErrors(): ErrorRecord[] {
    return this.errors.filter(e => !e.resolved);
  }

  static resolveError(id: string): boolean {
    const error = this.errors.find(e => e.id === id);
    if (error) {
      error.resolved = true;
      dbService.resolveError(id);
      return true;
    }
    return false;
  }

  static captureLog(
    message: string,
    level: 'info' | 'warn' = 'info',
    details?: Record<string, unknown>,
    script?: string
  ): void {
    const unifiedErrorClass = this.resolveUnifiedErrorClass(ErrorCategory.SYSTEM, details);
    const normalizedDetails = {
      ...details,
      errorClass: unifiedErrorClass
    };

    const errorRecord: ErrorRecord = {
      id: this.generateErrorId(),
      level: level === 'warn' ? ErrorLevel.LOW : ErrorLevel.INFO,
      category: ErrorCategory.SYSTEM,
      message,
      details: normalizedDetails,
      script,
      timestamp: Date.now(),
      resolved: true,
      errorClass: unifiedErrorClass
    };

    this.errors.push(errorRecord);

    if (this.errors.length > this.config.maxRecords) {
      this.errors.shift();
    }

    LogService.addLog(script || 'ErrorMonitor', message, level, unifiedErrorClass);

    dbService.saveError(errorRecord);

    this.cleanupOldErrors();
  }

  private static cleanupCounter = 0;
  private static readonly CLEANUP_THRESHOLD = 100;
  private static lastCleanupTime = 0;
  private static readonly CLEANUP_INTERVAL = 60000;

  private static cleanupOldErrors(): void {
    const now = Date.now();
    if (now - this.lastCleanupTime < this.CLEANUP_INTERVAL) return;

    this.cleanupCounter++;
    if (this.cleanupCounter >= this.CLEANUP_THRESHOLD) {
      this.cleanupCounter = 0;
      this.lastCleanupTime = now;
      dbService.deleteOldErrors(300);
    }
  }

  static getStats(): ErrorStats {
    const byLevel: Record<ErrorLevel, number> = {
      [ErrorLevel.CRITICAL]: 0,
      [ErrorLevel.HIGH]: 0,
      [ErrorLevel.MEDIUM]: 0,
      [ErrorLevel.LOW]: 0,
      [ErrorLevel.INFO]: 0
    };

    const byCategory: Record<ErrorCategory, number> = {
      [ErrorCategory.NETWORK]: 0,
      [ErrorCategory.TRADING]: 0,
      [ErrorCategory.AUTH]: 0,
      [ErrorCategory.VALIDATION]: 0,
      [ErrorCategory.SYSTEM]: 0,
      [ErrorCategory.CONFIG]: 0,
      [ErrorCategory.STRATEGY]: 0,
      [ErrorCategory.UNKNOWN]: 0
    };

    const byScript: Record<string, number> = {};

    this.errors.forEach(error => {
      byLevel[error.level]++;
      byCategory[error.category]++;
      if (error.script) {
        byScript[error.script] = (byScript[error.script] || 0) + 1;
      }
    });

    return {
      total: this.errors.length,
      byLevel,
      byCategory,
      byScript,
      criticalCount: byLevel[ErrorLevel.CRITICAL],
      highCount: byLevel[ErrorLevel.HIGH]
    };
  }

  static clearErrors(): void {
    this.errors = [];
  }

  static clearResolvedErrors(): void {
    this.errors = this.errors.filter(e => !e.resolved);
    dbService.clearResolvedErrors();
  }

  static updateConfig(config: Partial<ErrorMonitorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  static getErrorTrend(hours: number = 24): Array<{ hour: number; errorCount: number; warnCount: number }> {
    return dbService.getErrorTrend(hours);
  }

  static getFrequentErrors(limit: number = 10): Array<{
    message: string;
    count: number;
    lastSeen: number;
    level: 'error' | 'warn';
  }> {
    return dbService.getFrequentErrors(limit);
  }

  static getTodayErrorCount(): number {
    return dbService.getTodayErrorCount();
  }

  static captureNetworkError(
    error: Error | string,
    details?: Record<string, unknown>,
    script?: string
  ): ErrorRecord {
    return this.captureError(error, ErrorLevel.HIGH, ErrorCategory.NETWORK, details, script);
  }

  static captureTradingError(
    error: Error | string,
    details?: Record<string, unknown>,
    script?: string
  ): ErrorRecord {
    return this.captureError(error, ErrorLevel.CRITICAL, ErrorCategory.TRADING, details, script);
  }

  static captureAuthError(
    error: Error | string,
    details?: Record<string, unknown>,
    script?: string
  ): ErrorRecord {
    return this.captureError(error, ErrorLevel.HIGH, ErrorCategory.AUTH, details, script);
  }

  static captureValidationError(
    error: Error | string,
    details?: Record<string, unknown>,
    script?: string
  ): ErrorRecord {
    return this.captureError(error, ErrorLevel.MEDIUM, ErrorCategory.VALIDATION, details, script);
  }

  static captureStrategyError(
    error: Error | string,
    details?: Record<string, unknown>,
    script?: string
  ): ErrorRecord {
    return this.captureError(error, ErrorLevel.HIGH, ErrorCategory.STRATEGY, details, script);
  }
}
