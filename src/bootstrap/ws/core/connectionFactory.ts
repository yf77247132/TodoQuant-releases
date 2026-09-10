import { WebSocket } from 'ws';
import crypto from 'crypto';
import { LogService } from '../../../services/logService.ts';
import { ErrorMonitor } from '../../../services/errorMonitor.ts';
import { clearPongWaitCore } from './pingManager.ts';
import type { WSMessage } from '../../../types/wsTypes.ts';

let wsDisconnectCooldownUntil = 0;
let wsErrorCooldownUntil = 0;
const WS_COOLDOWN_MS = 3000;
function shouldLogWsDisconnect(): boolean {
  const now = Date.now();
  if (now < wsDisconnectCooldownUntil) return false;
  wsDisconnectCooldownUntil = now + WS_COOLDOWN_MS;
  return true;
}
function shouldLogWsError(): boolean {
  const now = Date.now();
  if (now < wsErrorCooldownUntil) return false;
  wsErrorCooldownUntil = now + WS_COOLDOWN_MS;
  return true;
}

interface CreateOkxWsInternalParams {
  url: string;
  apiKey: string | undefined;
  secretKey: string | undefined;
  passphrase: string | undefined;
  accountIdx: number;
  wsType: 'private' | 'business';
  onLoginSuccess: (ws: WebSocket) => void;
  connectionStatus: Record<number, boolean>;
  loginFailCount: Record<number, number>;
  reconnectAttempts: Record<number, number>;
  reconnectTimers: Record<number, NodeJS.Timeout>;
  loginTimeoutTimers: Record<number, NodeJS.Timeout>;
  activeClients: Record<number, WebSocket>;
  clearLoginTimeout: (accountIdx: number) => void;
  pongWaitTimers: Record<string, NodeJS.Timeout>;
  notifyWsStatus: (accountIdx: number, connected: boolean, status?: string) => void;
  stopPing: (accountIdx: number, wsType: 'private' | 'business') => void;
  handleLoginInternal: (message: WSMessage, accountIdx: number, okxWs: WebSocket, wsType: 'private' | 'business', passphrase: string, onLoginSuccess: (ws: WebSocket) => void, connectionStatus: Record<number, boolean>, loginFailCount: Record<number, number>, reconnectAttempts: Record<number, number>, clearLoginTimeout: (accountIdx: number) => void) => void;
  handleLoginTimeoutInternal: (accountIdx: number, okxWs: WebSocket, wsType: 'private' | 'business', loginFailCount: Record<number, number>) => void;
  handleDataMessage: (message: WSMessage, accountIdx: number) => void;
  calculateBackoffDelay: (attempt: number) => number;
  permanentlyStop: (accountIdx: number) => void;
  isPermanentlyStopped: (accountIdx: number) => boolean;
  reconnectByType: (
    wsType: 'private' | 'business',
    apiKey: string,
    secretKey: string,
    passphrase: string,
    accountIdx: number
  ) => void;
  loginTimeoutMs: number;
  getLoginTimestamp: () => string;
  maxReconnectAttempts: number;
}

