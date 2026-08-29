import { WebSocket } from 'ws';

export type WsPingType = 'private' | 'business';

export const startPingCore = (
  pingTimers: Record<number, NodeJS.Timeout>,
  businessPingTimers: Record<number, NodeJS.Timeout>,
  pingIntervalMs: number,
  ws: WebSocket,
  accountIdx: number,
  wsType: WsPingType
): void => {
  const timers = wsType === 'private' ? pingTimers : businessPingTimers;

  if (timers[accountIdx]) {
    clearInterval(timers[accountIdx]);
  }

  timers[accountIdx] = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send('ping');
      } catch {
      }
    }
  }, pingIntervalMs);
};

export const stopPingCore = (
  pingTimers: Record<number, NodeJS.Timeout>,
  businessPingTimers: Record<number, NodeJS.Timeout>,
  accountIdx: number,
  wsType: WsPingType
): void => {
  const timers = wsType === 'private' ? pingTimers : businessPingTimers;

  if (timers[accountIdx]) {
    clearInterval(timers[accountIdx]);
    delete timers[accountIdx];
  }
};
