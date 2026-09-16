import type { Order, Position } from '../types/index.ts';
import type { HistoryPosition } from '../components/dashboard/HistoryPositionTable.tsx';

export interface TodayStatsData {
  todayProfit: number;
  todayAvgProfit: number;
  todayOpened: number;
  todayClosed: number;
  todayOrders: number;
  todayFilled: number;
}

export function todayStartMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function isToday(ts: string | number | undefined | null, t0: number): boolean {
  if (ts == null || ts === '') return false;
  const v = parseInt(String(ts), 10);
  return !isNaN(v) && v >= t0;
}

export function orderTimeMs(o: Order): string | undefined {
  return o.cTime || o.orderTime;
}

export function positionLifecycleKey(p: {
  posId?: string; cTime?: string; instId?: string; _accountId?: string;
}): string {
  const id = String(p.posId || `np:${p.instId || ''}`);
  return `${p._accountId || ''}|${id}|${String(p.cTime || '')}`;
}

export function computeTodayStats(
  historyPositions: HistoryPosition[] | undefined,
  historyOrders: Order[] | undefined,
  ordList: Order[] | undefined,
  posList: Position[] | undefined,
): TodayStatsData {
  const t0 = todayStartMs();
  const positions = historyPositions ?? [];
  const hOrders = historyOrders ?? [];
  const currentOrders = ordList ?? [];
  const currentPositions = posList ?? [];

  const FULL_CLOSE = '2';

  const closedToday = positions.filter(p => p.type === FULL_CLOSE && isToday(p.uTime, t0));
  const todayClosed = closedToday.length;
  const todayProfit = closedToday.reduce((sum, p) => sum + (parseFloat(p.realizedPnl || '0') || 0), 0);
  const todayAvgProfit = todayClosed > 0 ? todayProfit / todayClosed : 0;

  const openedTodayKeys = new Set<string>();
  for (const p of currentPositions) {
    if (isToday(p.cTime, t0)) openedTodayKeys.add(positionLifecycleKey(p));
  }
  for (const p of positions) {
    if (isToday(p.cTime, t0)) openedTodayKeys.add(positionLifecycleKey(p));
  }
  const todayOpened = openedTodayKeys.size;

  const countToday = (arr: Order[]) => arr.filter(o => isToday(orderTimeMs(o), t0)).length;
  const todayOrders = countToday(currentOrders) + countToday(hOrders);
  const todayFilled = hOrders.filter(o => isToday(orderTimeMs(o), t0) && o.state === 'filled').length;

  return { todayProfit, todayAvgProfit, todayOpened, todayClosed, todayOrders, todayFilled };
}
