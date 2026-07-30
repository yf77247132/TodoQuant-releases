
export enum LogLevel {
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  DEBUG = 'debug'
}

export type ErrorCategory = 'USER' | 'SYSTEM' | 'API';

export interface LogKeyParams {
  [key: string]: string | number | boolean;
}

export interface LogEntry {
  id?: number;
  bootId?: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  source?: string;
  account?: number;
  details?: Record<string, unknown>;
  script?: string;
  configId?: string;
  type?: string;
  category?: ErrorCategory;
  logKey?: string;
  logParams?: LogKeyParams;
  raw?: string;
}

export interface LogMessage {
  type: 'log';
  timestamp: number;
  level?: LogLevel;
  message: string;
  source?: string;
  account?: number;
  details?: Record<string, unknown>;
}
