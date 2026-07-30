import { type OKXWebSocketManager } from "../ws/wsManager.ts";
import { type SavingsPoller } from "../../services/savingsPoller.ts";
import { type OrdersCacheManager } from "../../services/ordersCache.ts";
import { getEffectiveMasterKey, loadSavedConfig } from "../../services/configService.ts";
import { LogService } from '../../services/logService.ts';
import { marketScanner } from '../../services/MarketScanner.ts';
import { DiyEngine } from '../../engine/diy/DiyEngine.ts';
import { getConfigArray } from '../../routes/modules/shared.ts';

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
      marketScanner.start();
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

export function startAutoStartConfigs(): void {
  const configData = loadSavedConfig();

  const diyConfigs = getConfigArray<Record<string, unknown>>(configData.diy_strategies);
  let startedCount = 0;
  for (const cfg of diyConfigs) {
    if (cfg.auto_start && cfg.id) {
      DiyEngine.getInstance().startStrategy(String(cfg.id));
      startedCount++;
    }
  }

  if (startedCount > 0) {
    LogService.logKey("system", 'bootstrap.autoStart.done', { count: startedCount }, 'info');
  }
}
