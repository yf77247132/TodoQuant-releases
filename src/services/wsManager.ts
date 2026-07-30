import { WebSocket, WebSocketServer } from 'ws';
import { AccountMonitor } from './AccountMonitor.ts';
import { LogService } from './logService.ts';
import https from 'https';
import { calculateBackoffDelayCore } from '../bootstrap/ws/core/reconnectPolicy.ts';
import { startPingCore, stopPingCore } from '../bootstrap/ws/core/pingManager.ts';
import {
  handleDataMessageCore,
  sendLogCore,
  broadcastCore,
  notifyWsStatusCore
} from '../bootstrap/ws/core/messageHandlers.ts';
import {
  handleLoginInternalCore,
  handleLoginTimeoutInternalCore,
  clearLoginTimeoutCore
} from '../bootstrap/ws/core/loginHandlers.ts';
import { createOkxWsInternalCore } from '../bootstrap/ws/core/connectionFactory.ts';
import type { WSMessage } from '../types/wsTypes.ts';
import type { ExchangeAccount } from '../types/core.ts';

const WS_URLS = {
  private: "wss://ws.okx.com:8443/ws/v5/private",
  business: "wss://ws.okx.com:8443/ws/v5/business"
};

export const OKX_WS_ERROR_MAP: Record<string, string> = {
  "4001": "登录失败",
  "4002": "参数不合法",
  "4003": "登录账户多于100个",
  "4004": "空闲超时30秒",
  "4005": "写缓冲区满",
  "4006": "异常场景关闭",
  "4007": "API key已更新或删除，请重新连接",
  "4008": "总订阅频道数超限",
  "4009": "连接订阅频道数超限",
  "60009": "登录失败",
  "60024": "Passphrase不正确",
  "60032": "API Key不存在",
  "64008": "服务升级中"
};

const CRITICAL_LOGIN_ERROR_CODES = ['4001', '60009', '60024', '60032'];

const LOGIN_TIMEOUT_MS = 3000;

interface OKXWebSocketManagerConfig {
  wss: WebSocketServer;
  loadConfig: () => Record<string, unknown>;
}

