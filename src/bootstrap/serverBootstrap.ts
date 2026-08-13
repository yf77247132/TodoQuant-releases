import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";

interface ElectronProcess {
  resourcesPath?: string;
}
import { loadSavedConfig, saveConfigToFile, getEffectiveMasterKey } from "../services/configService.ts";
import { LogService } from "../services/logService.ts";
import { StrategyEngine } from "../engine/StrategyEngine.ts";
import { OKXWebSocketManager } from "./ws/wsManager.ts";
import { SavingsPoller } from "../services/savingsPoller.ts";
import { OrdersCacheManager } from "../services/ordersCache.ts";
import { setupApiRoutes } from "../routes/apiRoutes.ts";
import { AccountMonitor } from "../services/AccountMonitor.ts";
import { ErrorMonitor, ErrorLevel, ErrorCategory } from "../services/errorMonitor.ts";
import { ready as dbReady } from "../services/dbService.ts";
import { InstrumentService } from "../services/instrumentService.ts";
import { DiyEngine } from "../engine/diy/DiyEngine.ts";
import { createApp } from "./server/createApp.ts";
import { setupMiddleware } from "./server/setupMiddleware.ts";
import { setupWebSocket } from "./server/setupWebSocket.ts";
import { createStartAccountMonitoring, startBackgroundJobs, startAutoStartConfigs } from "./server/startBackgroundJobs.ts";
import { tunnelManager } from "../services/tunnelManager.ts";
import { findAvailablePort, setResolvedPort, getInitialPort } from "../lib/portManager.ts";
import { initPowerMonitorBridge } from "../services/powerMonitorBridge.ts";
import { marketScanner } from "../services/MarketScanner.ts";

let wsManager: OKXWebSocketManager | null = null;
let savingsPoller: SavingsPoller | null = null;
let ordersCache: OrdersCacheManager | null = null;
let timeSyncInterval: NodeJS.Timeout | null = null;

function migrateAccountId(cfg: Record<string, unknown>): boolean {
  const accounts = (cfg.accounts || []) as Array<{ id?: string; [key: string]: unknown }>;
  if (accounts.length === 0) return false;

  const indexToId: Record<string, string> = {};
  accounts.forEach((acc: { id?: string; [key: string]: unknown }, idx: number) => {
    indexToId[String(idx)] = acc.id;
  });

  let dirty = false;

  const arrayKeys = ['place_configs', 'amend_configs', 'cancel_configs', 'close_configs', 'margin_configs'];
  for (const key of arrayKeys) {
    const arr = cfg[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const currentId = String(item.account_id || '').trim();
      if (!currentId || /^\d+$/.test(currentId)) {
        const idxStr = currentId || String(item.api_key_index ?? '').trim();
        if (/^\d+$/.test(idxStr) && indexToId[idxStr]) {
          item.account_id = indexToId[idxStr];
          dirty = true;
        }
      }
    }
  }

  const singleKeys: Array<[string, string]> = [
    ['traderConfig', 'api_key_index'],
    ['amendConfig', 'amend_api_key_index'],
    ['marginConfig', 'margin_api_key_index'],
  ];
  for (const [cfgKey, idxField] of singleKeys) {
    const moduleCfg = cfg[cfgKey];
    if (!moduleCfg || typeof moduleCfg !== 'object') continue;
    
    const currentId = String(moduleCfg.account_id || '').trim();
    if (!currentId || /^\d+$/.test(currentId)) {
      const idxStr = currentId || String(moduleCfg[idxField] ?? '').trim();
      if (/^\d+$/.test(idxStr) && indexToId[idxStr]) {
        moduleCfg.account_id = indexToId[idxStr];
        dirty = true;
      }
    }
  }

  const diyConditions = cfg['diy_conditions'];
  if (Array.isArray(diyConditions)) {
    for (const template of diyConditions) {
      if (Array.isArray(template.conditions)) {
        for (const cond of template.conditions) {
          if (cond.params) {
            const currentAccId = String((cond.params as Record<string, unknown>).accountId || '').trim();
            if (/^\d+$/.test(currentAccId) && indexToId[currentAccId]) {
              (cond.params as Record<string, unknown>).accountId = indexToId[currentAccId];
              dirty = true;
            }
          }
        }
      }
    }
  }

  return dirty;
}

