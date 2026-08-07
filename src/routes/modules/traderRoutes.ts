import type { Application } from 'express';
import { LogService } from '../../services/logService.ts';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from '../../services/errorMonitor.ts';
import { StrategyEngine } from '../../engine/StrategyEngine.ts';
import type { PlaceOrderActionConfig } from '../../types/blocks.ts';
import { sendError, toError } from './shared.ts';
import { registerCrudRoutes } from './crudFactory.ts';
import { PlaceOrderAction } from '../../blocks/actions/PlaceOrderAction.ts';

type PlaceConfigArray = PlaceOrderActionConfig[];

let quickRunBusy = false;

export function registerTraderRoutes(app: Application): void {
  registerCrudRoutes<PlaceOrderActionConfig>(app, {
    module: 'trader',
    basePath: 'trader',
    configKey: 'place_configs',
    createConfig: (body, id) => {
      const {
        inst_id, account_id, order_type, side, pos_side, td_mode, order_direction,
        first_order_price, price_increment, order_interval, order_count, contract_size,
        take_profit_margin, stop_loss_margin,
        first_tp_price, first_sl_price,
        chase_val,
        callback_ratio, callback_spread, callback_ratio_spread, active_px,
        tp_sl_type, place_test_mode, skip_duplicate_orders, shortcut_key
      } = body;

      return {
        id,
        name: body.name || `#${Date.now().toString(16).slice(-4).toUpperCase()}`,
        account_id: account_id || '',
        inst_id: inst_id || '',
        order_type: order_type || 'limit',
        side: side || 'buy',
        pos_side: pos_side || 'net',
        td_mode: td_mode || 'cross',
        order_direction: order_direction || 'up',
        first_order_price: first_order_price ?? '10000',
        price_increment: price_increment ?? '0',
        order_interval: order_interval ?? '1000',
        order_count: order_count ?? '5',
        contract_size: contract_size ?? '1',
        take_profit_margin: take_profit_margin ?? '-1',
        stop_loss_margin: stop_loss_margin ?? '-1',
        first_tp_price: first_tp_price ?? '-1',
        first_sl_price: first_sl_price ?? '-1',
        chase_val: chase_val ?? '0',
        callback_ratio: callback_ratio ?? '0.01',
        callback_spread: callback_spread ?? '-1',
        callback_ratio_spread: callback_ratio_spread ?? (callback_spread && callback_spread !== '-1' ? callback_spread : (callback_ratio || '1%')),
        active_px: active_px ?? '10000',
        tp_sl_type: tp_sl_type || 'tp_sl',
        place_test_mode: place_test_mode !== undefined ? !!place_test_mode : true,
        skip_duplicate_orders: skip_duplicate_orders ?? false,
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
        order_type: cfg.order_type || 'limit',
        side: cfg.side || 'buy',
        pos_side: cfg.pos_side || 'net',
        td_mode: cfg.td_mode || 'cross',
        order_direction: cfg.order_direction || 'up',
        first_order_price: cfg.first_order_price ?? '10000',
        price_increment: cfg.price_increment ?? '0',
        order_interval: cfg.order_interval ?? '1000',
        order_count: cfg.order_count ?? '5',
        contract_size: cfg.contract_size ?? '1',
        take_profit_margin: cfg.take_profit_margin ?? '-1',
        stop_loss_margin: cfg.stop_loss_margin ?? '-1',
        first_tp_price: cfg.first_tp_price ?? '-1',
        first_sl_price: cfg.first_sl_price ?? '-1',
        chase_val: cfg.chase_val ?? '0',
        callback_ratio: cfg.callback_ratio ?? '0.01',
        callback_spread: cfg.callback_spread ?? '-1',
        active_px: cfg.active_px ?? '10000',
        place_test_mode: cfg.place_test_mode !== undefined ? cfg.place_test_mode : true,
        skip_duplicate_orders: cfg.skip_duplicate_orders ?? false
      };
    },
  });

  app.post("/api/trader/run", async (req, res) => {
    try {
      const runId = `run_${Date.now()}`;
      const moduleConfig: PlaceOrderActionConfig = {
        id: runId,
        name: 'QuickTrade',
        account_id: req.body.account_id || '',
        inst_id: req.body.inst_id || '',
        order_type: req.body.order_type || 'limit',
        side: req.body.side || 'buy',
        pos_side: req.body.pos_side || 'net',
        td_mode: req.body.td_mode || 'cross',
        order_direction: req.body.order_direction || 'up',
        first_order_price: req.body.first_order_price ?? '10000',
        price_increment: req.body.price_increment ?? '0',
        order_interval: req.body.order_interval ?? '1000',
        order_count: req.body.order_count ?? '1',
        contract_size: req.body.contract_size ?? '1',
        take_profit_margin: req.body.take_profit_margin ?? '-1',
        stop_loss_margin: req.body.stop_loss_margin ?? '-1',
        first_tp_price: req.body.first_tp_price ?? '-1',
        first_sl_price: req.body.first_sl_price ?? '-1',
        chase_val: req.body.chase_val ?? '0',
        callback_ratio: req.body.callback_ratio ?? '0.01',
        callback_spread: req.body.callback_spread ?? '-1',
        callback_ratio_spread: req.body.callback_ratio_spread ?? '',
        active_px: req.body.active_px ?? '10000',
        tp_sl_type: req.body.tp_sl_type || 'tp_sl',
        place_test_mode: req.body.place_test_mode !== undefined ? !!req.body.place_test_mode : true,
        skip_duplicate_orders: req.body.skip_duplicate_orders ?? false,
      };

      try {
        const tradeService = await StrategyEngine.getTradeService(moduleConfig as any, 'trader');
        if (!tradeService) {
          LogService.logKey("trader", 'task.start.failed.noApiKey', {}, 'error', runId);
          res.json({ ok: false, runId, msg: '未配置 API Key' });
          return;
        }

        LogService.logKey("trader", 'task.start.begin', { type: 'QuickTrade' }, 'info', runId);
        const placeResult = await PlaceOrderAction.execute(moduleConfig as any, tradeService);
        const ok = placeResult.failCount === 0;
        const firstError = placeResult.failures[0]?.sMsg;
        LogService.logKey("trader", 'task.complete', { type: 'QuickTrade', ok, successCount: placeResult.successCount, failCount: placeResult.failCount, firstError: firstError || '' }, 'info', runId);
        res.json({
          ok,
          runId,
          successCount: placeResult.successCount,
          failCount: placeResult.failCount,
          firstError: firstError || undefined,
        });
      } catch (err: unknown) {
        const error = toError(err);
        LogService.logKey("trader", 'task.exception', { msg: error.message }, 'error', runId);
        ErrorMonitor.captureError(error, ErrorLevel.MEDIUM, ErrorCategory.SYSTEM);
        res.json({ ok: false, runId, msg: error.message });
      }
    } catch (e: unknown) {
      sendError(res, e);
    }
  });
}
