import { WebSocket } from 'ws';
import { LogService } from '../../../services/logService.ts';
import type { WSMessage } from '../../../types/wsTypes.ts';

interface HandleLoginInternalParams {
  message: WSMessage;
  accountIdx: number;
  okxWs: WebSocket;
  wsType: 'private' | 'business';
  passphrase: string;
  connectionStatus: Record<number, boolean>;
  loginFailCount: Record<number, number>;
  reconnectAttempts: Record<number, number>;
  clearLoginTimeout: (accountIdx: number) => void;
  notifyWsStatus: (accountIdx: number, connected: boolean, status?: string) => void;
  startPing: (ws: WebSocket, accountIdx: number, wsType: 'private' | 'business') => void;
  onLoginSuccess: (ws: WebSocket) => void;
  permanentlyStop: (accountIdx: number) => void;
  okxWsErrorMap: Record<string, string>;
  criticalLoginErrorCodes: string[];
}

export const handleLoginInternalCore = (params: HandleLoginInternalParams): void => {
  const {
    message,
    accountIdx,
    okxWs,
    wsType,
    passphrase,
    connectionStatus,
    loginFailCount,
    reconnectAttempts,
    clearLoginTimeout,
    notifyWsStatus,
    startPing,
    onLoginSuccess,
    permanentlyStop,
    okxWsErrorMap,
    criticalLoginErrorCodes,
  } = params;

  clearLoginTimeout(accountIdx);

  if (message.code === '0') {
    connectionStatus[accountIdx] = true;
    loginFailCount[accountIdx] = 0;

    const prevAttempts = reconnectAttempts[accountIdx] || 0;
    delete reconnectAttempts[accountIdx];

    if (prevAttempts > 0) {
      LogService.logKey(`system_ws_${accountIdx}`, 'ws.connect.restored', { wsType, attempts: prevAttempts });
    }

    notifyWsStatus(accountIdx, true);
    startPing(okxWs, accountIdx, wsType);
    onLoginSuccess(okxWs);

    const ordersCache = globalThis.ORDERS_CACHE;
    if (ordersCache) {
      ordersCache.refreshNow().catch(() => {});
    }
    return;
  }

  const errorCode = message.code;
  const errorRawMsg = message.msg || '';

  const dedupKey = `ws_login_err:${accountIdx}:${wsType}:${errorCode}`;
  const _dedupCache = (globalThis as unknown as Record<string, Map<string, number>>).__WS_LOGIN_ERR_DEDUP__ || ((globalThis as unknown as Record<string, Map<string, number>>).__WS_LOGIN_ERR_DEDUP__ = new Map<string, number>());
  const now = Date.now();
  const lastDedup = _dedupCache.get(dedupKey);
  const shouldReport = !lastDedup || (now - lastDedup) > 60000;
  if (shouldReport) {
    _dedupCache.set(dedupKey, now);
  }

  if (errorCode === '60024' || (message.msg && message.msg.includes('Passphrase incorrect'))) {
    if (shouldReport) {
      const pass = passphrase || '';
      const passInfo = pass.length > 0 ? `${pass.length}位` : '为空';
      LogService.logKey(`system_ws_${accountIdx}`, 'ws.auth.passphrase', { wsType, passInfo }, 'error');
    }
  }

  connectionStatus[accountIdx] = false;
  loginFailCount[accountIdx] = (loginFailCount[accountIdx] || 0) + 1;
  notifyWsStatus(accountIdx, false);

  const isCriticalError = criticalLoginErrorCodes.includes(errorCode);

  if (isCriticalError) {
    if (loginFailCount[accountIdx] >= 3) {
      permanentlyStop(accountIdx);
      LogService.logKey(`system_ws_${accountIdx}`, 'ws.login.maxRetries', { wsType, code: Number(errorCode) || 0, msg: errorRawMsg }, 'error');
    } else if (shouldReport) {
      LogService.logKey(`system_ws_${accountIdx}`, 'ws.login.retry', { wsType, code: Number(errorCode) || 0, msg: errorRawMsg, current: loginFailCount[accountIdx], max: 3 }, 'error');
    }
  } else if (shouldReport) {
    LogService.logKey(`system_ws_${accountIdx}`, 'ws.connect.exception', { wsType, code: Number(errorCode) || 0, msg: errorRawMsg }, 'error');
  }
};

interface HandleLoginTimeoutParams {
  accountIdx: number;
  okxWs: WebSocket;
  wsType: 'private' | 'business';
  loginFailCount: Record<number, number>;
  loginTimeoutMs: number;
  permanentlyStop: (accountIdx: number) => void;
}

export const handleLoginTimeoutInternalCore = (params: HandleLoginTimeoutParams): void => {
  const { accountIdx, okxWs, wsType, loginFailCount, loginTimeoutMs, permanentlyStop } = params;

  loginFailCount[accountIdx] = (loginFailCount[accountIdx] || 0) + 1;
  LogService.logKey(`system_ws_${accountIdx}`, 'ws.login.timeout', { wsType, timeout: loginTimeoutMs / 1000, current: loginFailCount[accountIdx], max: 3 }, 'warn');

  if (loginFailCount[accountIdx] >= 3) {
    permanentlyStop(accountIdx);
    LogService.logKey(`system_ws_${accountIdx}`, 'ws.login.timeout.maxRetries', { wsType }, 'error');
    return;
  }

  try {
    if (okxWs.readyState === WebSocket.OPEN || okxWs.readyState === WebSocket.CONNECTING) {
      okxWs.close(4000, 'login_timeout');
    }
  } catch {
    try {
      okxWs.terminate();
    } catch {
    }
  }
};

export const clearLoginTimeoutCore = (
  loginTimeoutTimers: Record<number, NodeJS.Timeout>,
  accountIdx: number
): void => {
  if (loginTimeoutTimers[accountIdx]) {
    clearTimeout(loginTimeoutTimers[accountIdx]);
    delete loginTimeoutTimers[accountIdx];
  }
};
