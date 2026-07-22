import type { Application } from 'express';
import { registerAccountsRoutes } from './modules/accountsRoutes.ts';
import { registerAmendRoutes } from './modules/amendRoutes.ts';
import { registerCancelRoutes } from './modules/cancelRoutes.ts';
import { registerCloseRoutes } from './modules/closeRoutes.ts';
import { registerConfigRoutes } from './modules/configRoutes.ts';
import { registerDiyRoutes } from './modules/diyRoutes.ts';
import { registerErrorRoutes } from './modules/errorRoutes.ts';
import { registerFreqtradeRoutes } from './modules/freqtradeRoutes.ts';
import { registerMarginRoutes } from './modules/marginRoutes.ts';
import { registerOrdersRoutes } from './modules/ordersRoutes.ts';
import { registerSnapshotRoutes } from './modules/snapshotRoutes.ts';
import { registerSystemRoutes } from './modules/systemRoutes.ts';
import { registerTraderRoutes } from './modules/traderRoutes.ts';
import type { ApiRoutesConfig } from './modules/types.ts';
import { registerWebhookRoutes } from './modules/webhookRoutes.ts';

export type { ApiRoutesConfig } from './modules/types.ts';

export function setupApiRoutes(app: Application, config: ApiRoutesConfig): void {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now(), env: process.env.NODE_ENV });
  });

  registerOrdersRoutes(app, config);
  registerSnapshotRoutes(app, config);
  registerTraderRoutes(app);
  registerCancelRoutes(app);
  registerCloseRoutes(app);
  registerAmendRoutes(app);
  registerMarginRoutes(app);
  registerConfigRoutes(app, config);
  registerAccountsRoutes(app, config);
  registerWebhookRoutes(app);
  registerDiyRoutes(app);
  registerSystemRoutes(app);
  registerErrorRoutes(app, config);
  registerFreqtradeRoutes(app);
}
