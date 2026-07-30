
import { OKXTradeService } from "../../services/okxTradeService.ts";
import { LogService } from "../../services/logService.ts";
import { AccountMonitor } from "../../services/AccountMonitor.ts";
import { SymbolUtils } from "../../lib/symbolUtils.ts";
import { loadSavedConfig } from "../../services/configService.ts";
import { createBatchSignature } from "../../lib/idempotency.ts";
import { formatApiError } from "../../lib/apiErrorFormatter.ts";
import { CancelOrderActionConfig } from "../../types/blocks.ts";
import { isPendingNewState } from "../../lib/orderStates.ts";
import type { ActionCancelOrderParams } from "../../types/blocks.ts";
import type { TradeOrder } from "../../types/trade.ts";

interface UnifiedOrder extends TradeOrder {
  exchange?: string;
  _execType?: string;
  _algoType?: string;
  type?: string;
  orderType?: string;
  trailingDelta?: string | number;
  trailingTime?: number;
  callbackRate?: string | number;
  callbackRatio?: string;
  callbackSpread?: string;
  priceRate?: string | number;
  activationPrice?: string | number;
  activatePrice?: string;
  activatePx?: string;
  activePx?: string;
  contingencyType?: string;
  otoGroupType?: string;
  weight?: number;
  stopPrice?: string;
  triggerPrice?: string;
  price?: string;
  chasePriceOffset?: string;
}

export class CancelOrderAction {
  private static readonly NORMAL_BATCH_SIZE = 20;
  private static readonly ALGO_BATCH_SIZE = 10;
  private static readonly NORMAL_DELAY_MS = 150;
  private static readonly ALGO_DELAY_MS = 1500;
  private static readonly DEDUPE_TTL_MS = 5000;
  private static readonly recentBatchSignatures: Map<string, number> = new Map();

  private static hasPositiveNumber(value: unknown): boolean {
    const num = Number(value);
    return Number.isFinite(num) && num > 0;
  }

  private static getRawExecType(order: UnifiedOrder): string {
    return (order._execType || order.orderType || order.type || '').toUpperCase();
  }

  private static isBinanceOrder(order: UnifiedOrder): boolean {
    return String(order.exchange || '').toUpperCase() === 'BINANCE';
  }

  private static isBinanceTrailingStop(order: UnifiedOrder): boolean {
    const ordType = String(order.algoOrdType || order.ordType || '').toLowerCase();
    const rawExecType = CancelOrderAction.getRawExecType(order);
    return CancelOrderAction.isBinanceOrder(order) && (
      ordType === 'move_order_stop' ||
      ordType === 'trailing_stop_market' ||
      rawExecType === 'TRAILING_STOP_MARKET' ||
      CancelOrderAction.hasPositiveNumber(order.trailingDelta) ||
      CancelOrderAction.hasPositiveNumber(order.callbackRate) ||
      CancelOrderAction.hasPositiveNumber(order.priceRate)
    );
  }

  private static isBinanceConditionalTpSl(order: UnifiedOrder): boolean {
    const rawExecType = CancelOrderAction.getRawExecType(order);
    return CancelOrderAction.isBinanceOrder(order) &&
      String(order._algoType || '').toUpperCase() === 'CONDITIONAL' &&
      ['STOP', 'TAKE_PROFIT', 'STOP_MARKET', 'TAKE_PROFIT_MARKET'].includes(rawExecType);
  }

  private static extractTriggerPx(order: UnifiedOrder): string | undefined {
    const baseOrdType = String(order.ordType || order.algoOrdType || '').toLowerCase();
    const isTrailingStop = CancelOrderAction.isBinanceTrailingStop(order) ||
      (!CancelOrderAction.isBinanceOrder(order) && (
        order.activePx || order.callbackRatio || order.callbackSpread ||
        order.trailingDelta || order.callbackRate || order.activationPrice
      ));

    if (isTrailingStop) {
      return order.activePx || order.activationPrice || order.activatePrice || order.activatePx;
    } else if (baseOrdType === 'trigger' || order.ordType === 'trigger') {
      return order.triggerPx || order.triggerPrice || order.stopPrice;
    } else {
      return order.triggerPx || order.stopPrice;
    }
  }

