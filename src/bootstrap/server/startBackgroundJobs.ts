import { type OKXWebSocketManager } from "../ws/wsManager.ts";
import { type SavingsPoller } from "../../services/savingsPoller.ts";
import { type OrdersCacheManager } from "../../services/ordersCache.ts";
import { getEffectiveMasterKey } from "../../services/configService.ts";
import { LogService } from '../../services/logService.ts';

interface StartBackgroundJobsOptions {
  wsManager: OKXWebSocketManager;
  savingsPoller: SavingsPoller;
  ordersCache: OrdersCacheManager;
}

export type StartAccountMonitoringFn = () => Promise<void>;

export function startBackgroundJobs(
  options: StartBackgroundJobsOptions,
  startAccountMonitoring: StartAccountMonitoringFn
): NodeJS.Timeout {
  const { wsManager, savingsPoller, ordersCache } = options;

  setTimeout(async () => {
    try {
      await startAccountMonitoring();
      savingsPoller.start();
      LogService.logKey("system", 'bootstrap.background.started', {}, 'info');
      void (async () => {
        await new Promise(r => setTimeout(r, 3000));
        await ordersCache.preload();
        LogService.logKey("system", 'bootstrap.background.cacheDone', {}, 'info');
      })().catch((e) => {
        LogService.logKey("system", 'system.bootstrap.cachePreloadFailed', { msg: String(e) }, 'error');
      });
    } catch (e) {
      LogService.logKey("system", 'system.bootstrap.backgroundTaskFailed', { msg: String(e) }, 'error');
    }
  }, 1000);

  return setInterval(() => {
    wsManager.syncGlobalTime();
  }, 30 * 60 * 1000);
}

export function createStartAccountMonitoring(wsManager: OKXWebSocketManager): StartAccountMonitoringFn {
  return async () => {
    LogService.logKey("system", 'bootstrap.background.monitorStart', {}, 'info');
    await wsManager.syncGlobalTime();
    if (getEffectiveMasterKey()) {
      await wsManager.startAccountMonitoring();
    } else {
      LogService.logKey("system", 'bootstrap.background.waitMasterKey', {}, 'info');
    }
  };
}
