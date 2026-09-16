import type { Application } from 'express';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from '../../services/errorMonitor.ts';
import { StrategyEngine } from '../../engine/StrategyEngine.ts';
import { LogService } from '../../services/logService.ts';
import { toError, asyncHandler } from './shared.ts';
import { registerCrudRoutes } from './crudFactory.ts';
import { AmendOrderAction } from '../../blocks/actions/AmendOrderAction.ts';

interface AmendConfig {
  id: string;
  name?: string;
  account_id?: string;
  inst_id?: string;
  order_type?: string;
  trigger_px_increment?: string;
  tp_ord_px_increment?: string;
  sl_ord_px_increment?: string;
  px_increment?: string;
  tp_px_increment?: string;
  sl_px_increment?: string;
  new_contract_size?: string;
  test_mode?: boolean;
  [key: string]: unknown;
}

export function registerAmendRoutes(app: Application): void {
  registerCrudRoutes<AmendConfig>(app, {
    module: 'amend',
    basePath: 'amend',
    configKey: 'amend_configs',
    createConfig: (body, id) => {
      const { inst_id, account_id, order_type, tp_sl_type,
              trigger_px_increment, tp_ord_px_increment, sl_ord_px_increment,
              px_increment, tp_px_increment, sl_px_increment,
              callback_ratio_spread, active_px, new_contract_size, test_mode, shortcut_key } = body;
      return {
        id,
        name: body.name || `#${Date.now().toString(16).slice(-4).toUpperCase()}`,
        account_id: account_id || '',
        inst_id: inst_id || '',
        order_type: order_type || 'trigger',
        tp_sl_type: tp_sl_type || 'tp_sl',
        trigger_px_increment: trigger_px_increment ?? "0",
        tp_ord_px_increment: tp_ord_px_increment ?? "-1",
        sl_ord_px_increment: sl_ord_px_increment ?? "-1",
        px_increment: px_increment ?? "0",
        tp_px_increment: tp_px_increment ?? "0",
        sl_px_increment: sl_px_increment ?? "0",
        callback_ratio_spread: callback_ratio_spread ?? "0",
        active_px: active_px ?? "",
        new_contract_size: new_contract_size ?? "1",
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
        amend_order_type: cfg.order_type || 'trigger',
        amend_test_mode: cfg.test_mode !== undefined ? cfg.test_mode : true,
        trigger_px_increment: cfg.trigger_px_increment ?? "0",
        tp_ord_px_increment: cfg.tp_ord_px_increment ?? "-1",
        sl_ord_px_increment: cfg.sl_ord_px_increment ?? "-1",
        px_increment: cfg.px_increment ?? "0",
        tp_px_increment: cfg.tp_px_increment ?? "0",
        sl_px_increment: cfg.sl_px_increment ?? "0",
        new_contract_size: cfg.new_contract_size ?? "1"
      };
    },
  });

  app.post("/api/amend/run", asyncHandler(async (req, res) => {
    const cfg = req.body;
    const runId = `run_${Date.now()}`;

    const moduleConfig: AmendConfig = {
      ...cfg,
      id: runId,
      name: cfg.name || '立即执行改单',
      account_id: cfg.account_id,
      inst_id: cfg.inst_id || '',
      amend_order_type: cfg.order_type || 'trigger',
      amend_test_mode: cfg.test_mode !== undefined ? cfg.test_mode : false,
      trigger_px_increment: cfg.trigger_px_increment ?? "0",
      tp_ord_px_increment: cfg.tp_ord_px_increment ?? "-1",
      sl_ord_px_increment: cfg.sl_ord_px_increment ?? "-1",
      px_increment: cfg.px_increment ?? "0",
      tp_px_increment: cfg.tp_px_increment ?? "0",
      sl_px_increment: cfg.sl_px_increment ?? "0",
      new_contract_size: cfg.new_contract_size ?? "1"
    };

    try {
      const tradeService = await StrategyEngine.getTradeService(moduleConfig as any, 'amend');
      if (!tradeService) {
        LogService.logKey("amend", 'task.start.failed.noApiKey', {}, 'error', runId);
        return res.status(400).json({ ok: false, runId, error: '账户 API 密钥未配置，无法执行改单' });
      }

      LogService.logKey("amend", 'task.start.begin', { type: '改单' }, 'info', runId);
      const summary = await AmendOrderAction.execute(moduleConfig as any, tradeService as any);
      LogService.logKey("amend", 'task.complete', { type: '改单' }, 'info', runId);
      res.json({ ok: true, runId, summary });
    } catch (err: unknown) {
      const error = toError(err);
      LogService.logKey("amend", 'task.exception', { msg: error.message }, 'error', runId);
      ErrorMonitor.captureError(error, ErrorLevel.MEDIUM, ErrorCategory.SYSTEM);
      res.status(500).json({ ok: false, runId, error: error.message });
    }
  }));
}
