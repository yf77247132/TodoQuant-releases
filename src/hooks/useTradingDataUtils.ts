
import type { AppConfig } from '../types/core.ts';
import type { LogEntry } from '../types/logs.ts';
import type { Account, Order, Position } from '../types/trading.ts';

export const LOG_WINDOW_SIZE = 300;
export const PENDING_MSG_MAX = 500;

export const SCRIPT_TO_LOG_KEY: Record<string, 'traderLogs' | 'amendLogs' | 'marginLogs' | 'diyLogs' | 'cancelLogs' | 'closeLogs'> = {
  trader: 'traderLogs', amend: 'amendLogs', margin: 'marginLogs',
  diy: 'diyLogs', cancel: 'cancelLogs', close: 'closeLogs',
};

export const ACTIVE_ORDER_STATES = new Set(['live', 'partially_filled', 'effective', 'partially_effective', 'new']);

export const shallowEqualRecord = <T extends string | number | boolean | null | undefined>(
  a: Record<string, T> | undefined,
  b: Record<string, T> | undefined
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
};

export const hasPatchChanges = (base: Partial<AppConfig>, patch: Partial<AppConfig>): boolean => {
  const keys = Object.keys(patch) as Array<keyof AppConfig>;
  for (const key of keys) {
    if (base[key] !== patch[key]) return true;
  }
  return false;
};

export const isDuplicateLogEntry = (existing: LogEntry[], incoming: LogEntry): boolean => {
  if (incoming.id !== undefined && incoming.id !== null) {
    return existing.some((item) => {
      if (item.bootId && incoming.bootId && item.bootId !== incoming.bootId) {
        return false;
      }
      return item.id === incoming.id;
    });
  }
  return existing.some((item) =>
    item.timestamp === incoming.timestamp &&
    item.script === incoming.script &&
    item.configId === incoming.configId &&
    item.level === incoming.level &&
    item.message === incoming.message
  );
};

export const mergeLogEntries = (existing: LogEntry[], incoming: LogEntry[]): LogEntry[] => {
  if (!incoming.length) return existing;
  const merged = [...existing];
  for (const item of incoming) {
    if (!isDuplicateLogEntry(merged, item)) {
      merged.push(item);
    }
  }
  merged.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    const aId = a.id ?? Number.MAX_SAFE_INTEGER;
    const bId = b.id ?? Number.MAX_SAFE_INTEGER;
    return aId - bId;
  });
  return merged.slice(-LOG_WINDOW_SIZE);
};

export const buildPositionKey = (p: Partial<Position>): string =>
  p.posId ? `${p.posId}_${p._account}` : `${p.instId}_${p.posSide}_${p._account}`;

export const buildOrderKey = (o: Partial<Order>, id: string): string =>
  `${o.instId}_${id}_${o._account}`;

export const isEmptyPosition = (p: Partial<Position>): boolean =>
  (!p.pos || p.pos === '0') && (!p.availPos || p.availPos === '0');
