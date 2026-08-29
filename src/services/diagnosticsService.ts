
interface ActiveRequest {
  id: string;
  method: string;
  path: string;
  startTime: number;
  query?: string;
}

const activeRequests = new Map<string, ActiveRequest>();
let reqCounter = 0;

interface EventLoopBlock {
  delayMs: number;
  timestamp: number;
}

const eventLoopBlockHistory: EventLoopBlock[] = [];
const MAX_BLOCK_HISTORY = 30;

interface SlowRequest {
  method: string;
  path: string;
  durationMs: number;
  finishedAt: number;
  query?: string;
}

const slowRequests: SlowRequest[] = [];
const MAX_SLOW_REQUESTS = 20;

const SLOW_THRESHOLD_MS = 3000;

const POOL_NEAR_FULL = 5;

export function trackRequestStart(method: string, path: string, query?: string): string {
  const id = `req_${Date.now()}_${++reqCounter}`;
  activeRequests.set(id, {
    id,
    method,
    path,
    startTime: Date.now(),
    query,
  });
  return id;
}

export function trackRequestEnd(id: string): void {
  const req = activeRequests.get(id);
  if (!req) return;
  const durationMs = Date.now() - req.startTime;
  activeRequests.delete(id);
  if (durationMs >= SLOW_THRESHOLD_MS) {
    slowRequests.unshift({
      method: req.method,
      path: req.path,
      durationMs,
      finishedAt: Date.now(),
      query: req.query,
    });
    if (slowRequests.length > MAX_SLOW_REQUESTS) {
      slowRequests.length = MAX_SLOW_REQUESTS;
    }
  }
}

export function recordEventLoopBlock(delayMs: number): void {
  eventLoopBlockHistory.unshift({
    delayMs,
    timestamp: Date.now(),
  });
  if (eventLoopBlockHistory.length > MAX_BLOCK_HISTORY) {
    eventLoopBlockHistory.length = MAX_BLOCK_HISTORY;
  }
}

export function getDiagnosticsSnapshot() {
  const activeList = Array.from(activeRequests.values()).sort((a, b) => b.startTime - a.startTime);
  return {
    activeCount: activeList.length,
    poolNearFull: activeList.length >= POOL_NEAR_FULL,
    poolCapacity: 6,
    activeRequests: activeList.map(r => ({
      id: r.id,
      method: r.method,
      path: r.path,
      query: r.query,
      durationMs: Date.now() - r.startTime,
    })),
    slowRequests: slowRequests.slice(0, 10),
    eventLoopBlockHistory: eventLoopBlockHistory.slice(0, 20),
    serverTimestamp: Date.now(),
  };
}