export const createOkxWsInternalCore = (params: CreateOkxWsInternalParams): void => {
  const {
    url,
    apiKey,
    secretKey,
    passphrase,
    accountIdx,
    wsType,
    onLoginSuccess,
    connectionStatus,
    loginFailCount,
    reconnectAttempts,
    reconnectTimers,
    loginTimeoutTimers,
    activeClients,
    clearLoginTimeout,
    pongWaitTimers,
    notifyWsStatus,
    stopPing,
    handleLoginInternal,
    handleLoginTimeoutInternal,
    handleDataMessage,
    calculateBackoffDelay,
    permanentlyStop,
    isPermanentlyStopped,
    reconnectByType,
    loginTimeoutMs,
    getLoginTimestamp,
    maxReconnectAttempts,
  } = params;

  if (isPermanentlyStopped(accountIdx)) {
    return;
  }
  if (!apiKey || !secretKey || !passphrase) return;

  if (apiKey.length < 16) {
    return;
  }

  if (activeClients[accountIdx]) {
    activeClients[accountIdx].removeAllListeners('close');
    activeClients[accountIdx].on('error', () => {});
    activeClients[accountIdx].terminate();
    delete activeClients[accountIdx];
  }

  const okxWs = new WebSocket(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });

  activeClients[accountIdx] = okxWs;

  let loginAwaited = false;

  const sign = (timestamp: string, method: string, requestPath: string, body = '') => {
    const message = timestamp + method + requestPath + body;
    return crypto.createHmac('sha256', secretKey!).update(message).digest('base64');
  };

  okxWs.on('open', () => {
    notifyWsStatus(accountIdx, false, 'logging_in');

    const prevAttempts = reconnectAttempts[accountIdx] || 0;
    delete reconnectAttempts[accountIdx];
    if (prevAttempts > 0) {
      LogService.logKey(`system_ws_${accountIdx}`, 'ws.connect.restored', { wsType, attempts: prevAttempts });
    }

    const timestamp = getLoginTimestamp();
    const signature = sign(timestamp, 'GET', '/users/self/verify');
    const loginMsg = { op: 'login', args: [{ apiKey, passphrase, timestamp, sign: signature }] };

    okxWs.send(JSON.stringify(loginMsg));
    loginAwaited = true;

    clearLoginTimeout(accountIdx);
    loginTimeoutTimers[accountIdx] = setTimeout(() => {
      handleLoginTimeoutInternal(accountIdx, okxWs, wsType, loginFailCount);
    }, loginTimeoutMs);
  });

  okxWs.on('message', (data) => {
    const raw = data.toString();

    if (raw === 'pong') {
      clearPongWaitCore(pongWaitTimers, accountIdx, wsType);
      return;
    }

    try {
      const message = JSON.parse(raw) as WSMessage;

      if (message.event === 'login') {
        loginAwaited = false;
        handleLoginInternal(
          message,
          accountIdx,
          okxWs,
          wsType,
          passphrase,
          onLoginSuccess,
          connectionStatus,
          loginFailCount,
          reconnectAttempts,
          clearLoginTimeout
        );
      } else if (message.event === 'error') {
        if (message.code && loginAwaited) {
          loginAwaited = false;
          handleLoginInternal(
            message,
            accountIdx,
            okxWs,
            wsType,
            passphrase,
            onLoginSuccess,
            connectionStatus,
            loginFailCount,
            reconnectAttempts,
            clearLoginTimeout
          );
        } else if (shouldLogWsError()) {
          LogService.logKey(
            `system_ws_${accountIdx}`,
            'ws.session.error',
            { wsType, code: Number(message.code) || 0, msg: message.msg || '' },
            'warn'
          );
        }
      } else if (message.arg && message.data) {
        handleDataMessage(message, accountIdx);
      }
    } catch {
    }
  });

  okxWs.on('error', (e) => {
    const errorMsg = (e as Error).message || String(e);

    if (
      errorMsg.includes('WebSocket closed without opened') ||
      errorMsg.includes('WebSocket was closed before the connection was established') ||
      errorMsg.includes('Client network socket disconnected before secure TLS connection was established') ||
      errorMsg.includes('ECONNRESET') ||
      errorMsg.includes('ETIMEDOUT')
    ) {
      ErrorMonitor.captureNetworkError(
        e as Error,
        { accountIdx, type: `websocket_${wsType}` },
        'wsManager'
      );
      return;
    }

    if (shouldLogWsError()) {
      LogService.logKey(`system_ws_${accountIdx}`, 'ws.connect.error', { wsType, msg: errorMsg }, 'error');
      ErrorMonitor.captureNetworkError(
        e as Error,
        {
          accountIdx,
          type: `websocket_${wsType}`,
          wsUrl: url,
        },
        'wsManager'
      );
    }
  });

  okxWs.on('close', (code, reason) => {
    connectionStatus[accountIdx] = false;
    notifyWsStatus(accountIdx, false);

    stopPing(accountIdx, wsType);

    if (reconnectTimers[accountIdx]) {
      clearTimeout(reconnectTimers[accountIdx]);
      delete reconnectTimers[accountIdx];
    }
    clearLoginTimeout(accountIdx);

    if (code === 4001) {
      loginFailCount[accountIdx] = (loginFailCount[accountIdx] || 0) + 1;
      if (loginFailCount[accountIdx] >= 3) {
        permanentlyStop(accountIdx);
        LogService.logKey(`system_ws_${accountIdx}`, 'ws.login.maxRetries', { wsType, code: 4001, desc: '登录失败' }, 'error');
        return;
      }
      LogService.logKey(`system_ws_${accountIdx}`, 'ws.login.retry', { wsType, code: 4001, desc: '登录失败', current: loginFailCount[accountIdx], max: 3 }, 'error');
    }

    if (isPermanentlyStopped(accountIdx)) {
      return;
    }

    if (!apiKey || !secretKey || !passphrase) {
      return;
    }

    reconnectAttempts[accountIdx] = (reconnectAttempts[accountIdx] || 0) + 1;
    const attempt = reconnectAttempts[accountIdx];

    if (attempt > maxReconnectAttempts) {
      permanentlyStop(accountIdx);
      LogService.logKey(
        `system_ws_${accountIdx}`,
        'ws.reconnect.maxAttempts', { wsType, max: maxReconnectAttempts }, 'error'
      );
      return;
    }

    const backoffDelay = calculateBackoffDelay(attempt);

    if (code !== 4001 && shouldLogWsDisconnect()) {
      const reasonStr = reason ? reason.toString('utf8') : '';
      LogService.logKey(
        `system_ws_${accountIdx}`,
        'ws.disconnected',
        { wsType, code: code || 0, reason: reasonStr, delay: Math.round(backoffDelay / 100) / 10, attempt, max: maxReconnectAttempts },
        'warn'
      );
    }

    reconnectTimers[accountIdx] = setTimeout(() => {
      delete reconnectTimers[accountIdx];
      if (!isPermanentlyStopped(accountIdx) && apiKey && secretKey && passphrase) {
        reconnectByType(wsType, apiKey, secretKey, passphrase, accountIdx);
      }
    }, backoffDelay);
  });
};