export class OKXWebSocketManager {
  private activeWsClients: Record<number, WebSocket> = {};
  private activeBusinessWsClients: Record<number, WebSocket> = {};
  private wsConnectionStatus: Record<number, boolean> = {};
  private businessWsConnectionStatus: Record<number, boolean> = {};
  private wsLoginFailCount: Record<number, number> = {};
  private businessWsLoginFailCount: Record<number, number> = {};
  private wsPermanentlyStopped: Record<number, boolean> = {};
  private latestWsData: Record<number, Record<string, unknown>> = {};
  private globalTimeOffset = 0;
  private reconnectAttempts: Record<number, number> = {};
  private businessReconnectAttempts: Record<number, number> = {};
  private lastMessageTime: Record<number, { private: number; business: number }> = {};
  private readonly MAX_RECONNECT_ATTEMPTS = 20;
  private fakeConnCheckTimer: NodeJS.Timeout | null = null;
  private readonly FAKE_CONN_CHECK_MS = 60000;
  private readonly FAKE_CONN_TIMEOUT_MS = 90000;
  private reconnectTimers: Record<number, NodeJS.Timeout> = {};
  private businessReconnectTimers: Record<number, NodeJS.Timeout> = {};
  private loginTimeoutTimers: Record<number, NodeJS.Timeout> = {};
  private businessLoginTimeoutTimers: Record<number, NodeJS.Timeout> = {};
  private messageBuffer: Record<string, unknown>[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_INTERVAL_MS = 100;
  private pingTimers: Record<number, NodeJS.Timeout> = {};
  private businessPingTimers: Record<number, NodeJS.Timeout> = {};
  private readonly PING_INTERVAL_MS = 25000;
  private accountIdxToId: Record<number, string> = {};

  static instance: OKXWebSocketManager | null = null;

  constructor(private config: OKXWebSocketManagerConfig) {
    OKXWebSocketManager.instance = this;
    (globalThis as unknown as Record<string, unknown>).OKX_WS_MANAGER = this;
    this.startBatchTimer();
  }

  isPermanentlyStopped(accountIdx: number): boolean {
    return !!this.wsPermanentlyStopped[accountIdx];
  }

  private startBatchTimer() {
    if (this.batchTimer) return;
    this.batchTimer = setInterval(() => {
      this.flushMessageBuffer();
    }, this.BATCH_INTERVAL_MS);
  }

  private flushMessageBuffer() {
    if (this.messageBuffer.length === 0) return;
    if (this.messageBuffer.length > 50) {
      LogService.logKey('WS_MANAGER', 'system.ws.highLoad', { count: this.messageBuffer.length });
    }

    if (this.messageBuffer.length > 500) {
      const dropped = this.messageBuffer.length - 500;
      this.messageBuffer = this.messageBuffer.slice(-500);
      LogService.logKey('WS_MANAGER', 'system.ws.bufferOverflow', { dropped }, 'warn');
    }

    const payload = JSON.stringify({
      type: 'batch',
      messages: this.messageBuffer
    });

    let sent = 0;
    this.config.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
        sent++;
      }
    });
    this.messageBuffer = [];
  }

  private calculateBackoffDelay(attempt: number): number {
    return calculateBackoffDelayCore(attempt);
  }

  public getGlobalTimeOffset(): number {
    return this.globalTimeOffset;
  }

  async syncGlobalTime(): Promise<void> {
    try {
      const res = await Promise.race([
        new Promise<{code: string, data?: Array<{ts: string}>}>((resolve, reject) => {
          https.get("https://www.okx.com/api/v5/public/time", (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(e);
              }
            });
          }).on("error", reject);
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Global time sync timeout")), 5000)
        )
      ]);
      if (res.code === "0" && res.data?.[0]?.ts) {
        const serverTime = parseInt(res.data[0].ts);
        this.globalTimeOffset = serverTime - Date.now();
      }
    } catch (e) {
    }
  }

  async startAccountMonitoring(): Promise<void> {
    const config = this.config.loadConfig();
    const accounts = (config.accounts as ExchangeAccount[]) || [];

    this.accountIdxToId = {};
    accounts.forEach((acc, idx) => {
      if (acc.id) this.accountIdxToId[idx] = acc.id;
    });

    const exchangeGroups: Map<string, Array<{ idx: number; acc: ExchangeAccount }>> = new Map();
    accounts.forEach((acc, idx) => {
      const exchange = String(acc.exchange || '').toUpperCase();
      if (!exchangeGroups.has(exchange)) exchangeGroups.set(exchange, []);
      exchangeGroups.get(exchange)!.push({ idx, acc });
    });

    LogService.logKey('SYSTEM', 'system.monitoring.start', {
      count: accounts.length,
      groups: exchangeGroups.size,
    });

    const groupTasks = Array.from(exchangeGroups.entries()).map(async ([exchange, groupAccounts]) => {
      for (const { idx, acc } of groupAccounts) {
        const account = acc as Record<string, unknown>;
        const isDecryptionFailed = account._decryptionFailed === true;
        const hasBasicCerts = acc.apiKey && acc.secretKey;
        const hasOkxCerts = exchange === 'OKX' ? !!acc.passphrase : true;

        if (!isDecryptionFailed && hasBasicCerts && hasOkxCerts) {
          try {
            await AccountMonitor.getInstance().startMonitoring(idx);
          } catch (err) {
            const label = acc.name || ('#' + idx);
            LogService.logKey('SYSTEM', 'system.ws.monitorStartFailed', { idx, label, msg: String(err) }, 'error');
          }

          if (exchange === 'OKX') {
            this.createOkxWs(acc.apiKey, acc.secretKey, acc.passphrase, idx);
            this.createOkxBusinessWs(acc.apiKey, acc.secretKey, acc.passphrase, idx);
          } else {
            this.wsConnectionStatus[idx] = true;
            this.businessWsConnectionStatus[idx] = true;
            this.notifyWsStatus(idx, true);
          }
        } else {
          const reason = isDecryptionFailed ? '解密失败' : '凭证不全';
          const label = acc.name || ('#' + idx);
          LogService.logKey('INIT', 'system.ws.monitorSkipped', { idx, label, exchange, reason }, 'warn');
          this.wsConnectionStatus[idx] = false;
          this.businessWsConnectionStatus[idx] = false;
          this.notifyWsStatus(idx, false);
        }
      }
    });

    await Promise.all(groupTasks).catch(err => {
      LogService.logKey('SYSTEM', 'system.ws.startException', { msg: String(err) }, 'error');
    });

    this.startBatchTimer();

    this.startFakeConnectionCheck();
  }

  private startPing(ws: WebSocket, accountIdx: number, wsType: 'private' | 'business'): void {
    startPingCore(this.pingTimers, this.businessPingTimers, this.PING_INTERVAL_MS, ws, accountIdx, wsType);
  }

  private stopPing(accountIdx: number, wsType: 'private' | 'business'): void {
    stopPingCore(this.pingTimers, this.businessPingTimers, accountIdx, wsType);
  }

  private startFakeConnectionCheck(): void {
    if (this.fakeConnCheckTimer) return;
    this.fakeConnCheckTimer = setInterval(() => {
      const now = Date.now();
      Object.keys(this.wsConnectionStatus).forEach(key => {
        const idx = Number(key);
        if (!this.wsConnectionStatus[idx]) return;
        const last = this.lastMessageTime[idx]?.private || 0;
        if (last > 0 && (now - last) > this.FAKE_CONN_TIMEOUT_MS) {
          LogService.warn(`system_ws_${idx}`, 
            `假连接检测：账户 ${idx} 已 ${Math.round((now - last) / 1000)}s 无业务消息，主动断线重连`
          );
          if (this.activeWsClients[idx]) {
            this.activeWsClients[idx].close(4000, 'fake connection detected');
          }
        }
      });
    }, this.FAKE_CONN_CHECK_MS);
  }

  private cleanupConnection(accountIdx: number): void {
    const ws = this.activeWsClients[accountIdx];
    if (ws) {
      this.stopPing(accountIdx, 'private');
      this.clearLoginTimeout(accountIdx);
      if (this.reconnectTimers[accountIdx]) {
        clearTimeout(this.reconnectTimers[accountIdx]);
        delete this.reconnectTimers[accountIdx];
      }
      ws.removeAllListeners();
      try {
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.terminate();
        }
      } catch (e) {
      }
      delete this.activeWsClients[accountIdx];
    }

    const bws = this.activeBusinessWsClients[accountIdx];
    if (bws) {
      this.stopPing(accountIdx, 'business');
      this.clearBusinessLoginTimeout(accountIdx);
      if (this.businessReconnectTimers[accountIdx]) {
        clearTimeout(this.businessReconnectTimers[accountIdx]);
        delete this.businessReconnectTimers[accountIdx];
      }
      bws.removeAllListeners();
      try {
        if (bws.readyState !== WebSocket.CLOSED) {
          bws.terminate();
        }
      } catch (e) {
      }
      delete this.activeBusinessWsClients[accountIdx];
    }

    delete this.wsConnectionStatus[accountIdx];
    delete this.businessWsConnectionStatus[accountIdx];
    delete this.wsLoginFailCount[accountIdx];
    delete this.businessWsLoginFailCount[accountIdx];
    delete this.wsPermanentlyStopped[accountIdx];
    delete this.reconnectAttempts[accountIdx];
    delete this.businessReconnectAttempts[accountIdx];
  }

  stopAll(): void {
    const allAccountIdxs = new Set([
      ...Object.keys(this.activeWsClients),
      ...Object.keys(this.activeBusinessWsClients)
    ].map(Number));

    allAccountIdxs.forEach(accountIdx => {
      this.cleanupConnection(accountIdx);
    });

    this.activeWsClients = {};
    this.activeBusinessWsClients = {};
    this.wsConnectionStatus = {};
    this.businessWsConnectionStatus = {};
    this.wsLoginFailCount = {};
    this.businessWsLoginFailCount = {};
    this.wsPermanentlyStopped = {};
    this.reconnectAttempts = {};
    this.latestWsData = {};
    this.accountIdxToId = {};
    this.messageBuffer = [];

    if (this.batchTimer) { clearInterval(this.batchTimer); this.batchTimer = null; }
    if (this.fakeConnCheckTimer) { clearInterval(this.fakeConnCheckTimer); this.fakeConnCheckTimer = null; }
  }

  getConnectionStatus(): Record<number, boolean> {
    return { ...this.wsConnectionStatus };
  }

  getBusinessWsConnectionStatus(): Record<number, boolean> {
    return { ...this.businessWsConnectionStatus };
  }

  getLatestWsData(): Record<number, Record<string, unknown>> {
    return { ...this.latestWsData };
  }

  permanentlyStop(accountIdx: number): void {
    this.wsPermanentlyStopped[accountIdx] = true;

    const ws = this.activeWsClients[accountIdx];
    if (ws) {
      ws.removeAllListeners('close');
      ws.on('error', () => {});
      ws.terminate();
      delete this.activeWsClients[accountIdx];
    }
    this.stopPing(accountIdx, 'private');

    const businessWs = this.activeBusinessWsClients[accountIdx];
    if (businessWs) {
      businessWs.removeAllListeners('close');
      businessWs.on('error', () => {});
      businessWs.terminate();
      delete this.activeBusinessWsClients[accountIdx];
    }
    this.stopPing(accountIdx, 'business');

    if (this.reconnectTimers[accountIdx]) {
      clearTimeout(this.reconnectTimers[accountIdx]);
      delete this.reconnectTimers[accountIdx];
    }
    this.clearLoginTimeout(accountIdx);
    if (this.businessReconnectTimers[accountIdx]) {
      clearTimeout(this.businessReconnectTimers[accountIdx]);
      delete this.businessReconnectTimers[accountIdx];
    }
    this.clearBusinessLoginTimeout(accountIdx);

    const monitor = AccountMonitor.getInstance();
    monitor.stopMonitoring(accountIdx);
  }

  resetPermanentlyStopped(accountIdx: number): void {
    delete this.wsPermanentlyStopped[accountIdx];
    delete this.wsLoginFailCount[accountIdx];
    delete this.businessWsLoginFailCount[accountIdx];
    delete this.reconnectAttempts[accountIdx];
    delete this.businessReconnectAttempts[accountIdx];
  }

  private createOkxWs(apiKey: string | undefined, secretKey: string | undefined, passphrase: string | undefined, accountIdx: number): void {
    this.createOkxWsInternal(
      WS_URLS.private,
      apiKey,
      secretKey,
      passphrase,
      accountIdx,
      'private',
      (okxWs) => {
        const subscribeMsg = JSON.stringify({
          op: "subscribe",
          args: [
            { channel: "account", instType: "ANY" },
            { channel: "positions", instType: "ANY" },
            { channel: "orders", instType: "ANY" }
          ]
        });
        okxWs.send(subscribeMsg);
      },
      this.wsConnectionStatus,
      this.wsLoginFailCount,
      this.reconnectAttempts,
      this.reconnectTimers,
      this.loginTimeoutTimers,
      this.activeWsClients,
      this.clearLoginTimeout.bind(this)
    );
  }

  private createOkxBusinessWs(apiKey: string | undefined, secretKey: string | undefined, passphrase: string | undefined, accountIdx: number): void {
    this.createOkxWsInternal(
      WS_URLS.business,
      apiKey,
      secretKey,
      passphrase,
      accountIdx,
      'business',
      (okxWs) => {
        const subscribeMsg = JSON.stringify({
          op: "subscribe",
          args: [
            { channel: "orders-algo", instType: "ANY" },
            { channel: "algo-advance", instType: "ANY" }
          ]
        });
        okxWs.send(subscribeMsg);
      },
      this.businessWsConnectionStatus,
      this.businessWsLoginFailCount,
      this.businessReconnectAttempts,
      this.businessReconnectTimers,
      this.businessLoginTimeoutTimers,
      this.activeBusinessWsClients,
      this.clearBusinessLoginTimeout.bind(this)
    );
  }

  private createOkxWsInternal(
    url: string,
    apiKey: string | undefined,
    secretKey: string | undefined,
    passphrase: string | undefined,
    accountIdx: number,
    wsType: 'private' | 'business',
    onLoginSuccess: (ws: WebSocket) => void,
    connectionStatus: Record<number, boolean>,
    loginFailCount: Record<number, number>,
    reconnectAttempts: Record<number, number>,
    reconnectTimers: Record<number, NodeJS.Timeout>,
    loginTimeoutTimers: Record<number, NodeJS.Timeout>,
    activeClients: Record<number, WebSocket>,
    clearLoginTimeout: (accountIdx: number) => void
  ): void {
    createOkxWsInternalCore({
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
      notifyWsStatus: this.notifyWsStatus.bind(this),
      stopPing: this.stopPing.bind(this),
      handleLoginInternal: this.handleLoginInternal.bind(this),
      handleLoginTimeoutInternal: this.handleLoginTimeoutInternal.bind(this),
      handleDataMessage: wsType === 'business'
        ? this.handleBusinessDataMessage.bind(this)
        : this.handleDataMessage.bind(this),
      calculateBackoffDelay: this.calculateBackoffDelay.bind(this),
      permanentlyStop: this.permanentlyStop.bind(this),
      isPermanentlyStopped: (idx) => !!this.wsPermanentlyStopped[idx],
      reconnectByType: (nextType, nextApiKey, nextSecretKey, nextPassphrase, idx) => {
        if (nextType === 'private') {
          this.createOkxWs(nextApiKey, nextSecretKey, nextPassphrase, idx);
        } else {
          this.createOkxBusinessWs(nextApiKey, nextSecretKey, nextPassphrase, idx);
        }
      },
      loginTimeoutMs: LOGIN_TIMEOUT_MS,
      getLoginTimestamp: () => Math.floor((Date.now() + this.globalTimeOffset) / 1000).toString(),
      maxReconnectAttempts: this.MAX_RECONNECT_ATTEMPTS,
    });
  }
  private handleLoginInternal(
    message: WSMessage,
    accountIdx: number,
    okxWs: WebSocket,
    wsType: 'private' | 'business',
    passphrase: string,
    onLoginSuccess: (ws: WebSocket) => void,
    connectionStatus: Record<number, boolean>,
    loginFailCount: Record<number, number>,
    reconnectAttempts: Record<number, number>,
    clearLoginTimeout: (accountIdx: number) => void
  ): void {
    handleLoginInternalCore({
      message,
      accountIdx,
      okxWs,
      wsType,
      passphrase,
      connectionStatus,
      loginFailCount,
      reconnectAttempts,
      clearLoginTimeout,
      notifyWsStatus: this.notifyWsStatus.bind(this),
      startPing: this.startPing.bind(this),
      onLoginSuccess,
      permanentlyStop: this.permanentlyStop.bind(this),
      okxWsErrorMap: OKX_WS_ERROR_MAP,
      criticalLoginErrorCodes: CRITICAL_LOGIN_ERROR_CODES
    });
  }
  private handleLoginTimeoutInternal(
    accountIdx: number,
    okxWs: WebSocket,
    wsType: 'private' | 'business',
    loginFailCount: Record<number, number>
  ): void {
    handleLoginTimeoutInternalCore({
      accountIdx,
      okxWs,
      wsType,
      loginFailCount,
      loginTimeoutMs: LOGIN_TIMEOUT_MS,
      permanentlyStop: this.permanentlyStop.bind(this)
    });
  }
  private clearLoginTimeout(accountIdx: number): void {
    clearLoginTimeoutCore(this.loginTimeoutTimers, accountIdx);
  }

  private clearBusinessLoginTimeout(accountIdx: number): void {
    clearLoginTimeoutCore(this.businessLoginTimeoutTimers, accountIdx);
  }

  private handleDataMessage(message: WSMessage, accountIdx: number): void {
    if (!this.lastMessageTime[accountIdx]) {
      this.lastMessageTime[accountIdx] = { private: 0, business: 0 };
    }
    this.lastMessageTime[accountIdx].private = Date.now();
    handleDataMessageCore(this.latestWsData as Record<number, Record<string, unknown>>, this.messageBuffer, message, accountIdx, this.accountIdxToId[accountIdx]);
  }

  private handleBusinessDataMessage(message: WSMessage, accountIdx: number): void {
    if (!this.lastMessageTime[accountIdx]) {
      this.lastMessageTime[accountIdx] = { private: 0, business: 0 };
    }
    this.lastMessageTime[accountIdx].business = Date.now();
    handleDataMessageCore(this.latestWsData as Record<number, Record<string, unknown>>, this.messageBuffer, message, accountIdx, this.accountIdxToId[accountIdx]);
  }

  public sendLog(logEntry: Record<string, unknown>): void {
    sendLogCore(this.messageBuffer, logEntry);
  }

  public broadcast(payload: Record<string, unknown>): void {
    broadcastCore(this.messageBuffer, payload);
  }

  public getAccountId(accountIdx: number): string | undefined {
    return this.accountIdxToId[accountIdx];
  }

  private notifyWsStatus(accountIdx: number, connected: boolean, status?: string): void {
    notifyWsStatusCore(this.messageBuffer, accountIdx, connected, status);
  }

  markAllPendingReconnect(): void {
    const allAccountIdxs = new Set([
      ...Object.keys(this.activeWsClients),
      ...Object.keys(this.activeBusinessWsClients)
    ].map(Number));

    for (const accountIdx of allAccountIdxs) {
      this.wsConnectionStatus[accountIdx] = false;
      this.businessWsConnectionStatus[accountIdx] = false;
      this.notifyWsStatus(accountIdx, false, 'pending_reconnect');
    }

    LogService.logKey('SYSTEM', 'ws.reconnect.marked', { count: allAccountIdxs.size });
  }

  forceCloseAll(): void {
    const allAccountIdxs = new Set([
      ...Object.keys(this.activeWsClients),
      ...Object.keys(this.activeBusinessWsClients)
    ].map(Number));

    for (const accountIdx of allAccountIdxs) {
      this.cleanupConnection(accountIdx);
    }

    LogService.logKey('SYSTEM', 'ws.reconnect.forceClosed', { count: allAccountIdxs.size });
  }

  async reconnectAll(): Promise<void> {
    const config = this.config.loadConfig();
    const accounts = (config.accounts as ExchangeAccount[]) || [];

    LogService.logKey('SYSTEM', 'ws.reconnect.starting', { count: accounts.length });

    for (let idx = 0; idx < accounts.length; idx++) {
      const acc = accounts[idx];
      if (this.wsPermanentlyStopped[idx]) {
        continue;
      }

      const exchange = String(acc.exchange || '').toUpperCase();
      const hasBasicCerts = acc.apiKey && acc.secretKey;
      const hasOkxCerts = exchange === 'OKX' ? !!acc.passphrase : true;

      if (!hasBasicCerts || !hasOkxCerts) {
        continue;
      }

      if (exchange === 'OKX') {
        this.createOkxWs(acc.apiKey, acc.secretKey, acc.passphrase, idx);
        this.createOkxBusinessWs(acc.apiKey, acc.secretKey, acc.passphrase, idx);
      }
    }

    LogService.logKey('SYSTEM', 'ws.reconnect.requested', {});
  }
}