  private static shouldSkipDuplicateBatch(signature: string): boolean {
    const now = Date.now();
    const last = this.recentBatchSignatures.get(signature);
    if (last && now - last < this.DEDUPE_TTL_MS) {
      return true;
    }
    this.recentBatchSignatures.set(signature, now);

    for (const [key, ts] of this.recentBatchSignatures.entries()) {
      if (now - ts > this.DEDUPE_TTL_MS * 2) {
        this.recentBatchSignatures.delete(key);
      }
    }

    const MAX_ENTRIES = 100;
    if (this.recentBatchSignatures.size > MAX_ENTRIES) {
      const entries = [...this.recentBatchSignatures.entries()];
      entries.sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < entries.length - MAX_ENTRIES; i++) {
        this.recentBatchSignatures.delete(entries[i][0]);
      }
    }

    return false;
  }

  private static getFilteredOrders(
    accountIdx: number,
    instId: string,
    orderTypes: string[],
    isBinance: boolean
  ): UnifiedOrder[] {
    const ordersCache = (globalThis as unknown as Record<string, {
      get: (accountIdx: number) => { data: any[] };
    }>)?.ORDERS_CACHE;
    
    const allOrders = ordersCache ? ordersCache.get(accountIdx).data : [];
    return allOrders.filter((o: UnifiedOrder) => {
      if (instId && !SymbolUtils.isSameSymbol(o.instId, instId)) return false;
      if (isPendingNewState(o)) return false;
      const type = (o.algoOrdType || o.ordType || o.type || '').toLowerCase();
      const isTrailingStop = CancelOrderAction.isBinanceTrailingStop(o);
      const resolvedType = isTrailingStop && type === 'conditional' ? 'move_order_stop' : type;
      if (orderTypes.includes(resolvedType)) return true;
      
      if (isBinance) {
        if (orderTypes.includes('oco') && o.contingencyType === 'OCO') return true;
        if (orderTypes.includes('oco') && !o.contingencyType && !!o.orderListId) return true;
        if (orderTypes.includes('conditional') && !o.orderListId && ['stop_loss_limit', 'take_profit_limit', 'stop_market', 'take_profit_market', 'stop_loss', 'take_profit'].includes(type) && !isTrailingStop) return true;
        if (orderTypes.includes('move_order_stop') && isTrailingStop) return true;
        if (orderTypes.includes('post_only') && (type === 'limit_maker' || type === 'post_only')) return true;
      }
      return false;
    });
  }

  static async execute(config: CancelOrderActionConfig, tradeService: OKXTradeService, shouldContinue?: () => boolean) {
    const accountIdx = tradeService.accountIdx;
    const instId = config.inst_id || config.cancel_inst_id || "";
    const testMode = config.cancel_test_mode === true || config.test_mode === true;
    const orderTypes = Array.isArray(config.cancel_order_types) && config.cancel_order_types.length > 0
      ? config.cancel_order_types
      : ["limit", "post_only"];
    const configId = config.id || "";

    if (!Number.isFinite(accountIdx) || accountIdx < 0) {
      LogService.logKey("cancel", 'cancel.validation.accountIdx', {}, 'error', configId);
      return;
    }

    try {
      const savedConfig = loadSavedConfig();
      const accountConfig = savedConfig.accounts?.[accountIdx];
      const isBinance = String(accountConfig?.exchange || "").toUpperCase() === 'BINANCE' || (tradeService as any).constructor.name.includes('Binance');

      let orders = CancelOrderAction.getFilteredOrders(accountIdx, instId, orderTypes, isBinance);
      
      if (orders.length === 0 && typeof (tradeService as any).getOpenOrders === 'function') {
        try {
          const remoteOrders = await (tradeService as any).getOpenOrders(instId || undefined);
          await new Promise(r => setTimeout(r, 500));
          orders = CancelOrderAction.getFilteredOrders(accountIdx, instId, orderTypes, isBinance);
        } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          LogService.logKey("cancel", 'cancel.refreshFailed', { msg: error.message }, 'warn', configId);
        }
      }

      const sideFilter = config.cancel_side || config.side || '';
      if (sideFilter) {
        orders = orders.filter((o: UnifiedOrder) => {
          const orderSide = String(o.side || '').toLowerCase();
          return orderSide === sideFilter.toLowerCase();
        });
      }

      if (orders.length === 0) {
        if (testMode) {
          LogService.logKey("cancel", 'cancel.sim.noOrders', {}, 'info', configId);
          return;
        }

        LogService.logKey("cancel", 'cancel.no.orders.found', {}, 'info', configId);
        return;
      }

      const seenOrderListIds = new Set<string>();
      const finalOrders = [];
      for (const o of orders) {
        const olid = o.orderListId ? String(o.orderListId) : undefined;
        let weight = 1;
        if (olid && olid !== "-1") {
          if (seenOrderListIds.has(olid)) continue;
          seenOrderListIds.add(olid);
          
          const cType = String(o.contingencyType || "").toUpperCase();
          if (cType === 'OTOCO') weight = 3;
          else if (cType === 'OCO' || cType === 'OTO') weight = 2;
          else weight = 2;
        }
        finalOrders.push({ ...o, weight });
      }

      const normalOrders = finalOrders.filter(o => !o.algoId);
      const algoOrders = finalOrders.filter(o => o.algoId);

      let totalSuccess = 0;
      let totalFail = 0;

      if (normalOrders.length > 0) {
        const { success, fail } = await CancelOrderAction.processBatch(
          normalOrders,
          tradeService,
          testMode,
          accountIdx,
          false,
          shouldContinue,
          configId,
          0
        );
        totalSuccess += success;
        totalFail += fail;
      }

      if (shouldContinue && !shouldContinue()) {
        LogService.logKey("cancel", 'action.complete.stopped', { op: '撤单', success: totalSuccess, fail: totalFail }, 'info', configId);
        return;
      }

      if (algoOrders.length > 0) {
        const { success, fail } = await CancelOrderAction.processBatch(
          algoOrders,
          tradeService,
          testMode,
          accountIdx,
          true,
          shouldContinue,
          configId,
          totalSuccess + totalFail
        );
        totalSuccess += success;
        totalFail += fail;
      }

      if (!testMode && totalSuccess > 0) {
        const algoTypeSet = new Set(['trigger', 'conditional', 'oco', 'chase', 'move_order_stop']);
        const rawAlgoTypes = orderTypes.filter(t => algoTypeSet.has(t));
        const hasRegular = orderTypes.some(t => !algoTypeSet.has(t));
        const instIdParts = instId.split('-');
        const cancelInstType = instId
          ? (['SWAP', 'FUTURES', 'OPTION'].includes(instIdParts[instIdParts.length - 1] || '') ? instIdParts[instIdParts.length - 1] : 'SPOT')
          : undefined;
        if (isBinance) {
          await AccountMonitor.getInstance().syncAccountOrders(accountIdx, [], cancelInstType);
        } else {
          if (rawAlgoTypes.length > 0) {
            await AccountMonitor.getInstance().syncAccountOrders(accountIdx, rawAlgoTypes, cancelInstType);
          }
          if (hasRegular && cancelInstType) {
            await AccountMonitor.getInstance().syncAccountOrders(accountIdx, [], cancelInstType);
          }
        }
      }

      LogService.logKey("cancel", 'action.complete', { op: '撤单', success: totalSuccess, fail: totalFail }, 'info', configId);
    } catch (e: unknown) {
      const error = e as Error;
      LogService.logKey("cancel", 'action.exception', { msg: error.message || String(e) }, 'error', configId);
    }
  }

  private static async processBatch(
    orders: UnifiedOrder[],
    tradeService: OKXTradeService,
    testMode: boolean,
    accountIdx: number,
    isAlgo: boolean,
    shouldContinue?: () => boolean,
    configId?: string,
    startNum: number = 0
  ): Promise<{ success: number; fail: number }> {
    const BATCH_SIZE = isAlgo ? CancelOrderAction.ALGO_BATCH_SIZE : CancelOrderAction.NORMAL_BATCH_SIZE;
    let successCount = 0;
    let failCount = 0;

    const buildCancelFailParams = (ordId: string, order: UnifiedOrder): string => {
      const s: Record<string, unknown> = { ordId };
      if (order.instId) s.instId = order.instId;
      const ordType = (order.algoOrdType || order.ordType || order.type || '').toLowerCase();
      if (ordType) s.type = CancelOrderAction.TYPE_MAP[ordType] || ordType;
      if (order.side) s.side = order.side;
      return JSON.stringify(s);
    };

    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
      if (shouldContinue && !shouldContinue()) {
        LogService.logKey("cancel", 'action.stop.signal', { op: '撤单' }, 'info', configId);
        break;
      }

      if (i > 0) {
        const delay = isAlgo ? CancelOrderAction.ALGO_DELAY_MS : CancelOrderAction.NORMAL_DELAY_MS;
        await new Promise(r => setTimeout(r, delay));
      }

      const batch = orders.slice(i, i + BATCH_SIZE);
      const batchParams: ActionCancelOrderParams[] = (isAlgo
        ? batch.map(o => ({ instId: o.instId, algoId: o.algoId, tdMode: o.tdMode }))
        : batch.map(o => {
            const orderListId = o.orderListId;
            const isVirtualOrderListId = orderListId && (
              orderListId.startsWith('OTO_') ||
              orderListId.startsWith('OTOCO_') ||
              orderListId.startsWith('OCO_')
            );
            return {
              instId: o.instId,
              ordId: o.ordId,
              tdMode: o.tdMode,
              orderListId: isVirtualOrderListId ? undefined : orderListId
            };
          })
      ) as ActionCancelOrderParams[];
      const batchIds = batch.map(o => o.algoId || o.ordId);
      const signature = createBatchSignature(accountIdx, isAlgo, batchIds);
      if (CancelOrderAction.shouldSkipDuplicateBatch(signature)) {
        LogService.logKey("cancel", 'action.duplicate.batch', { type: '撤单' }, 'warn', configId);
        continue;
      }

      if (testMode) {
        batchIds.forEach((id, idx) => {
          successCount++;
          const currentTotal = startNum + successCount + failCount;
          const order = batch[idx];

          const triggerPx = CancelOrderAction.extractTriggerPx(order);

          LogService.logKey("cancel", 'order.cancel.sim', {
            num: currentTotal,
            ordId: id,
            detail: CancelOrderAction.formatOrderLog(id, order, isAlgo),
            type: CancelOrderAction.getOrderTypeLabel(order),
            instId: String(order.instId || ''),
            triggerPx: triggerPx && triggerPx !== '0' && triggerPx !== '0.00000000' ? String(triggerPx) : '-',
            px: String(order.px || order.price || '-'),
            tpTriggerPx: String(order.tpTriggerPx || '-'),
            slTriggerPx: String(order.slTriggerPx || '-'),
          }, 'info', configId);
        });
        continue;
      }

      try {
        const res = isAlgo
          ? await tradeService.cancelBatchAlgoOrders(batchParams as any)
          : await tradeService.cancelBatchOrders(batchParams);

        if (res && (res.code === "0" || res.code === "2")) {
          batch.forEach((order, idx) => {
            const id = batchIds[idx];
            const itemData = res.data?.[idx] || {};
            const sCode = itemData.sCode;

            if (sCode === "0") {
              successCount++;
              const currentTotal = startNum + successCount + failCount;

              const triggerPx = CancelOrderAction.extractTriggerPx(order);

              const px = order.px || order.price;
              const tpTriggerPx = order.tpTriggerPx;
              const slTriggerPx = order.slTriggerPx;

              LogService.logKey("cancel", 'order.cancel.ok', {
                num: currentTotal,
                ordId: id,
                detail: CancelOrderAction.formatOrderDetails(id, order),
                type: CancelOrderAction.getOrderTypeLabel(order),
                instId: String(order.instId || ''),
                triggerPx: triggerPx && triggerPx !== '0' && triggerPx !== '0.00000000' ? String(triggerPx) : '-',
                px: px && px !== '0' && px !== '0.00000000' ? String(px) : '-',
                tpTriggerPx: tpTriggerPx && tpTriggerPx !== '0' && tpTriggerPx !== '0.00000000' ? String(tpTriggerPx) : '-',
                slTriggerPx: slTriggerPx && slTriggerPx !== '0' && slTriggerPx !== '0.00000000' ? String(slTriggerPx) : '-',
              }, 'info', configId);
            } else {
              failCount++;
              const currentTotal = startNum + successCount + failCount;
              LogService.logKey("cancel", 'order.cancel.fail', {
                num: currentTotal,
                reason: itemData.sMsg || formatApiError(res) || `batchItem.sCode=${String(sCode)}`,
                params: buildCancelFailParams(id, order)
              }, 'warn', configId);
            }
          });
        } else {
          batch.forEach((order, idx) => {
            const id = batchIds[idx];
            const weight = order.weight || 1;
            for (let w = 0; w < weight; w++) {
              failCount++;
              const currentTotal = successCount + failCount;
              LogService.logKey("cancel", 'order.cancel.fail', { num: currentTotal, reason: formatApiError(res), params: buildCancelFailParams(id, order) }, 'warn', configId);
            }
          });
        }
      } catch (err: unknown) {
        const error = err as Error;
        batch.forEach((order, idx) => {
          const id = batchIds[idx];
          const weight = order.weight || 1;
          for (let w = 0; w < weight; w++) {
            failCount++;
            const currentTotal = successCount + failCount;
            LogService.logKey("cancel", 'order.cancel.fail', { num: currentTotal, reason: error.message || String(err), params: buildCancelFailParams(id, order) }, 'error', configId);
          }
        });
      }
    }

    return { success: successCount, fail: failCount };
  }

  private static readonly TYPE_MAP: Record<string, string> = {
    limit: "限价委托",
    market: "市价委托",
    post_only: "限价-Post only",
    fok: "限价-FOK",
    ioc: "限价-IOC",
    conditional: "单向止盈止损",
    oco: "双向止盈止损",
    chase: "追逐限价",
    trigger: "计划委托",
    move_order_stop: "移动止盈止损",
    limit_maker: "限价-Post only",
    stop_loss_limit: "止损限价",
    take_profit_limit: "止盈限价",
    stop_market: "止损市价",
    take_profit_market: "止盈市价",
    stop_loss: "止损委托",
    take_profit: "止盈委托",
    trailing_stop_market: "跟踪止损市价",
  };

  static getOrderTypeLabel(order: UnifiedOrder): string {
    let ordType = (order.algoOrdType || order.ordType || order.type || "").toLowerCase();
    let displayType = CancelOrderAction.TYPE_MAP[ordType] || ordType;

    if (order.otoGroupType === 'OTO' || order.otoGroupType === 'OTOCO') {
      return "限价委托";
    }

    if (CancelOrderAction.isBinanceTrailingStop(order) || (!CancelOrderAction.isBinanceOrder(order) && (order.trailingDelta || order.callbackRate !== undefined || order.activationPrice !== undefined))) {
      displayType = "移动止盈止损";
    } else if (CancelOrderAction.isBinanceConditionalTpSl(order)) {
      displayType = "单向止盈止损";
    } else if (order.orderListId && String(order.orderListId) !== "-1") {
      const orderListIdStr = String(order.orderListId);
      const isVirtualOrderListId = orderListIdStr.startsWith('OTO_') || orderListIdStr.startsWith('OTOCO_') || orderListIdStr.startsWith('OCO_');
      const isRealOrderListId = !isVirtualOrderListId && /^\d+$/.test(orderListIdStr);

      if (order.contingencyType === "OCO") {
        displayType = "双向止盈止损";
      } else if (order.contingencyType === "OTO" || order.contingencyType === "OTOCO") {
        displayType = "限价委托";
      } else if (isVirtualOrderListId) {
        displayType = "限价委托";
      } else if (isRealOrderListId) {
        if (ordType === 'limit') {
          displayType = "限价委托";
        } else {
          displayType = "双向止盈止损";
        }
      } else {
        displayType = "双向止盈止损";
      }
    } else if (["stop_loss_limit", "take_profit_limit", "stop_market", "take_profit_market", "stop_loss", "take_profit"].includes(ordType)) {
      displayType = "单向止盈止损";
    }

    return displayType;
  }

  private static formatOrderDetails(orderId: string, order: UnifiedOrder): string {
    let ordType = (order.algoOrdType || order.ordType || order.type || "").toLowerCase();
    const instId = order.instId || "";

    const sideMap: Record<string, string> = { buy: "买", sell: "卖" };
    const sideText = sideMap[order.side] || order.side || "-";

    let displayType = CancelOrderAction.TYPE_MAP[ordType] || ordType;
    let isOco = false;

    const formatField = (label: string, value: unknown): string => {
      if (value === undefined || value === null || value === '' || value === '0' || value === '0.00000000') return '';
      const strVal = String(value);
      const num = parseFloat(strVal);
      const displayVal = !isNaN(num) && num !== 0 ? num.toString() : strVal;
      return `, ${label}: ${displayVal}`;
    };

    const isBinanceConditionalTpSl = CancelOrderAction.isBinanceConditionalTpSl(order);
    const isBinanceTrailingStop = CancelOrderAction.isBinanceTrailingStop(order);

    if (isBinanceTrailingStop || (!CancelOrderAction.isBinanceOrder(order) && !isBinanceConditionalTpSl && (order.trailingDelta || order.callbackRate !== undefined || order.priceRate !== undefined))) {
      displayType = "移动止盈止损";
      ordType = "move_order_stop";
    } else if (isBinanceConditionalTpSl) {
      displayType = "单向止盈止损";
      ordType = "conditional";
    } else if (order.orderListId && String(order.orderListId) !== "-1") {
      isOco = true;
      const isBinanceOco = order.contingencyType === "OCO" || (!order.contingencyType && order.orderListId);
      const isBinanceOto = order.contingencyType === "OTO" || order.contingencyType === "OTOCO";

      if (isBinanceOco) {
        displayType = "双向止盈止损";
        ordType = "oco";
      } else if (isBinanceOto) {
        displayType = "限价委托";
        ordType = "limit";
      } else {
        displayType = "双向止盈止损";
        ordType = "oco";
      }
    } else if (["stop_loss_limit", "take_profit_limit", "stop_market", "take_profit_market", "stop_loss", "take_profit"].includes(ordType)) {
      displayType = "单向止盈止损";
      ordType = "conditional";
    }

    const displayOrderId = isOco ? (order.orderListId || orderId) : orderId;

    if (order.algoId || ["conditional", "oco", "trigger", "chase", "move_order_stop"].includes(ordType)) {
      switch (ordType) {
        case "conditional":
          return `订单ID: ${displayOrderId}, 类型: ${displayType}, 交易对: ${instId}${formatField('触发价', order.triggerPx || order.stopPrice)}${formatField('委托价', order.px || order.price)}${formatField('止盈触发价', order.tpTriggerPx)}${formatField('止损触发价', order.slTriggerPx)}`;
        case "oco":
          return `订单ID: ${displayOrderId}, 类型: ${displayType}, 交易对: ${instId}${formatField('触发价', order.triggerPx || order.stopPrice)}${formatField('止盈触发价', order.tpTriggerPx)}${formatField('止损触发价', order.slTriggerPx)}`;
        case "trigger":
          return `订单ID: ${displayOrderId}, 类型: ${displayType}, 交易对: ${instId}${formatField('触发价', order.triggerPx)}${formatField('委托价', order.px)}, 方向: ${sideText}`;
        case "chase":
          return `订单ID: ${displayOrderId}, 类型: ${displayType}, 交易对: ${instId}${formatField('目标价', order.px)}${formatField('追逐偏移', order.chasePriceOffset)}, 方向: ${sideText}`;
        case "move_order_stop": {
          const triggerPx = order.activePx || order.triggerPx;
          const callbackRatio = order.callbackRatio ? parseFloat(order.callbackRatio).toString() : undefined;
          const callbackSpread = order.callbackSpread ? parseFloat(order.callbackSpread).toString() : undefined;
          return `订单ID: ${displayOrderId}, 类型: ${displayType}, 交易对: ${instId}${formatField('触发价', triggerPx)}${formatField('回调比例', callbackRatio)}${formatField('回调价距', callbackSpread)}`;
        }
        default:
          return `订单ID: ${displayOrderId}, 类型: ${displayType}, 交易对: ${instId}${formatField('委托价', order.px)}${formatField('数量', order.sz)}, 方向: ${sideText}`;
      }
    }

    switch (ordType) {
      case "limit":
      case "limit_maker":
        return `订单ID: ${displayOrderId}, 类型: ${displayType}, 交易对: ${instId}${formatField('委托价', order.px)}${formatField('数量', order.sz)}, 方向: ${sideText}`;
      case "post_only":
        return `订单ID: ${displayOrderId}, 类型: ${displayType}, 交易对: ${instId}${formatField('委托价', order.px)}${formatField('数量', order.sz)}`;
      case "market":
        return `订单ID: ${displayOrderId}, 类型: ${displayType}, 交易对: ${instId}${formatField('数量', order.sz)}, 方向: ${sideText}`;
      default:
        return `订单ID: ${displayOrderId}, 类型: ${displayType || "普通"}, 交易对: ${instId}${formatField('委托价', order.px)}`;
    }
  }

  static formatOrderLog(orderId: string, order: UnifiedOrder, isAlgo: boolean): string {
    const typeLabel = isAlgo ? "算法" : "普通";
    return `模拟撤${typeLabel}单成功: ${CancelOrderAction.formatOrderDetails(orderId, order)}`;
  }
}
