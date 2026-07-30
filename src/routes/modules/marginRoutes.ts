import type { Application } from 'express';
import { registerCrudRoutes } from './crudFactory.ts';

interface MarginConfig {
  id: string;
  name?: string;
  account_id?: string;
  margin_guard_redeem_amt?: string;
  margin_payment_account?: string;
  margin_to_account?: string;
  test_mode?: boolean;
  [key: string]: unknown;
}

export function registerMarginRoutes(app: Application): void {
  registerCrudRoutes<MarginConfig>(app, {
    module: 'margin',
    basePath: 'margin',
    configKey: 'margin_configs',
    createConfig: (body, id) => {
      const { account_id, margin_guard_redeem_amt,
              margin_payment_account, margin_to_account, test_mode, shortcut_key } = body;
      return {
        id,
        name: body.name || `#${Date.now().toString(16).slice(-4).toUpperCase()}`,
        account_id: account_id || '',
        margin_guard_redeem_amt: margin_guard_redeem_amt ?? "100",
        margin_payment_account: margin_payment_account || "funding",
        margin_to_account: margin_to_account || "18",
        test_mode: test_mode !== undefined ? !!test_mode : false,
        shortcut_key: shortcut_key || ''
      };
    },
    buildStartConfig: (cfg) => {
      return {
        ...cfg,
        id: cfg.id,
        name: cfg.name,
        account_id: cfg.account_id,
        margin_guard_redeem_amt: cfg.margin_guard_redeem_amt ?? '100',
        margin_payment_account: cfg.margin_payment_account || 'funding',
        margin_to_account: cfg.margin_to_account || '18',
        margin_test_mode: cfg.test_mode !== undefined ? cfg.test_mode : false
      };
    },
  });
}
