
const HISTORY_CACHE_TTL_MS = 120_000;
export const INVALIDATED_WINDOW_MS = 12_000;
export const STALE_WINDOW_MS = 5 * 60_000;
export const STALE_SHORT_TTL_MS = 15_000;
const CLOCK_SKEW_TOLERANCE_MS = 3_000;

const historyCache = new Map<string, { ts: number; ttl: number; payload: Record<string, unknown> }>();
const invalidatedOrdersAt = new Map<string, number>();
const invalidatedPositionsAt = new Map<string, number>();

function markedAtFor(kind: 'orders' | 'positions', accountId: string): number {
  return (kind === 'orders' ? invalidatedOrdersAt : invalidatedPositionsAt).get(accountId) || 0;
}

export function getHistoryCache(key: string): Record<string, unknown> | null {
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.ts < hit.ttl) return hit.payload;
  historyCache.delete(key);
  return null;
}

export function setHistoryCache(key: string, payload: Record<string, unknown>, ttlMs: number = HISTORY_CACHE_TTL_MS): void {
  historyCache.set(key, { ts: Date.now(), ttl: ttlMs, payload });
  if (historyCache.size > 32) {
    const oldestKey = historyCache.keys().next().value;
    if (oldestKey !== undefined) historyCache.delete(oldestKey);
  }
}

function newestRecordMs(rows: Array<{ uTime?: string; cTime?: string }>): number {
  let max = 0;
  for (const r of rows) {
    const t = Number(r?.uTime || r?.cTime || 0);
    if (t > max) max = t;
  }
  return max;
}

export function isRecordStale(
  accountId: string,
  rows: Array<{ uTime?: string; cTime?: string }>,
  windowMs: number = INVALIDATED_WINDOW_MS,
  kind: 'orders' | 'positions' = 'orders',
): boolean {
  const markedAt = markedAtFor(kind, accountId);
  if (!markedAt || Date.now() - markedAt > windowMs) return false;
  const newest = newestRecordMs(rows);
  return newest === 0 || newest + CLOCK_SKEW_TOLERANCE_MS < markedAt;
}

export function invalidatePositionsHistoryCache(accountId: string): void {
  if (accountId) invalidatedPositionsAt.set(accountId, Date.now());
  const prefix = `positions-history:${accountId}:`;
  for (const key of historyCache.keys()) {
    if (key.startsWith(prefix)) historyCache.delete(key);
  }
}

export function invalidateOrdersHistoryCache(accountId: string): void {
  if (accountId) invalidatedOrdersAt.set(accountId, Date.now());
  const prefixes = [`orders-history:${accountId}:`, `algo-history:${accountId}:`];
  for (const key of historyCache.keys()) {
    if (prefixes.some(p => key.startsWith(p))) historyCache.delete(key);
  }
}

export function invalidateHistoryCachesForAction(accountId: string): void {
  if (!accountId) return;
  invalidatePositionsHistoryCache(accountId);
  invalidateOrdersHistoryCache(accountId);
}
