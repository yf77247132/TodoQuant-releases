import type { Application } from 'express';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from '../../services/errorMonitor.ts';
import { StrategyEngine } from '../../engine/StrategyEngine.ts';
import { LogService } from '../../services/logService.ts';
import { sendError, toError } from './shared.ts';
import { registerCrudRoutes } from './crudFactory.ts';
import { CancelOrderAction } from '../../blocks/actions/CancelOrderAction.ts';

interface CancelConfig {
  id: string;
  name?: string;
  account_id?: string;
  inst_id?: string;
  order_types?: string[];
  side?: string;
  test_mode?: boolean;
  [key: string]: unknown;
}

export function registerCancelRoutes(app: Application): void {
  registerCrudRoutes<CancelConfig>(app, {
    module: 'cancel',
    basePath: 'cancel',
    configKey: 'cancel_configs',
    createConfig: (body, id) => {
      const { inst_id, account_id, order_types, test_mode, side, shortcut_key } = body;
      return {
        id,
        name: body.name || `#${Date.now().toString(16).slice(-4).toUpperCase()}`,
        inst_id: inst_id || '',
        account_id: account_id || '',
        order_types: order_types || ['limit', 'trigger', 'conditional', 'oco', 'post_only', 'chase', 'move_order_stop'],
        side: side || '',
        test_mode: test_mode !== undefined ? !!test_mode : true,
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
        cancel_order_types: cfg.order_types || [],
        cancel_side: cfg.side || '',
        cancel_test_mode: cfg.test_mode !== undefined ? cfg.test_mode : true
      };
    },
  });

  app.post("/api/cancel/run", (req, res) => {
    try {
      const t0 = Date.now();
      const cfg = req.body;
      const runId = `run_${Date.now()}`;
      const orderTypesCount = (cfg.order_types || []).length;
      LogService.info('cancel-perf', `[t+0ms] 收到撤单请求 runId=${runId} account=${cfg.account_id} instId=${cfg.inst_id || '(全部)'} types=${orderTypesCount}`);

      const moduleConfig: CancelConfig = {
        ...cfg,
        id: runId,
        name: cfg.name || '立即执行撤单',
        account_id: cfg.account_id,
        inst_id: cfg.inst_id || '',
        cancel_order_types: cfg.order_types || [],
        cancel_side: cfg.side || '',
        cancel_test_mode: cfg.test_mode !== undefined ? cfg.test_mode : false
      };

      (async () => {
        try {
          const tTrade0 = Date.now();
          const tradeService = await StrategyEngine.getTradeService(moduleConfig as any, 'cancel');
          LogService.info('cancel-perf', `[t+${tTrade0 - t0}ms] getTradeService 完成(${tTrade0 - t0}ms) ${tradeService ? '✓' : '✗ 无 apiKey'}`);

          if (!tradeService) {
            LogService.logKey("cancel", 'task.start.failed.noApiKey', {}, 'error', runId);
            return;
          }

          const tExec0 = Date.now();
          LogService.logKey("cancel", 'task.start.begin', { type: '撤单' }, 'info', runId);
          await CancelOrderAction.execute(moduleConfig as any, tradeService);
          LogService.info('cancel-perf', `[t+${Date.now() - t0}ms] CancelOrderAction.execute 完成 execute 内耗时=${Date.now() - tExec0}ms 总耗时=${Date.now() - t0}ms`);
          LogService.logKey("cancel", 'task.complete', { type: '撤单' }, 'info', runId);
        } catch (err: unknown) {
          const error = toError(err);
          LogService.logKey("cancel", 'task.exception', { msg: error.message }, 'error', runId);
          ErrorMonitor.captureError(error, ErrorLevel.MEDIUM, ErrorCategory.SYSTEM);
        }
      })();

      res.json({ ok: true, runId });
    } catch (e: unknown) {
      sendError(res, e);
    }
  });
}