export async function startServer() {
  const initialPort = getInitialPort();
  LogService.logKey("system", 'bootstrap.port.check', { port: initialPort }, 'info');
  
  const { port, wasPortInUse } = await findAvailablePort(initialPort);
  setResolvedPort(port);
  
  if (wasPortInUse) {
    LogService.logKey("system", 'bootstrap.port.occupied', { from: initialPort, to: port }, 'warn');
  } else {
    LogService.logKey("system", 'bootstrap.port.available', { port }, 'info');
  }

  const { app, server, wss, host, allowedOriginSet } = createApp(port);

  await dbReady;

  setupMiddleware(app, allowedOriginSet);

  await ErrorMonitor.init();

  const effectiveKey = getEffectiveMasterKey();
  if (!effectiveKey) {
    LogService.logKey("system", 'bootstrap.masterKey.wait', {}, 'info');
  } else {
    LogService.logKey("system", 'bootstrap.masterKey.loaded', {}, 'info');
  }

  wsManager = new OKXWebSocketManager({
    wss,
    loadConfig: loadSavedConfig,
  });

  LogService.logKey("system", 'bootstrap.logService.init', {}, 'info');
  initPowerMonitorBridge();

  const initialCfg = await loadSavedConfig();

  const cfgMutable = initialCfg as Record<string, unknown>;
  if (migrateAccountId(cfgMutable)) {
    try {
      saveConfigToFile(initialCfg);
      LogService.logKey("system", 'bootstrap.accountId.migrated', {}, 'info');
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      LogService.logKey("system", 'system.bootstrap.migrationSaveFailed', { msg: err.message }, 'error');
    }
  }

  if (initialCfg.timezone) {
    LogService.setTimezone(initialCfg.timezone);
  }

  StrategyEngine.init();
  DiyEngine.getInstance().init();

  marketScanner.start();

  InstrumentService.init();

  savingsPoller = new SavingsPoller({ wss });

  ordersCache = new OrdersCacheManager({ wss });
  globalThis.ORDERS_CACHE = ordersCache;

  const startAccountMonitoring = createStartAccountMonitoring(wsManager);
  timeSyncInterval = startBackgroundJobs(
    {
      wsManager,
      savingsPoller,
      ordersCache,
    },
    startAccountMonitoring
  );

  setTimeout(() => {
    startAutoStartConfigs();
  }, 5000);

  setupApiRoutes(app, {
    ordersCache,
    savingsPoller,
    wsManager,
    startAccountMonitoring,
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    ErrorMonitor.captureError(err, ErrorLevel.HIGH, ErrorCategory.SYSTEM);
    res.status(500).json({ ok: false, error: err.message || 'Internal Server Error' });
  });

  setupWebSocket({ wss, wsManager, savingsPoller });

  LogService.logKey("system", 'bootstrap.env.detected', { env: String(process.env.NODE_ENV || '') }, 'debug');

  if (process.env.NODE_ENV !== "production") {
    LogService.logKey("system", 'bootstrap.vite.start', {}, 'info');
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      
      app.use("*", async (req, res, next) => {
        const url = req.originalUrl;
        try {
          const fs = await import("fs");
          const templatePath = path.resolve(process.cwd(), "index.html");
          if (!fs.existsSync(templatePath)) {
            return next();
          }
          let template = fs.readFileSync(templatePath, "utf-8");
          template = await vite.transformIndexHtml(url, template);
          res.status(200).set({ "Content-Type": "text/html" }).end(template);
        } catch (e) {
          next(e);
        }
      });
      
      LogService.logKey("system", 'bootstrap.vite.mounted', {}, 'info');
    } catch (viteErr) {
      LogService.logKey("system", 'system.bootstrap.viteFailed', { msg: String(viteErr) }, 'error');
    }
  } else {
    const resourcesPath = (process as unknown as ElectronProcess).resourcesPath;
    const isPackagedElectron = resourcesPath && fs.existsSync(path.join(resourcesPath, 'app.asar'));
    const distPath = isPackagedElectron
      ? path.join(resourcesPath, "dist")
      : path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  server.listen(port, host, () => {
    LogService.logKey("system", 'bootstrap.server.started', { url: `http://${host}:${port}` }, 'info');
    tunnelManager.start(port).then((url) => {
      LogService.logKey("system", 'bootstrap.webhook.url', { url: `${url}/api/webhooks/tradingview` }, 'info');
    }).catch((err) => {
      LogService.logKey("system", 'bootstrap.tunnel.fail', { msg: err.message }, 'warn');
    });
  });
}

process.on("SIGINT", () => {
  LogService.logKey("system", 'bootstrap.shutdown.graceful', {}, 'info');
  if (timeSyncInterval) clearInterval(timeSyncInterval);
  tunnelManager.stop();
  wsManager?.stopAll();
  savingsPoller?.stop();
  ordersCache?.stop();
  marketScanner.stop();
  AccountMonitor.stopAll();
  process.exit(0);
});

process.on("SIGTERM", () => {
  LogService.logKey("system", 'bootstrap.shutdown.sigterm', {}, 'info');
  if (timeSyncInterval) clearInterval(timeSyncInterval);
  tunnelManager.stop();
  wsManager?.stopAll();
  savingsPoller?.stop();
  ordersCache?.stop();
  marketScanner.stop();
  AccountMonitor.stopAll();
  process.exit(0);
});
