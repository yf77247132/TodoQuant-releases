import type { Application } from 'express';
import { registerCrudRoutes } from './crudFactory.ts';

interface CloseConfig {
  id: string;
  name?: string;
  account_id?: string;
  inst_id?: string;
  mgn_mode?: string;
  pos_side?: string;
  upl_filter?: string;
  upl_ratio_filter?: string;
  test_mode?: boolean;
  reverse?: boolean;
  [key: string]: unknown;
}

export function registerCloseRoutes(app: Application): void {
  registerCrudRoutes<CloseConfig>(app, {
    module: 'close',
    basePath: 'close',
    configKey: 'close_configs',
    validatePut: true,
    createConfig: (body, id) => {
      const { inst_id, account_id, test_mode, reverse, mgn_mode, pos_side, upl_filter, upl_ratio_filter, shortcut_key } = body;
      return {
        id,
        name: body.name || `#${Date.now().toString(16).slice(-4).toUpperCase()}`,
        account_id: account_id || '',
        inst_id: inst_id || '',
        mgn_mode: mgn_mode || '',
        pos_side: pos_side || '',
        upl_filter: upl_filter || '',
        upl_ratio_filter: upl_ratio_filter || '',
        test_mode: test_mode ?? true,
        reverse: reverse ?? false,
        shortcut_key: shortcut_key || ''
      };
    },
    buildStartConfig: (cfg) => {
      return {
        ...cfg,
        id: cfg.id,
        name: cfg.name,
        account_id: cfg.account_id,
        inst_id: cfg.inst_id || '',
        mgn_mode: cfg.mgn_mode || '',
        pos_side: cfg.pos_side || '',
        upl_filter: cfg.upl_filter || '',
        upl_ratio_filter: cfg.upl_ratio_filter || '',
        close_test_mode: cfg.test_mode !== undefined ? cfg.test_mode : true,
        reverse: cfg.reverse ?? false,
      };
    },
  });
}
