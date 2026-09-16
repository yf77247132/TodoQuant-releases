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
    if (ws.readyState !== WebSocket.OPEN) {
      LogService.warn(
        `system_ws_${accountIdx}`,
        `心跳异常：账户 ${accountIdx} (${wsType}) 连接非 OPEN（readyState=${ws.readyState}），主动断线重连`
      );
      clearPongWaitCore(pongWaitTimers, accountIdx, wsType);
      try { ws.terminate(); } catch {  }
      return;
    }

    try {
      ws.send('ping');
      const waitKey = pongWaitKey(wsType, accountIdx);
      if (pongWaitTimers[waitKey]) clearTimeout(pongWaitTimers[waitKey]);
      pongWaitTimers[waitKey] = setTimeout(() => {
        delete pongWaitTimers[waitKey];
        LogService.warn(`system_ws_${accountIdx}`, `心跳假死：账户 ${accountIdx} (${wsType}) ${PONG_WAIT_MS / 1000}s 内未收到 pong，主动断线重连`);
        ws.terminate();
      }, PONG_WAIT_MS);
    } catch (e) {
      LogService.warn(
        `system_ws_${accountIdx}`,
        `心跳发送失败：账户 ${accountIdx} (${wsType}) send('ping') 异常（${(e as Error)?.message || String(e)}），主动断线重连`
      );
      clearPongWaitCore(pongWaitTimers, accountIdx, wsType);
      try { ws.terminate(); } catch {  }
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
