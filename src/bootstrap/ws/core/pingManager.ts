import { WebSocket } from 'ws';
import { LogService } from '../../../services/logService.ts';

export type WsPingType = 'private' | 'business';

const PONG_WAIT_MS = 20000;

const pongWaitKey = (wsType: WsPingType, accountIdx: number): string => `${wsType}:${accountIdx}`;

export const startPingCore = (
  pingTimers: Record<number, NodeJS.Timeout>,
  businessPingTimers: Record<number, NodeJS.Timeout>,
  pongWaitTimers: Record<string, NodeJS.Timeout>,
  pingIntervalMs: number,
  ws: WebSocket,
  accountIdx: number,
  wsType: WsPingType
): void => {
  const timers = wsType === 'private' ? pingTimers : businessPingTimers;

  if (timers[accountIdx]) {
    clearInterval(timers[accountIdx]);
  }

  clearPongWaitCore(pongWaitTimers, accountIdx, wsType);

  timers[accountIdx] = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send('ping');
        const waitKey = pongWaitKey(wsType, accountIdx);
        if (pongWaitTimers[waitKey]) clearTimeout(pongWaitTimers[waitKey]);
        pongWaitTimers[waitKey] = setTimeout(() => {
          delete pongWaitTimers[waitKey];
          LogService.warn(`system_ws_${accountIdx}`, `心跳假死：账户 ${accountIdx} (${wsType}) ${PONG_WAIT_MS / 1000}s 内未收到 pong，主动断线重连`);
          ws.terminate();
        }, PONG_WAIT_MS);
      } catch {
      }
    }
  }, pingIntervalMs);
};

export const clearPongWaitCore = (
  pongWaitTimers: Record<string, NodeJS.Timeout>,
  accountIdx: number,
  wsType: WsPingType
): void => {
  const waitKey = pongWaitKey(wsType, accountIdx);
  if (pongWaitTimers[waitKey]) {
    clearTimeout(pongWaitTimers[waitKey]);
    delete pongWaitTimers[waitKey];
  }
};

export const stopPingCore = (
  pingTimers: Record<number, NodeJS.Timeout>,
  businessPingTimers: Record<number, NodeJS.Timeout>,
  pongWaitTimers: Record<string, NodeJS.Timeout>,
  accountIdx: number,
  wsType: WsPingType
): void => {
  const timers = wsType === 'private' ? pingTimers : businessPingTimers;

  if (timers[accountIdx]) {
    clearInterval(timers[accountIdx]);
    delete timers[accountIdx];
  }

  clearPongWaitCore(pongWaitTimers, accountIdx, wsType);
};
