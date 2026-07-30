import type { Application } from 'express';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from '../../services/errorMonitor.ts';
import { StrategyEngine } from '../../engine/StrategyEngine.ts';
import { LogService } from '../../services/logService.ts';
import { loadSavedConfig } from '../../services/configService.ts';
import { resolveAccountFromConfig } from '../../lib/resolveAccount.ts';
import { asyncHandler, resolveAccountFromRequest, toError } from './shared.ts';
import type { ApiRoutesConfig } from './types.ts';
import type { OKXOrder, OKXAlgoOrder } from '../../types/okx.ts';
import { OKX_ORDER_TYPE_DISPLAY } from '../../constants/orderTypes.ts';

export function registerOrdersRoutes(app: Application, config: ApiRoutesConfig): void {
  app.get('/api/orders/pending', async (req, res) => {
    const noWait = req.query.noWait === '1';

    if (!noWait) {
      await config.ordersCache.waitForReady();
      const data = config.ordersCache.getAll();
      res.json({ ok: true, data });
      return;
    }

    const data = config.ordersCache.getAll();
    res.json({
      ok: true,
      data,
      warming: !config.ordersCache.isReady(),
    });
  });

  app.post('/api/orders/history', asyncHandler(async (req, res) => {
    const { accountId, instType, instId, after, limit } = req.body;
    if (!accountId) {
      return res.status(400).json({ ok: false, error: '缺少 accountId' });
    }

    const resolveResult = resolveAccountFromConfig({ account_id: accountId }, 'trader', loadSavedConfig().accounts || []);
    if ('error' in resolveResult) {
      return res.status(404).json({ ok: false, error: resolveResult.error });
    }

    const tradeService = await StrategyEngine.getTradeService({ account_id: accountId } as any, 'trader');
    if (!tradeService) {
      return res.status(404).json({ ok: false, error: '账户未找到或未解密' });
    }

    const rawOrders = await (tradeService as any).getHistoryOrders?.(instType || 'SWAP', instId, after, limit);
    if (!Array.isArray(rawOrders)) {
      return res.json({ ok: true, data: [] });
    }

    const { accountIdx } = resolveResult;

    const typeMap = OKX_ORDER_TYPE_DISPLAY;

    const historyOrders = rawOrders.map((order: OKXOrder) => {
      const orderTypeDisplay = typeMap[order.ordType] || order.ordType;

      return {
        ordId: order.ordId,
        instId: order.instId,
        side: order.side,
        ordType: order.ordType,
        px: order.px,
        sz: order.sz,
        cTime: order.cTime,
        uTime: order.uTime,
        state: order.state,
        avgPx: order.avgPx,
        fillSz: order.fillSz,
        accFillSz: order.accFillSz,
        lever: order.lever,
        tpOrdPx: order.tpOrdPx,
        slOrdPx: order.slOrdPx,
        triggerPx: order.tpTriggerPx || order.slTriggerPx,
        tdMode: order.tdMode,
        _account: accountIdx,
        _accountId: accountId,
        exchange: 'OKX',
        orderTime: order.cTime,
        orderPrice: order.px === '-1' || order.px === '0' ? '-' : order.px,
        triggerPrice: order.tpTriggerPx || order.slTriggerPx || null,
        tpPrice: order.tpOrdPx || null,
        slPrice: order.slOrdPx || null,
        orderTypeDisplay,
      };
    });

    res.json({ ok: true, data: historyOrders });
  }));

  app.post('/api/orders/algo-history', asyncHandler(async (req, res) => {
    const { accountId, instType, instId, after, limit } = req.body;
    if (!accountId) {
      return res.status(400).json({ ok: false, error: '缺少 accountId' });
    }

    const resolveResult = resolveAccountFromConfig({ account_id: accountId }, 'trader', loadSavedConfig().accounts || []);
    if ('error' in resolveResult) {
      return res.status(404).json({ ok: false, error: resolveResult.error });
    }

    const tradeService = await StrategyEngine.getTradeService({ account_id: accountId } as any, 'trader');
    if (!tradeService) {
      return res.status(404).json({ ok: false, error: '账户未找到或未解密' });
    }

    const rawOrders = await (tradeService as any).getHistoryAlgoOrders?.(instType || 'SWAP', instId, after, limit);
    if (!Array.isArray(rawOrders)) {
      return res.json({ ok: true, data: [] });
    }

    const { accountIdx } = resolveResult;

    const typeMap = OKX_ORDER_TYPE_DISPLAY;

    const historyAlgoOrders = rawOrders.map((order: OKXAlgoOrder) => {
      const orderTypeDisplay = typeMap[order.ordType || ''] || order.ordType || '-';

      const triggerPrice = order.triggerPx || order.tpTriggerPx || order.slTriggerPx || null;

      return {
        ordId: order.algoId,
        instId: order.instId,
        side: order.side,
        ordType: order.ordType || '',
        px: order.ordPx || '-',
        sz: order.sz,
        cTime: order.cTime,
        uTime: order.uTime,
        state: order.state,
        avgPx: order.avgPx || '',
        fillSz: order.fillSz || '',
        accFillSz: order.accFillSz || '',
        lever: order.lever,
        tpOrdPx: order.tpOrdPx || '',
        slOrdPx: order.slOrdPx || '',
        triggerPx: triggerPrice || '',
        tdMode: order.tdMode,
        _account: accountIdx,
        _accountId: accountId,
        exchange: 'OKX',
        orderTime: order.cTime,
        orderPrice: order.ordPx === '-1' || order.ordPx === '0' ? '-' : (order.ordPx || '-'),
        triggerPrice,
        tpPrice: order.tpOrdPx || null,
        slPrice: order.slOrdPx || null,
        orderTypeDisplay,
      };
    });

    res.json({ ok: true, data: historyAlgoOrders });
  }));

  app.post('/api/order/cancel', asyncHandler(async (req, res) => {
    const { accountId: rawAccountId, _account, instId, ordId, algoId, tdMode } = req.body;
    let accountId = rawAccountId;
    if (!accountId && typeof _account === 'number') {
      const configData = loadSavedConfig();
      const acc = (configData.accounts || [])[_account];
      if (acc?.id) accountId = acc.id;
    }
    if (!accountId) {
      return res.status(400).json({ ok: false, error: '缺少 accountId' });
    }
    const result = await StrategyEngine.cancelSingleOrder(accountId, instId, ordId, algoId, tdMode);
    const exchangeOrderId = String(algoId || ordId || '');
    if (exchangeOrderId) {
      const configData = loadSavedConfig();
      const idx = (configData.accounts || []).findIndex((a: any) => a.id === accountId);
      if (idx >= 0) {
        if (result?.code === '0') {
          config.ordersCache.removeOrder(idx, exchangeOrderId);
          config.ordersCache.broadcastSyncSignal();
        } else if (result?.data?.[0]?.sCode === '51400') {
          config.ordersCache.removeOrder(idx, exchangeOrderId);
          config.ordersCache.broadcastSyncSignal();
        }
      }
    }
    res.json({ ok: result.code === '0', data: result });
  }));

  app.post('/api/position/close', asyncHandler(async (req, res) => {
    const { instId, mgnMode, posSide, ccy } = req.body;
    const resolved = resolveAccountFromRequest(req, res);
    if (!resolved) return;
    const result = await StrategyEngine.closePosition(resolved.account.id, instId, mgnMode, posSide, ccy);
    if (result.code === '0') {
      const { AccountMonitor } = await import('../../services/AccountMonitor.ts');
      AccountMonitor.getInstance().triggerSyncByAccountId(resolved.account.id);
    }
    res.json({ ok: result.code === '0', data: result });
  }));

  app.post('/api/position/close-advanced', asyncHandler(async (req, res) => {
    const { instId, mgnMode, posSide, ccy, priceType, px, sz, posQty } = req.body;
    const resolved = resolveAccountFromRequest(req, res);
    if (!resolved) return;
    if (!priceType || !['market', 'limit'].includes(priceType)) {
      return res.status(400).json({ ok: false, error: 'priceType 必须为 market 或 limit' });
    }
    if (priceType === 'limit' && !px) {
      return res.status(400).json({ ok: false, error: '限价平仓必须指定价格' });
    }

    const result = await StrategyEngine.closePositionAdvanced({
      accountId: resolved.account.id,
      instId,
      mgnMode,
      posSide,
      ccy,
      priceType,
      px,
      sz: sz || '100%',
      posQty: posQty || '0',
    });

    const isSuccess = result?.code === '0';
    if (isSuccess) {
      const { AccountMonitor } = await import('../../services/AccountMonitor.ts');
      AccountMonitor.getInstance().triggerSyncByAccountId(resolved.account.id);
    }
    res.json({ ok: isSuccess, data: result });
  }));

  app.post('/api/position/open-advanced', asyncHandler(async (req, res) => {
    const { instId, mgnMode, posSide, ccy, priceType, px, sz, posQty } = req.body;
    const resolved = resolveAccountFromRequest(req, res);
    if (!resolved) return;
    if (!priceType || !['market', 'limit'].includes(priceType)) {
      return res.status(400).json({ ok: false, error: 'priceType 必须为 market 或 limit' });
    }
    if (priceType === 'limit' && !px) {
      return res.status(400).json({ ok: false, error: '限价加仓必须指定价格' });
    }

    const result = await StrategyEngine.openPositionAdvanced({
      accountId: resolved.account.id,
      instId,
      mgnMode,
      posSide,
      ccy,
      priceType,
      px,
      sz: sz || '100%',
      posQty: posQty || '0',
    });

    const isSuccess = result?.code === '0';
    if (isSuccess) {
      const { AccountMonitor } = await import('../../services/AccountMonitor.ts');
      AccountMonitor.getInstance().triggerSyncByAccountId(resolved.account.id);
    }
    res.json({ ok: isSuccess, data: result });
  }));

  app.post('/api/position/reverse', asyncHandler(async (req, res) => {
    const { instId, mgnMode, posSide, ccy, posQty } = req.body;
    const resolved = resolveAccountFromRequest(req, res);
    if (!resolved) return;
    if (!instId) {
      return res.status(400).json({ ok: false, error: '缺少 instId' });
    }

    const result = await StrategyEngine.reversePosition({
      accountId: resolved.account.id,
      instId,
      mgnMode,
      posSide,
      ccy,
      posQty: posQty || '0',
    });

    const { AccountMonitor } = await import('../../services/AccountMonitor.ts');
    AccountMonitor.getInstance().triggerSyncByAccountId(resolved.account.id);
    res.json({ ok: true, data: result });
  }));

  app.post('/api/position/batch-close', asyncHandler(async (req, res) => {
    const { positions } = req.body;
    if (!Array.isArray(positions) || positions.length === 0) {
      return res.status(400).json({ ok: false, error: 'positions 数组不能为空' });
    }

    const details: Array<{ instId: string; posSide: string; success: boolean; error?: string }> = [];
    let success = 0;
    let fail = 0;
    const syncedAccountIds = new Set<string>();

    for (const pos of positions) {
      const { accountId, instId, mgnMode, posSide, ccy } = pos;
      try {
        const result = await StrategyEngine.closePosition(accountId, instId, mgnMode, posSide, ccy);
        if (result?.code === '0') {
          success++;
          details.push({ instId, posSide: posSide || '', success: true });
          syncedAccountIds.add(accountId);
        } else {
          fail++;
          details.push({ instId, posSide: posSide || '', success: false, error: result?.msg || '平仓失败' });
        }
      } catch (e: unknown) {
        ErrorMonitor.captureError(toError(e), ErrorLevel.MEDIUM, ErrorCategory.SYSTEM);
        fail++;
        details.push({ instId, posSide: posSide || '', success: false, error: toError(e).message });
      }

      if (positions.indexOf(pos) < positions.length - 1) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    if (syncedAccountIds.size > 0) {
      try {
        const { AccountMonitor } = await import('../../services/AccountMonitor.ts');
        const monitor = AccountMonitor.getInstance();
        for (const aid of syncedAccountIds) {
          monitor.triggerSyncByAccountId(aid);
        }
      } catch (e: unknown) {
        const err = toError(e);
        LogService.error('batch-close', `同步账户失败: ${err.message}`);
        ErrorMonitor.captureError(err, ErrorLevel.MEDIUM, ErrorCategory.SYSTEM);
      }
    }

    LogService.info('batch-close', `批量平仓完成: 成功${success}, 失败${fail}`);
    res.json({ ok: true, success, fail, details });
  }));

  app.post('/api/order/batch-cancel', asyncHandler(async (req, res) => {
    const { orders } = req.body;
    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ ok: false, error: 'orders 数组不能为空' });
    }

    for (const [i, ord] of orders.entries()) {
      if (!ord.accountId) {
        return res.status(400).json({ ok: false, error: `第${i + 1}笔订单缺少 accountId` });
      }
      if (!ord.ordId && !ord.algoId) {
        return res.status(400).json({ ok: false, error: `第${i + 1}笔订单缺少 ordId 或 algoId` });
      }
    }

    const details: Array<{ instId: string; ordId?: string; algoId?: string; success: boolean; error?: string }> = [];
    let success = 0;
    let fail = 0;
    const syncedAccountIds = new Set<string>();
    const removedOrderIds: Array<{ accountIdx: number; orderId: string }> = [];

    const grouped = new Map<string, Array<typeof orders[number]>>();
    for (const ord of orders) {
      const aid = ord.accountId;
      if (!grouped.has(aid)) grouped.set(aid, []);
      grouped.get(aid)!.push(ord);
    }

    const fullConfig = loadSavedConfig();
    const accounts = fullConfig.accounts || [];

    for (const [accountId, accountOrders] of grouped) {
      const resolveResult = resolveAccountFromConfig({ account_id: accountId }, 'trader', accounts);
      if ('error' in resolveResult) {
        for (const ord of accountOrders) {
          fail++;
          details.push({ instId: ord.instId, ordId: ord.ordId, algoId: ord.algoId, success: false, error: resolveResult.error });
        }
        continue;
      }

      const { accountIdx } = resolveResult;
      const tradeService = await StrategyEngine.getTradeService({ account_id: accountId } as any, 'trader');
      if (!tradeService) {
        for (const ord of accountOrders) {
          fail++;
          details.push({ instId: ord.instId, ordId: ord.ordId, algoId: ord.algoId, success: false, error: '账户未找到或未解密' });
        }
        continue;
      }

      const normalOrders: Array<typeof orders[number]> = [];
      const algoOrders: Array<typeof orders[number]> = [];
      for (const ord of accountOrders) {
        if (ord.algoId) {
          algoOrders.push(ord);
        } else if (ord.ordId) {
          normalOrders.push(ord);
        }
      }

      for (let i = 0; i < normalOrders.length; i += 20) {
        const batch = normalOrders.slice(i, i + 20);
        const batchParams = batch.map(o => ({ instId: o.instId, ordId: o.ordId, tdMode: o.tdMode }));
        try {
          const result = await tradeService.cancelBatchOrders(batchParams);
          const results = Array.isArray(result?.data) ? result.data : [];
          if (results.length !== batch.length) {
            LogService.info('batch-cancel', `撤单结果数量不匹配: batch=${batch.length}, results=${results.length}, accountId=${accountId}`);
          }
          for (let j = 0; j < batch.length; j++) {
            const r = results[j];
            const isOk = r?.sCode === '0' || r?.sMsg === 'success';
            if (isOk) {
              success++;
              details.push({ instId: batch[j].instId, ordId: batch[j].ordId, success: true });
              removedOrderIds.push({ accountIdx, orderId: String(batch[j].ordId) });
              syncedAccountIds.add(accountId);
            } else {
              fail++;
              const errMsg = r?.sMsg || '撤单失败';
              LogService.info('batch-cancel', `撤单失败: instId=${batch[j].instId}, ordId=${batch[j].ordId}, sCode=${r?.sCode}, sMsg=${errMsg}`);
              details.push({ instId: batch[j].instId, ordId: batch[j].ordId, success: false, error: errMsg });
            }
          }
        } catch (e: unknown) {
          ErrorMonitor.captureError(toError(e), ErrorLevel.MEDIUM, ErrorCategory.SYSTEM);
          for (const o of batch) {
            fail++;
            details.push({ instId: o.instId, ordId: o.ordId, success: false, error: toError(e).message });
          }
        }
        if (i + 20 < normalOrders.length) {
          await new Promise(r => setTimeout(r, 150));
        }
      }

      for (let i = 0; i < algoOrders.length; i += 10) {
        const batch = algoOrders.slice(i, i + 10);
        const batchParams = batch.map(o => ({ instId: o.instId, algoId: o.algoId, tdMode: o.tdMode }));
        try {
          const result = await tradeService.cancelBatchAlgoOrders(batchParams);
          const results = Array.isArray(result?.data) ? result.data : [];
          if (results.length !== batch.length) {
            LogService.info('batch-cancel', `算法单撤单结果数量不匹配: batch=${batch.length}, results=${results.length}, accountId=${accountId}`);
          }
          for (let j = 0; j < batch.length; j++) {
            const r = results[j];
            const isOk = r?.sCode === '0' || r?.sMsg === 'success';
            if (isOk) {
              success++;
              details.push({ instId: batch[j].instId, algoId: batch[j].algoId, success: true });
              removedOrderIds.push({ accountIdx, orderId: String(batch[j].algoId) });
              syncedAccountIds.add(accountId);
            } else {
              fail++;
              const errMsg = r?.sMsg || '撤单失败';
              LogService.info('batch-cancel', `算法单撤单失败: instId=${batch[j].instId}, algoId=${batch[j].algoId}, sCode=${r?.sCode}, sMsg=${errMsg}`);
              details.push({ instId: batch[j].instId, algoId: batch[j].algoId, success: false, error: errMsg });
            }
          }
        } catch (e: unknown) {
          ErrorMonitor.captureError(toError(e), ErrorLevel.MEDIUM, ErrorCategory.SYSTEM);
          for (const o of batch) {
            fail++;
            details.push({ instId: o.instId, algoId: o.algoId, success: false, error: toError(e).message });
          }
        }
        if (i + 10 < algoOrders.length) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }

    if (removedOrderIds.length > 0) {
      for (const { accountIdx, orderId } of removedOrderIds) {
        config.ordersCache.removeOrder(accountIdx, orderId);
      }
    }
    config.ordersCache.broadcastSyncSignal();

    LogService.info('batch-cancel', `批量撤单完成: 成功${success}, 失败${fail}`);
    res.json({ ok: true, success, fail, details });
  }));
}
