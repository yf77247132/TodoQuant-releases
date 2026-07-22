import { LogService } from '../../../services/logService.ts';
import { DIYStrategy } from '../../../types/diy.ts';

const SIGNAL_TTL_MS = 60_000;

export type SignalSource = 'tv' | 'ft';

export interface SignalQueueDeps {
  runningStrategies: Map<string, DIYStrategy>;
  pendingSignals: Map<string, { receivedAt: number; payload: unknown }>;
  requestTick: () => void;
}

export function onDataPushCore(_accountIdx: number, _channel: string, _data: unknown[]): void {
}

export function pushSignalCore(
  deps: SignalQueueDeps,
  strategyId: string,
  payload: unknown,
  source: SignalSource = 'tv'
): boolean {
  const strategy = deps.runningStrategies.get(strategyId);
  if (!strategy) {
    return false;
  }

  LogService.logKey('diy', 'diy.condition.tv.signal', { id: strategyId }, 'info', strategyId);

  const key = `${strategyId}:${source}`;

  const existing = deps.pendingSignals.get(key);
  if (existing && Date.now() - existing.receivedAt > SIGNAL_TTL_MS) {
    deps.pendingSignals.delete(key);
  }

  deps.pendingSignals.set(key, {
    receivedAt: Date.now(),
    payload
  });

  deps.requestTick();
  return true;
}

export function hasSignalForSource(
  pendingSignals: Map<string, { receivedAt: number; payload: unknown }>,
  strategyId: string,
  source: SignalSource
): boolean {
  return pendingSignals.has(`${strategyId}:${source}`);
}

export function getSignalForSource(
  pendingSignals: Map<string, { receivedAt: number; payload: unknown }>,
  strategyId: string,
  source: SignalSource
): { receivedAt: number; payload: unknown } | undefined {
  return pendingSignals.get(`${strategyId}:${source}`);
}

export function hasAnySignal(
  pendingSignals: Map<string, { receivedAt: number; payload: unknown }>,
  strategyId: string
): boolean {
  return pendingSignals.has(`${strategyId}:tv`) || pendingSignals.has(`${strategyId}:ft`);
}

export function cleanupExpiredSignals(pendingSignals: Map<string, { receivedAt: number; payload: unknown }>): number {
  let cleaned = 0;
  const now = Date.now();
  for (const [id, signal] of pendingSignals) {
    if (now - signal.receivedAt > SIGNAL_TTL_MS) {
      pendingSignals.delete(id);
      cleaned++;
    }
  }
  return cleaned;
}
