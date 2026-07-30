
import { LogService } from "./logService.ts";
import { OKXWebSocketManager } from "./wsManager.ts";
import { loadSavedConfig } from "./configService.ts";
import { Exchange } from "../types/core.ts";
import { ftProcessManager } from "../freqtrade/ftProcessManager.ts";

type PowerMonitorMessage = { type: 'SYSTEM_SUSPEND' } | { type: 'SYSTEM_RESUME' } | { type: 'SHUTDOWN_FT' };

let isInitialized = false;
let isReconnecting = false;

function getOrdersCache(): { refreshNow: () => Promise<void> } | null {
  return (globalThis as any).ORDERS_CACHE || null;
}

function handleSystemSuspend(): void {
  LogService.logKey('SYSTEM', 'system.power.suspend', {});

  const wsManager = OKXWebSocketManager.instance;
  if (wsManager) {
    wsManager.markAllPendingReconnect();
  }
}

async function handleSystemResume(): Promise<void> {
  if (isReconnecting) {
    LogService.logKey('SYSTEM', 'system.power.resume.duplicate', {});
    return;
  }

  isReconnecting = true;
  LogService.logKey('SYSTEM', 'system.power.resume.start', {});

  try {
    const wsManager = OKXWebSocketManager.instance;
    if (!wsManager) {
      LogService.logKey('SYSTEM', 'system.power.resume.noWsManager', {});
      return;
    }

    wsManager.forceCloseAll();

    LogService.logKey('SYSTEM', 'system.power.resume.waitNetwork', {});
    await new Promise(resolve => setTimeout(resolve, 2000));

    LogService.logKey('SYSTEM', 'system.power.resume.syncTime', {});
    await wsManager.syncGlobalTime();

    const config = loadSavedConfig();
    const accounts = (config.accounts as any[]) || [];

    for (const acc of accounts) {
      const exchange = String(acc.exchange || '').toUpperCase();
      if (exchange === Exchange.OKX && acc.apiKey && acc.secretKey && acc.passphrase) {
        try {
          const { OKXTradeService } = await import("./okxTradeService.ts");
          const service = new OKXTradeService({
            apiKey: acc.apiKey,
            secretKey: acc.secretKey,
            passphrase: acc.passphrase,
            accountIdx: accounts.indexOf(acc),
            accountId: acc.id,
          });
          await service.syncTime(true);
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          const accountIdx = accounts.indexOf(acc);
          const label = acc.name || ('#' + accountIdx);
          LogService.logKey('SYSTEM', 'system.power.resume.timeSyncFailed', { accountIdx, label, msg: err.message }, 'warn');
        }
      }
    }

    await wsManager.reconnectAll();

    const ordersCache = getOrdersCache();
    if (ordersCache) {
      LogService.logKey('SYSTEM', 'system.power.resume.refreshOrders', {});
      await ordersCache.refreshNow();
    }

    LogService.logKey('SYSTEM', 'system.power.resume.complete', {});
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    LogService.logKey('SYSTEM', 'system.power.resume.failed', { msg: err.message }, 'error');
  } finally {
    isReconnecting = false;
  }
}

function messageHandler(msg: PowerMonitorMessage): void {
  if (msg.type === 'SYSTEM_SUSPEND') {
    handleSystemSuspend();
  } else if (msg.type === 'SYSTEM_RESUME') {
    void handleSystemResume();
  } else if (msg.type === 'SHUTDOWN_FT') {
    LogService.logKey('SYSTEM', 'system.shutdown.ft', {});
    ftProcessManager.stopAll().catch(() => {});
  }
}

export function initPowerMonitorBridge(): void {
  if (isInitialized) {
    return;
  }

  const isElectron = process.env.ELECTRON_MODE === 'true';
  if (!isElectron) {
    return;
  }

  process.on('message', (msg: unknown) => {
    if (
      msg &&
      typeof msg === 'object' &&
      'type' in msg &&
      (msg.type === 'SYSTEM_SUSPEND' || msg.type === 'SYSTEM_RESUME' || msg.type === 'SHUTDOWN_FT')
    ) {
      messageHandler(msg as PowerMonitorMessage);
    }
  });

  isInitialized = true;
  LogService.logKey('SYSTEM', 'system.power.init', {});
}

export function isPowerMonitorInitialized(): boolean {
  return isInitialized;
}
