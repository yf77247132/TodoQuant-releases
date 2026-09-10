
import { OKXTradeService } from "../../services/okxTradeService.ts";
import { LogService } from "../../services/logService.ts";
import { AccountMonitor } from "../../services/AccountMonitor.ts";
import { loadSavedConfig } from "../../services/configService.ts";
import { SymbolUtils } from "../../lib/symbolUtils.ts";
import { createChildIdempotencyKey, createRequestIdempotencyKey } from "../../lib/idempotency.ts";
import { AmendOrderActionConfig, OrderWithAlgo, TPAlgoOrder } from "../../types/blocks.ts";
import type { ActionAmendOrderParams, ActionAttachAlgoOrd } from "../../types/blocks.ts";
import { OKXApiResponse } from "../../types/okx.ts";
import { translateAmendDetail } from "../../lib/logTemplates.ts";
import { formatApiError } from "../../lib/apiErrorFormatter.ts";
import { isPendingNewState } from "../../lib/orderStates.ts";
import { evaluateFormula } from "../../lib/priceFormula.ts";
import { InstrumentService } from "../../services/instrumentService.ts";

export interface ComputeSizeContext {
  marketPrice?: number;
  orderPrice?: number;
  positionSize?: number;
  incrementIdx?: number;
  ctVal?: number;
  lotSz?: number;
}

interface UnifiedOrder extends OrderWithAlgo {
  exchange?: string;
  type?: string;
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
}

export class AmendOrderAction {
  private static hasPositiveNumber(value: unknown): boolean {
    const num = Number(value);
    return Number.isFinite(num) && num > 0;
  }

  private static applyIncrement(originalValue: number, incrementStr: string): number {
    const trimmed = incrementStr.trim();
    if (trimmed.includes('%')) {
      const percentValue = parseFloat(trimmed.replace(/%/g, '')) / 100;
      if (!Number.isFinite(percentValue)) return originalValue;
      return originalValue * (1 + percentValue);
    } else {
      const increment = parseFloat(trimmed);
      if (!Number.isFinite(increment)) return originalValue;
      return originalValue + increment;
    }
  }

  private static applyIncrementRounded(originalValue: number, incrementStr: string): number {
    return parseFloat(AmendOrderAction.applyIncrement(originalValue, incrementStr).toFixed(8));
  }

  private static parseIncrement(incrementStr: string): number {
    const s = String(incrementStr ?? '');
    return parseFloat(s.replace('%', '')) / (s.includes('%') ? 100 : 1);
  }

  private static isDisabledIncrement(incrementValue: number): boolean {
    return Math.abs(incrementValue + 1) < 1e-10 || Math.abs(incrementValue + 0.01) < 1e-10;
  }

  private static calcDirectionalPx(
    basePx: number, incrementValue: number, isPercent: boolean, isBuy: boolean, kind: 'tp' | 'sl'
  ): { triggerPx: number; ordPx: number } {
    const signed = kind === 'tp'
      ? (isBuy ? incrementValue : -incrementValue)
      : (isBuy ? -incrementValue : incrementValue);
    const px = isPercent
      ? parseFloat((basePx * (1 + signed)).toFixed(8))
      : parseFloat((basePx + signed).toFixed(8));
    return { triggerPx: px, ordPx: px };
  }

  static computeNewSize(originalValue: number, inputStr: string, ctx?: ComputeSizeContext): number {
    const trimmed = inputStr.trim();
    if (!trimmed) return NaN;

    if (trimmed.startsWith('=') && trimmed.length > 1) {
      const variables: Record<string, number> = { SZ: originalValue };
      if (ctx) {
        if (ctx.marketPrice !== undefined && Number.isFinite(ctx.marketPrice)) variables.M = ctx.marketPrice;
        if (ctx.orderPrice !== undefined && Number.isFinite(ctx.orderPrice)) variables.O = ctx.orderPrice;
        if (ctx.positionSize !== undefined && Number.isFinite(ctx.positionSize)) variables.S = ctx.positionSize;
        if (ctx.incrementIdx !== undefined && Number.isFinite(ctx.incrementIdx)) variables.N = ctx.incrementIdx;
        if (ctx.ctVal !== undefined && Number.isFinite(ctx.ctVal)) { variables.CV = ctx.ctVal; variables.cv = ctx.ctVal; }
        if (ctx.lotSz !== undefined && Number.isFinite(ctx.lotSz)) { variables.LS = ctx.lotSz; variables.ls = ctx.lotSz; }
      }
      const result = evaluateFormula(trimmed, variables);
      if (result.error || result.result === null || !Number.isFinite(result.result)) {
        return NaN;
      }
      return parseFloat(result.result.toFixed(8));
    }

    if (trimmed.startsWith('+') || trimmed.startsWith('-') || trimmed.includes('%')) {
      LogService.warn("amend", `改单数量输入含非纯数字字符(% 或 +/- 前缀): "${inputStr}"，已跳过该订单（请改用公式，如 =sz*110% 或 =sz+4）`);
      return NaN;
    }
    const absValue = parseFloat(trimmed);
    if (!Number.isFinite(absValue) || absValue < 0) return NaN;
    return parseFloat(absValue.toFixed(8));
  }

  private static readonly OKX_SUCCESS_CODE = '0';
  private static readonly OKX_ACCEPTED_CODE = '2';

  static async execute(config: AmendOrderActionConfig, tradeService: OKXTradeService) {
    const accountIdx = tradeService.accountIdx;
    const instId = config.amend_inst_id || config.inst_id || "";
    const tpPxIncrementStr = config.tp_px_increment || "0";
    const slPxIncrementStr = config.sl_px_increment || "0";
    const amendOrderType = config.amend_order_type || "trigger";
    const newContractSize = config.new_contract_size || "1";
    const testMode = config.amend_test_mode === true || config.test_mode === true;
    
    const hasTpIncrement = tpPxIncrementStr !== "0" && tpPxIncrementStr.trim() !== "";
    const hasSlIncrement = slPxIncrementStr !== "0" && slPxIncrementStr.trim() !== "";

    const configTag = config.name || `配置${accountIdx}`;
    const configId = config.id || '';
    const requestKey = createRequestIdempotencyKey("amend", configId || configTag);

    const ordTypeMap: Record<string, string> = {
      'trigger': '计划委托',
      'conditional': '单向止盈止损',
      'oco': '双向止盈止损',
      'limit': '限价委托',
      'move_order_stop': '移动止盈止损'
    };
    const ordTypeText = ordTypeMap[amendOrderType] || amendOrderType;

    try {
      let orders: OrderWithAlgo[] = [];
      const savedConfig = loadSavedConfig();
      const accountConfig = savedConfig.accounts?.[accountIdx];
      const isBinance = String(accountConfig?.exchange || "").toUpperCase() === 'BINANCE' || (tradeService as any).exchangeType === "BINANCE";

      const matchOrderType = (order: UnifiedOrder, targetType: string): boolean => {
        if (isPendingNewState(order)) return false;
        const oType = ((order.algoOrdType || order.ordType || '').toLowerCase());
        if (oType === targetType.toLowerCase()) return true;
        
        if (isBinance) {
          if (targetType === 'conditional') {
            return !order.orderListId && AmendOrderAction.hasPositiveNumber(order.trailingDelta) === false && (
              oType === 'stop_loss_limit' || oType === 'take_profit_limit' ||
              oType === 'stop_market' || oType === 'take_profit_market' ||
              oType === 'stop_loss' || oType === 'take_profit');
          }
          if (targetType === 'oco') {
            if (order.contingencyType === 'OCO') return true;
            if (!order.contingencyType && !!order.orderListId) return true;
            return false;
          }
          if (targetType === 'move_order_stop') {
            const exchangeType = String(order.type || '').toLowerCase();
            const baseType = String(order.ordType || order.algoOrdType || '').toLowerCase();
            const trailingDeltaNum = Number(order.trailingDelta);
            const hasTrailingDelta = Number.isFinite(trailingDeltaNum) && trailingDeltaNum > 0;
            const hasTrailingTime = !!order.trailingTime;
            const isBinanceConditionalTpSl = [
              'stop_loss_limit',
              'take_profit_limit',
              'stop_market',
              'take_profit_market',
              'stop_loss',
              'take_profit',
              'stop',
              'take_profit'
            ].includes(baseType) || [
              'STOP_LOSS_LIMIT',
              'TAKE_PROFIT_LIMIT',
              'STOP_MARKET',
              'TAKE_PROFIT_MARKET',
              'STOP_LOSS',
              'TAKE_PROFIT',
              'STOP'
            ].includes(String(order.type || '').toUpperCase());

            const tdMode = String(order.tdMode || '').toLowerCase();
            const isMarginMode = tdMode === 'cross' || tdMode === 'isolated';
            const pxNum = Number(order.px);
            const hasZeroPx = !Number.isFinite(pxNum) || pxNum === 0;
            const activationNum = Number(order.activationPrice ?? order.activatePrice);
            const hasValidActivation = Number.isFinite(activationNum) && activationNum > 0;

            if (String(order.exchange || '').toUpperCase() === 'BINANCE' && (hasTrailingDelta || hasTrailingTime)) return true;
            if (!isBinanceConditionalTpSl && !!order.trailingDelta) return true;
            if (
              !isBinanceConditionalTpSl &&
              String(order.exchange || '').toUpperCase() === 'BINANCE' &&
              isMarginMode &&
              hasValidActivation &&
              hasZeroPx
            ) return true;

            if (
              !isBinanceConditionalTpSl &&
              String(order.exchange || '').toUpperCase() === 'BINANCE' &&
              tdMode === 'cash' &&
              hasValidActivation &&
              hasZeroPx
            ) return true;

            return oType === 'move_order_stop'
              || oType === 'trailing_stop_market'
              || exchangeType === 'trailing_stop_market';
          }
          if (targetType === 'post_only') {
            return oType === 'limit_maker';
          }
        }
        return false;
      };

      orders = AmendOrderAction.fetchLocalOrders(accountIdx, instId, amendOrderType, matchOrderType, testMode);

      const tpSlType = config.tp_sl_type || 'tp_sl';
      if (tpSlType === 'move_stop' && amendOrderType === 'trigger') {
        orders = orders.filter((order: OrderWithAlgo) => {
          const attachAlgoOrds = order.attachAlgoOrds || [];
          const hasMoveStop = attachAlgoOrds.some((a: TPAlgoOrder) => a.callbackRatio || a.callbackSpread || a.activePx);
          return hasMoveStop;
        });
      } else if (tpSlType === 'tp_sl' && amendOrderType === 'trigger') {
        orders = orders.filter((order: OrderWithAlgo) => {
          const attachAlgoOrds = order.attachAlgoOrds || [];
          const hasTpSl = attachAlgoOrds.some((a: TPAlgoOrder) => a.tpTriggerPx || a.tpOrdPx || a.slTriggerPx || a.slOrdPx);
          const hasMoveStop = attachAlgoOrds.some((a: TPAlgoOrder) => a.callbackRatio || a.callbackSpread || a.activePx);
          return hasTpSl && !hasMoveStop;
        });
      }

      if (testMode && orders.length === 0) {
        LogService.logKey("amend", 'amend.sim.noOrders', { ordType: ordTypeText }, 'info', configId);
        return;
      }

      let ordersToProcess = orders;
      const linkedOrderIds = new Set<string>();

      if (ordersToProcess.length === 0 && typeof (tradeService as any).getOpenOrders === 'function') {
        try {
          const isAlgo = amendOrderType !== 'limit';
          const remoteOrders = isAlgo && typeof (tradeService as any).getPendingAlgoOrders === 'function'
            ? await (tradeService as any).getPendingAlgoOrders(instId || undefined, amendOrderType)
            : await (tradeService as any).getOpenOrders(instId || undefined);
          const remoteRows = (Array.isArray(remoteOrders) ? remoteOrders : []) as OrderWithAlgo[];
          if (amendOrderType === 'limit') {
            const mainOrders = remoteRows.filter((o: OrderWithAlgo) => {
              if (instId && !SymbolUtils.isSameSymbol(o.instId, instId)) return false;
              if (isPendingNewState(o)) return false;
              return ['limit', 'post_only', 'limit_maker'].includes(o.ordType);
            });
            ordersToProcess = [...mainOrders];
          } else {
            ordersToProcess = remoteRows.filter((o: UnifiedOrder) => {
              if (instId && !SymbolUtils.isSameSymbol(o.instId, instId)) return false;
              return matchOrderType(o, amendOrderType);
            });
            LogService.logKey("amend", 'amend.remote.orders.matched', { remote: remoteRows.length, type: amendOrderType, remaining: ordersToProcess.length }, 'info', configId);
            if (ordersToProcess.length === 0 && remoteRows.length > 0) {
            LogService.addLog("amend", `前几个订单信息: ${JSON.stringify(remoteRows.slice(0, 3).map((o: UnifiedOrder) => ({ ordId: o.ordId, ordType: o.ordType, algoOrdType: o.algoOrdType, type: o.type, callbackRate: o.callbackRate, priceRate: o.priceRate, activationPrice: o.activationPrice, trailingDelta: o.trailingDelta, trailingTime: o.trailingTime, orderListId: o.orderListId })))}`, 'info', undefined, configId);
          }
        }
        } catch (err: unknown) {
          if (instId) {
            LogService.logKey("amend", 'amend.query.failed', { instId, msg: err instanceof Error ? err.message : String(err) }, 'warn', configId);
          } else {
            throw err;
          }
        }
      } else if (isBinance && ordersToProcess.length > 0) {
        const mainOrders = ordersToProcess.filter(o => ['limit', 'post_only', 'limit_maker'].includes(o.ordType));
        const listIds = new Set(mainOrders.map(o => o.orderListId).filter(id => id));
        if (listIds.size > 0) {
          ordersToProcess.forEach(o => {
            if (o.orderListId && listIds.has(o.orderListId) && !mainOrders.find(m => m.ordId === o.ordId)) {
              linkedOrderIds.add(o.ordId);
            }
          });
        }
      }

      if (ordersToProcess.length === 0) {
        LogService.logKey("amend", 'amend.no.orders.found', { ordType: ordTypeText }, 'info', configId);
        return;
      }

      const isAlgo = !isBinance && amendOrderType !== 'limit';
      const BATCH_SIZE = isAlgo ? 1 : 10;
      let successCount = 0;
      let failCount = 0;
      const processedBinanceOcoLists = new Set<string>();

      for (let i = 0; i < ordersToProcess.length; i += BATCH_SIZE) {
        const batch = ordersToProcess.slice(i, i + BATCH_SIZE);
        
        const batchParams: ActionAmendOrderParams[] = [];
        const batchLogInfos: string[] = [];
        const batchOrderIds: string[] = [];

        batch.forEach((order: OrderWithAlgo, batchIdx: number) => {
          if (isBinance && amendOrderType === 'oco' && order.orderListId) {
            if (processedBinanceOcoLists.has(order.orderListId)) {
              return;
            }
            processedBinanceOcoLists.add(order.orderListId);
          }

          const params: ActionAmendOrderParams = {
            instId: order.instId,
          };
          if (order.tdMode) params.tdMode = order.tdMode;
          if (order.side) params.side = order.side;
          params.reqId = createChildIdempotencyKey(requestKey, i + batchParams.length);
          if (order.algoId) params.algoId = order.algoId;
          if (order.ordId) params.ordId = order.ordId;

          let logInfo = "";

          if (isBinance && amendOrderType === 'oco' && order.orderListId) {
            const ocoLegs = batch.filter(o => o.orderListId === order.orderListId);
            const tpLeg = ocoLegs.find(o => String(o.type || o.ordType || "").toUpperCase() === "LIMIT_MAKER");
            const slLeg = ocoLegs.find(o => {
              const t = String(o.type || o.ordType || "").toUpperCase();
              return t === "STOP_LOSS_LIMIT" || t === "STOP_LOSS";
            });
            
            if (tpLeg && slLeg && (hasTpIncrement || hasSlIncrement)) {
              const baseTpPrice = parseFloat(tpLeg.px || tpLeg.price || tpLeg.ordPx || "0");
              const baseSlTrigger = parseFloat(slLeg.triggerPx || slLeg.stopPrice || "0");
              const baseSlLimit = parseFloat(slLeg.px || slLeg.price || slLeg.ordPx || "0");
              
              const newTpPrice = hasTpIncrement 
                ? AmendOrderAction.applyIncrementRounded(baseTpPrice, tpPxIncrementStr)
                : baseTpPrice;
              const newSlTrigger = hasSlIncrement 
                ? AmendOrderAction.applyIncrementRounded(baseSlTrigger, slPxIncrementStr)
                : baseSlTrigger;
              const newSlLimit = hasSlIncrement 
                ? AmendOrderAction.applyIncrementRounded(baseSlLimit, slPxIncrementStr)
                : baseSlLimit;
              
              if (hasTpIncrement) {
                logInfo += `止盈价: ${baseTpPrice}->${newTpPrice}`;
              }
              if (hasSlIncrement) {
                if (logInfo) logInfo += ", ";
                logInfo += `止损价: ${baseSlTrigger}->${newSlTrigger}`;
              }
            }
          }

          if (amendOrderType === 'trigger') {
            const triggerIncrementStr = config.trigger_px_increment || "0";
            const tpIncrementStr = config.tp_ord_px_increment || "-1";
            const slIncrementStr = config.sl_ord_px_increment || "-1";
            const currentInstId = order.instId || instId;
            const isSpot = !currentInstId.endsWith("-SWAP") && !currentInstId.endsWith("-FUTURES") && currentInstId.split("-").length === 2;
            const originalTriggerPx = parseFloat(order.triggerPx || order.ordPx || "0");
            const originalOrdPx = parseFloat(order.ordPx || order.triggerPx || "0");
            const side = order.side || 'buy';
            const isBuy = side.toLowerCase() === 'buy';
            
            const isPercentTrigger = triggerIncrementStr.includes('%');
            const triggerIncrementValue = AmendOrderAction.parseIncrement(triggerIncrementStr);
            
            if (triggerIncrementValue !== 0) {
              let newTriggerPx: number;
              let newOrdPx: number;
              if (isPercentTrigger) {
                newTriggerPx = parseFloat((originalTriggerPx * (1 + triggerIncrementValue)).toFixed(8));
                newOrdPx = parseFloat((originalOrdPx * (1 + triggerIncrementValue)).toFixed(8));
              } else {
                newTriggerPx = parseFloat((originalTriggerPx + triggerIncrementValue).toFixed(8));
                newOrdPx = parseFloat((originalOrdPx + triggerIncrementValue).toFixed(8));
              }
              params.newTriggerPx = newTriggerPx.toString();
              params.newOrdPx = newOrdPx.toString();
              logInfo += `触发价: ${originalTriggerPx}->${newTriggerPx}, 委托价: ${originalOrdPx}->${newOrdPx}`;
            }

            const attachAlgoOrds: TPAlgoOrder[] = order.attachAlgoOrds || [];
            const tpAlgo = attachAlgoOrds.find((a: TPAlgoOrder) => a.tpOrdPx || a.tpTriggerPx);
            const slAlgo = attachAlgoOrds.find((a: TPAlgoOrder) => a.slOrdPx || a.slTriggerPx);
            const moveStopAlgo = attachAlgoOrds.find((a: TPAlgoOrder) => a.callbackRatio || a.callbackSpread || a.activePx);

            const tpSlType = config.tp_sl_type || 'tp_sl';
            const isOkxMoveStop = !isBinance && tpSlType === 'move_stop';

            if (isOkxMoveStop && moveStopAlgo) {
              const attachedAlgo: ActionAttachAlgoOrd = {};
              if (moveStopAlgo.attachAlgoId) {
                attachedAlgo.attachAlgoId = moveStopAlgo.attachAlgoId;
              } else if (moveStopAlgo.attachAlgoClOrdId && moveStopAlgo.attachAlgoClOrdId !== '') {
                attachedAlgo.attachAlgoClOrdId = moveStopAlgo.attachAlgoClOrdId;
              }

              const callbackRatioSpreadStr = config.callback_ratio_spread || "0";
              const activePxStr = config.active_px || "";

              if (callbackRatioSpreadStr !== "0" && callbackRatioSpreadStr.trim() !== "") {
                const isPercent = callbackRatioSpreadStr.includes('%');
                if (isPercent) {
                  const originalRatio = parseFloat(moveStopAlgo.callbackRatio || "0");
                  const incrementPercent = parseFloat(callbackRatioSpreadStr.replace('%', '')) / 100;
                  const newRatio = parseFloat((originalRatio + incrementPercent).toFixed(8));
                  attachedAlgo.newCallbackRatio = newRatio.toString();
                  if (logInfo) logInfo += ", ";
                  logInfo += `回调幅度比例: ${(originalRatio * 100).toFixed(2)}%->${(newRatio * 100).toFixed(2)}%`;
                } else {
                  const originalSpread = parseFloat(moveStopAlgo.callbackSpread || "0");
                  const increment = parseFloat(callbackRatioSpreadStr);
                  const newSpread = parseFloat((originalSpread + increment).toFixed(8));
                  attachedAlgo.newCallbackSpread = newSpread.toString();
                  if (logInfo) logInfo += ", ";
                  logInfo += `回调幅度价距: ${originalSpread}->${newSpread}`;
                }
              }

              if (activePxStr.trim() !== "") {
                const originalActivePx = parseFloat(moveStopAlgo.activePx || "0");
                if (originalActivePx > 0) {
                  const newActivePx = AmendOrderAction.applyIncrementRounded(originalActivePx, activePxStr);
                  attachedAlgo.newActivePx = newActivePx.toString();
                  if (logInfo) logInfo += ", ";
                  logInfo += `激活价格: ${originalActivePx}->${newActivePx}`;
                }
              }

              if (slAlgo) {
                const slIncrementStr = config.sl_ord_px_increment || "-1";
                const slIncrementValue = AmendOrderAction.parseIncrement(slIncrementStr);
                const isSlDisabled = AmendOrderAction.isDisabledIncrement(slIncrementValue);
                if (!isSlDisabled) {
                  const baseTriggerPx = params.newTriggerPx ? parseFloat(params.newTriggerPx) : originalTriggerPx;
                  const originalSlTriggerPx = parseFloat(slAlgo.slTriggerPx || slAlgo.slOrdPx || "0");
                  const originalSlOrdPx = parseFloat(slAlgo.slOrdPx || slAlgo.slTriggerPx || "0");
                  const { triggerPx: newSlTriggerPx, ordPx: newSlOrdPx } =
                    AmendOrderAction.calcDirectionalPx(baseTriggerPx, slIncrementValue, slIncrementStr.includes('%'), isBuy, 'sl');
                  attachedAlgo.newSlTriggerPx = newSlTriggerPx.toString();
                  attachedAlgo.newSlOrdPx = newSlOrdPx.toString();
                  if (!isSpot) {
                    attachedAlgo.newSlTriggerPxType = 'last';
                  }
                  if (logInfo) logInfo += ", ";
                  logInfo += `止损价: ${originalSlTriggerPx}->${newSlTriggerPx}`;
                }
              }

              if (Object.keys(attachedAlgo).length > (attachedAlgo.attachAlgoId || attachedAlgo.attachAlgoClOrdId ? 1 : 0)) {
                params.attachAlgoOrds = [attachedAlgo];
              }
            } else if (tpAlgo || slAlgo) {
              const baseTriggerPx = params.newTriggerPx ? parseFloat(params.newTriggerPx) : originalTriggerPx;
              const attachedAlgo: ActionAttachAlgoOrd = {};
                
              const existingAttach = tpAlgo || slAlgo;
              if (existingAttach?.attachAlgoId) {
                attachedAlgo.attachAlgoId = existingAttach.attachAlgoId;
              } else if (existingAttach?.attachAlgoClOrdId && existingAttach.attachAlgoClOrdId !== '') {
                attachedAlgo.attachAlgoClOrdId = existingAttach.attachAlgoClOrdId;
              }

              const isPercentTp = tpIncrementStr.includes('%');
              const tpIncrementValue = AmendOrderAction.parseIncrement(tpIncrementStr);
              const isPercentSl = slIncrementStr.includes('%');
              const slIncrementValue = AmendOrderAction.parseIncrement(slIncrementStr);
              const isTpDisabled = AmendOrderAction.isDisabledIncrement(tpIncrementValue);
              const isSlDisabled = AmendOrderAction.isDisabledIncrement(slIncrementValue);

              if (tpAlgo && !isTpDisabled) {
                const originalTpTriggerPx = parseFloat(tpAlgo.tpTriggerPx || tpAlgo.tpOrdPx || "0");
                const originalTpOrdPx = parseFloat(tpAlgo.tpOrdPx || tpAlgo.tpTriggerPx || "0");

                const { triggerPx: newTpTriggerPx, ordPx: newTpOrdPx } =
                  AmendOrderAction.calcDirectionalPx(baseTriggerPx, tpIncrementValue, isPercentTp, isBuy, 'tp');

                attachedAlgo.newTpTriggerPx = newTpTriggerPx.toString();
                attachedAlgo.newTpOrdPx = newTpOrdPx.toString();
                if (!isSpot) {
                  attachedAlgo.newTpTriggerPxType = 'last';
                }
                
                if (logInfo) logInfo += ", ";
                logInfo += `止盈价: ${originalTpTriggerPx}->${newTpTriggerPx}`;
              }

              if (slAlgo && !isSlDisabled) {
                const originalSlTriggerPx = parseFloat(slAlgo.slTriggerPx || slAlgo.slOrdPx || "0");
                const originalSlOrdPx = parseFloat(slAlgo.slOrdPx || slAlgo.slTriggerPx || "0");

                const { triggerPx: newSlTriggerPx, ordPx: newSlOrdPx } =
                  AmendOrderAction.calcDirectionalPx(baseTriggerPx, slIncrementValue, isPercentSl, isBuy, 'sl');

                attachedAlgo.newSlTriggerPx = newSlTriggerPx.toString();
                attachedAlgo.newSlOrdPx = newSlOrdPx.toString();
                if (!isSpot) {
                  attachedAlgo.newSlTriggerPxType = 'last';
                }
                
                if (logInfo) logInfo += ", ";
                logInfo += `止损价: ${originalSlTriggerPx}->${newSlTriggerPx}`;
              } else if (!slAlgo && !isSlDisabled) {
                if (logInfo) logInfo += ", ";
                logInfo += `止损: 无 (该订单未设置止损)`;
              }

              if (Object.keys(attachedAlgo).length > (attachedAlgo.attachAlgoId || attachedAlgo.attachAlgoClOrdId ? 1 : 0)) {
                params.attachAlgoOrds = [attachedAlgo];
              }
            }

            const tpIncrementForBinance = AmendOrderAction.parseIncrement(tpIncrementStr);
            const slIncrementForBinance = AmendOrderAction.parseIncrement(slIncrementStr);
            const isTpBinanceDisabled = Number.isNaN(tpIncrementForBinance) || AmendOrderAction.isDisabledIncrement(tpIncrementForBinance);
            const isSlBinanceDisabled = Number.isNaN(slIncrementForBinance) || AmendOrderAction.isDisabledIncrement(slIncrementForBinance);
            if (isBinance && !isTpBinanceDisabled) {
              params.tpIncrement = tpIncrementForBinance;
            }
            if (isBinance && !isSlBinanceDisabled) {
              params.slIncrement = slIncrementForBinance;
            }
          } else if (amendOrderType === 'limit') {
            const pxIncrementStr = config.px_increment || "0";
            const originalPx = parseFloat(order.px || order.ordPx || "0");
            const currentInstId = order.instId || instId;
            const isSpot = !currentInstId.endsWith("-SWAP") && !currentInstId.endsWith("-FUTURES") && currentInstId.split("-").length === 2;
            const side = order.side || 'buy';
            const isBuy = side.toLowerCase() === 'buy';
            
            if (pxIncrementStr !== "0") {
              const newPx = AmendOrderAction.applyIncrementRounded(originalPx, pxIncrementStr);
              params.newPx = newPx.toString();
              logInfo += `委托价: ${originalPx}->${newPx}`;

              if (order.triggerPx) {
                const originalTriggerPx = parseFloat(order.triggerPx || "0");
                if (originalTriggerPx > 0) {
                  const newTriggerPx = AmendOrderAction.applyIncrementRounded(originalTriggerPx, pxIncrementStr);
                  params.newTriggerPx = newTriggerPx.toString();
                  if (logInfo) logInfo += ", ";
                  logInfo += `触发价: ${originalTriggerPx}->${newTriggerPx}`;
                }
              }
            }

            const existingAttach = order.attachAlgoOrds?.[0];
            const attachedAlgo: ActionAttachAlgoOrd = {};

            const tpSlType = config.tp_sl_type || 'tp_sl';
            const isOkxMoveStop = !isBinance && tpSlType === 'move_stop';

            const shouldSkipAttach = isBinance && !!order.orderListId && isSpot;
            if (existingAttach && !shouldSkipAttach) {
              if (existingAttach?.attachAlgoId) {
                attachedAlgo.attachAlgoId = existingAttach.attachAlgoId;
              } else if (existingAttach?.attachAlgoClOrdId && existingAttach.attachAlgoClOrdId !== '') {
                attachedAlgo.attachAlgoClOrdId = existingAttach.attachAlgoClOrdId;
              }

              if (isOkxMoveStop) {
                const callbackRatioSpreadStr = config.callback_ratio_spread || "0";
                const activePxStr = config.active_px || "";

                if (callbackRatioSpreadStr !== "0" && callbackRatioSpreadStr.trim() !== "") {
                  const isPercent = callbackRatioSpreadStr.includes('%');
                  if (isPercent) {
                    const originalRatio = parseFloat((existingAttach as TPAlgoOrder).callbackRatio || "0");
                    const incrementPercent = parseFloat(callbackRatioSpreadStr.replace('%', '')) / 100;
                    const newRatio = parseFloat((originalRatio + incrementPercent).toFixed(8));
                    attachedAlgo.newCallbackRatio = newRatio.toString();
                    if (logInfo) logInfo += ", ";
                    logInfo += `回调幅度比例: ${(originalRatio * 100).toFixed(2)}%->${(newRatio * 100).toFixed(2)}%`;
                  } else {
                    const originalSpread = parseFloat((existingAttach as TPAlgoOrder).callbackSpread || "0");
                    const increment = parseFloat(callbackRatioSpreadStr);
                    const newSpread = parseFloat((originalSpread + increment).toFixed(8));
                    attachedAlgo.newCallbackSpread = newSpread.toString();
                    if (logInfo) logInfo += ", ";
                    logInfo += `回调幅度价距: ${originalSpread}->${newSpread}`;
                  }
                }

                if (activePxStr.trim() !== "") {
                  const originalActivePx = parseFloat((existingAttach as TPAlgoOrder).activePx || "0");
                  if (originalActivePx > 0) {
                    const newActivePx = AmendOrderAction.applyIncrementRounded(originalActivePx, activePxStr);
                    attachedAlgo.newActivePx = newActivePx.toString();
                    if (logInfo) logInfo += ", ";
                    logInfo += `激活价格: ${originalActivePx}->${newActivePx}`;
                  }
                }

                const slIncrementStr = config.sl_ord_px_increment || "-1";
                const slIncrementValue = AmendOrderAction.parseIncrement(slIncrementStr);
                const isSlDisabled = AmendOrderAction.isDisabledIncrement(slIncrementValue);
                if (!isSlDisabled) {
                  const basePx = AmendOrderAction.applyIncrement(originalPx, pxIncrementStr);
                  const { triggerPx: newSlTriggerPx, ordPx: newSlOrdPx } =
                    AmendOrderAction.calcDirectionalPx(basePx, slIncrementValue, slIncrementStr.includes('%'), isBuy, 'sl');
                  attachedAlgo.newSlTriggerPx = newSlTriggerPx.toString();
                  attachedAlgo.newSlOrdPx = newSlOrdPx.toString();
                  attachedAlgo.newSlOrdKind = 'condition';
                  if (!isSpot) {
                    attachedAlgo.newSlTriggerPxType = 'last';
                  }
                  if (logInfo) logInfo += ", ";
                  logInfo += `止损价: ${existingAttach?.slTriggerPx || '无'}->${newSlTriggerPx}`;
                }
              } else {
                const tpIncrementStr = config.tp_ord_px_increment || "-1";
                const slIncrementStr = config.sl_ord_px_increment || "-1";
                const tpIncrementValue = AmendOrderAction.parseIncrement(tpIncrementStr);
                const slIncrementValue = AmendOrderAction.parseIncrement(slIncrementStr);
                const isTpDisabled = AmendOrderAction.isDisabledIncrement(tpIncrementValue);
                const isSlDisabled = AmendOrderAction.isDisabledIncrement(slIncrementValue);

                if (!isTpDisabled) {
                  const basePx = AmendOrderAction.applyIncrement(originalPx, pxIncrementStr);
                  const { triggerPx: newTpTriggerPx, ordPx: newTpOrdPx } =
                    AmendOrderAction.calcDirectionalPx(basePx, tpIncrementValue, tpIncrementStr.includes('%'), isBuy, 'tp');

                  attachedAlgo.newTpTriggerPx = newTpTriggerPx.toString();
                  attachedAlgo.newTpOrdPx = newTpOrdPx.toString();
                  attachedAlgo.newTpOrdKind = 'condition';
                  if (!isSpot) {
                    attachedAlgo.newTpTriggerPxType = 'last';
                  }
                  
                  if (logInfo) logInfo += ", ";
                  logInfo += `止盈价: ${existingAttach?.tpTriggerPx || '无'}->${newTpTriggerPx}`;
                }

                if (!isSlDisabled) {
                  const basePx = AmendOrderAction.applyIncrement(originalPx, pxIncrementStr);
                  const { triggerPx: newSlTriggerPx, ordPx: newSlOrdPx } =
                    AmendOrderAction.calcDirectionalPx(basePx, slIncrementValue, slIncrementStr.includes('%'), isBuy, 'sl');

                  attachedAlgo.newSlTriggerPx = newSlTriggerPx.toString();
                  attachedAlgo.newSlOrdPx = newSlOrdPx.toString();
                  attachedAlgo.newSlOrdKind = 'condition';
                  if (!isSpot) {
                    attachedAlgo.newSlTriggerPxType = 'last';
                  }
                  
                  if (logInfo) logInfo += ", ";
                  logInfo += `止损价: ${existingAttach?.slTriggerPx || '无'}->${newSlTriggerPx}`;
                }
              }

              if (Object.keys(attachedAlgo).length > (attachedAlgo.attachAlgoId || attachedAlgo.attachAlgoClOrdId ? 1 : 0)) {
                params.attachAlgoOrds = [attachedAlgo];
              }
            }

            const tpIncrementForBinance = AmendOrderAction.parseIncrement(config.tp_ord_px_increment || "-1");
            const slIncrementForBinance = AmendOrderAction.parseIncrement(config.sl_ord_px_increment || "-1");
            const isTpBinanceDisabled = AmendOrderAction.isDisabledIncrement(tpIncrementForBinance);
            const isSlBinanceDisabled = AmendOrderAction.isDisabledIncrement(slIncrementForBinance);
            if (isBinance && order.orderListId && !isTpBinanceDisabled) {
              params.tpIncrement = tpIncrementForBinance;
              const originalTpPrice = parseFloat((order as any).otoTpPrice || (order as any).tpTriggerPx || "0");
              if (originalTpPrice > 0) {
                const newPx = AmendOrderAction.applyIncrementRounded(originalPx, pxIncrementStr);
                const isBuy = (order.posSide || order.side || 'buy').toLowerCase() === 'buy' || (order.posSide || order.side || 'long').toLowerCase() === 'long';
                const tpMultiplier = isBuy ? (1 + tpIncrementForBinance) : (1 - tpIncrementForBinance);
                const newTpPrice = parseFloat((newPx * tpMultiplier).toFixed(8));
                if (logInfo) logInfo += ", ";
                logInfo += `止盈价: ${originalTpPrice}->${newTpPrice}`;
              }
            }
            if (isBinance && order.orderListId && !isSlBinanceDisabled) {
              params.slIncrement = slIncrementForBinance;
              const originalSlPrice = parseFloat((order as any).otoSlPrice || (order as any).slTriggerPx || "0");
              if (originalSlPrice > 0) {
                const newPx = AmendOrderAction.applyIncrementRounded(originalPx, pxIncrementStr);
                const isBuy = (order.posSide || order.side || 'buy').toLowerCase() === 'buy' || (order.posSide || order.side || 'long').toLowerCase() === 'long';
                const slMultiplier = isBuy ? (1 - slIncrementForBinance) : (1 + slIncrementForBinance);
                const newSlPrice = parseFloat((newPx * slMultiplier).toFixed(8));
                if (logInfo) logInfo += ", ";
                logInfo += `止损价: ${originalSlPrice}->${newSlPrice}`;
              }
            }
          } else if (amendOrderType === 'conditional' || amendOrderType === 'oco' || amendOrderType === 'move_order_stop') {
            const currentInstId = order.instId || instId;
            const isSpot = !currentInstId.endsWith("-SWAP") && !currentInstId.endsWith("-FUTURES") && currentInstId.split("-").length === 2;
            
            if (amendOrderType === 'conditional' || amendOrderType === 'move_order_stop') {
              const isTp = !!(order.tpTriggerPx || order.tpOrdPx);
              const isSl = !!(order.slTriggerPx || order.slOrdPx);
              const isGeneric = !!(order.triggerPx || order.ordPx);
              const isTrailing = amendOrderType === 'move_order_stop';

              if (isTrailing) {
                const originalCallbackRate = Number((order as any).callbackRate ?? 0) / 100;
                const originalActivationPrice = Number((order as any).activationPrice ?? order.triggerPx ?? 0);
                if (hasTpIncrement) {
                  const tpIncrementPercent = parseFloat(tpPxIncrementStr.replace('%', '')) / 100;
                  const newCallbackRate = Number((originalCallbackRate + tpIncrementPercent).toFixed(8));
                  params.callbackRate = (newCallbackRate * 100).toString();
                  logInfo += `回调幅度比例: ${(originalCallbackRate * 100).toFixed(2)}%->${(newCallbackRate * 100).toFixed(2)}%`;
                }
                if (hasSlIncrement) {
                  const newActivationPrice = AmendOrderAction.applyIncrementRounded(originalActivationPrice, slPxIncrementStr);
                  params.newTriggerPx = newActivationPrice.toString();
                  if (logInfo) logInfo += ", ";
                  logInfo += `激活价格: ${originalActivationPrice}->${newActivationPrice}`;
                }
              } else

              if (isTp && hasTpIncrement) {
                const originalTpTriggerPx = parseFloat(order.tpTriggerPx || "0");
                const originalTpOrdPx = parseFloat(order.tpOrdPx || "0");
                const newTpTriggerPx = AmendOrderAction.applyIncrementRounded(originalTpTriggerPx, tpPxIncrementStr);
                const newTpOrdPx = AmendOrderAction.applyIncrementRounded(originalTpOrdPx, tpPxIncrementStr);
                
                params.newTpTriggerPx = newTpTriggerPx.toString();
                params.newTpOrdPx = newTpOrdPx.toString();
                if (!isSpot) {
                  params.newTpTriggerPxType = 'last';
                }
                logInfo += `止盈价: ${originalTpTriggerPx}->${newTpTriggerPx}`;
              } else if (isSl && hasSlIncrement) {
                const originalSlTriggerPx = parseFloat(order.slTriggerPx || "0");
                const originalSlOrdPx = parseFloat(order.slOrdPx || "0");
                const newSlTriggerPx = AmendOrderAction.applyIncrementRounded(originalSlTriggerPx, slPxIncrementStr);
                const newSlOrdPx = AmendOrderAction.applyIncrementRounded(originalSlOrdPx, slPxIncrementStr);
                
                params.newSlTriggerPx = newSlTriggerPx.toString();
                params.newSlOrdPx = newSlOrdPx.toString();
                if (!isSpot) {
                  params.newSlTriggerPxType = 'last';
                }
                logInfo += `止损价: ${originalSlTriggerPx}->${newSlTriggerPx}`;
              } else if (isGeneric) {
                const incrementStr = hasTpIncrement ? tpPxIncrementStr : slPxIncrementStr;
                if (hasTpIncrement || hasSlIncrement) {
                  const originalTriggerPx = parseFloat(order.triggerPx || "0");
                  const ordCandidates = [
                    order.ordPx,
                    order.px,
                    (order as any).price,
                    order.triggerPx,
                  ];
                  const originalOrdPx = ordCandidates
                    .map(v => Number(v))
                    .find(n => Number.isFinite(n) && n > 0) ?? 0;
                  const newTriggerPx = AmendOrderAction.applyIncrementRounded(originalTriggerPx, incrementStr);
                  const newOrdPx = AmendOrderAction.applyIncrementRounded(originalOrdPx, incrementStr);
                  
                  params.newTriggerPx = newTriggerPx.toString();
                  params.newOrdPx = newOrdPx.toString();
                  const triggerLabel = hasTpIncrement ? '止盈触发价' : '止损触发价';
                  const ordLabel = hasTpIncrement ? '止盈委托价' : '止损委托价';
                  logInfo += `${triggerLabel}: ${originalTriggerPx}->${newTriggerPx}, ${ordLabel}: ${originalOrdPx}->${newOrdPx}`;
                }
              }
            } else {
              if (hasTpIncrement) {
                const originalTpTriggerPx = parseFloat(order.tpTriggerPx || "0");
                const originalTpOrdPx = parseFloat(order.tpOrdPx || "0");
                
                if (originalTpTriggerPx > 0 || originalTpOrdPx > 0) {
                  const newTpTriggerPx = AmendOrderAction.applyIncrementRounded(originalTpTriggerPx, tpPxIncrementStr);
                  const newTpOrdPx = AmendOrderAction.applyIncrementRounded(originalTpOrdPx, tpPxIncrementStr);
                  
                  params.newTpTriggerPx = newTpTriggerPx.toString();
                  params.newTpOrdPx = newTpOrdPx.toString();
                  if (!isSpot) {
                    params.newTpTriggerPxType = 'last';
                  }
                  logInfo += `止盈价: ${originalTpTriggerPx}->${newTpTriggerPx}`;
                }
              }

              if (hasSlIncrement) {
                const originalSlTriggerPx = parseFloat(order.slTriggerPx || "0");
                const originalSlOrdPx = parseFloat(order.slOrdPx || "0");

                if (originalSlTriggerPx > 0 || originalSlOrdPx > 0) {
                  const newSlTriggerPx = AmendOrderAction.applyIncrementRounded(originalSlTriggerPx, slPxIncrementStr);
                  const newSlOrdPx = AmendOrderAction.applyIncrementRounded(originalSlOrdPx, slPxIncrementStr);

                  params.newSlTriggerPx = newSlTriggerPx.toString();
                  params.newSlOrdPx = newSlOrdPx.toString();
                  if (!isSpot) {
                    params.newSlTriggerPxType = 'last';
                  }
                  if (logInfo) logInfo += ", ";
                  logInfo += `止损价: ${originalSlTriggerPx}->${newSlTriggerPx}`;
                }
              }
            }

            if (isBinance && amendOrderType === 'oco') {
              params.tpPxIncrement = tpPxIncrementStr;
              params.slPxIncrement = slPxIncrementStr;
            }
          }

          const originalSz = parseFloat(order.sz || "1");
          const amendInstId = order.instId || instId;
          const newSz = AmendOrderAction.computeNewSize(originalSz, newContractSize, {
            incrementIdx: batchIdx,
            orderPrice: parseFloat(order.ordPx || order.px || "0") || undefined,
            ctVal: InstrumentService.getCtVal(amendInstId) ?? undefined,
            lotSz: InstrumentService.getLotSz(amendInstId) ?? undefined,
          });
          if (!Number.isFinite(newSz) || newSz <= 0) {
            failCount++;
            LogService.logKey("amend", 'order.amend.fail', {
              num: successCount + failCount,
              ordId: order.algoId || order.ordId || "未知",
              reason: `数量公式解析失败: ${newContractSize}`,
            }, 'error', configId);
            return;
          }
          params.newSz = newSz.toString();
          if (logInfo) logInfo += ", ";
          const formatNum = (val: string | number): string => {
            const num = parseFloat(String(val));
            return isNaN(num) || num === 0 ? String(val) : num.toString();
          };
          logInfo += `数量: ${formatNum(order.sz || '未知')}->${formatNum(newSz)}`;

          batchParams.push(params);
          batchLogInfos.push(logInfo);
          batchOrderIds.push(order.algoId || order.ordId || "未知");
        });

        if (batchParams.length === 0) {
          continue;
        }

        if (testMode) {
          batchOrderIds.forEach((id, idx) => {
            successCount++;
            const isLinked = linkedOrderIds.has(id);
            LogService.logKey("amend", 'amend.order.simulate', { num: successCount + failCount, detail: `ID=${id}${isLinked ? ' (子单)' : ''}, ${batchLogInfos[idx]}` }, 'info', configId);
          });
          continue;
        }

        try {
          let res: OKXApiResponse;
          if (!isAlgo) {
            res = await tradeService.amendBatchOrders(batchParams);
          } else {
            res = await tradeService.amendAlgoOrder(batchParams[0]);
          }

          if (res && (res.code === AmendOrderAction.OKX_SUCCESS_CODE || res.code === AmendOrderAction.OKX_ACCEPTED_CODE)) {
            const resultsData = res.data || [];
            batchOrderIds.forEach((id, idx) => {
              const data = resultsData[idx];
              const apiError = formatApiError(res, idx);
              
              const isNoStateChange = isBinance && apiError.toLowerCase().includes("change no state");

              if ((data && (data.sCode === AmendOrderAction.OKX_SUCCESS_CODE || data.code === AmendOrderAction.OKX_SUCCESS_CODE)) || isNoStateChange) {
                successCount++;
                LogService.logKey("amend", 'order.amend.ok', { num: successCount + failCount, ordId: id, detail: batchLogInfos[idx] }, 'info', configId);
              } else {
                failCount++;
                const failReason = apiError;
                const failParams = JSON.stringify({ ordId: id, detail: translateAmendDetail(batchLogInfos[idx] || ''), amendParams: batchParams[idx] });
                LogService.logKey("amend", 'order.amend.fail', { num: successCount + failCount, reason: failReason, params: failParams }, 'error', configId);
              }
            });
          } else {
            batchOrderIds.forEach((id, idx) => {
              failCount++;
              const failReason2 = formatApiError(res, idx);
              const failParams2 = JSON.stringify({ ordId: id, detail: translateAmendDetail(batchLogInfos[idx] || ''), amendParams: batchParams[idx] });
              LogService.logKey("amend", 'order.amend.fail', { num: successCount + failCount, reason: failReason2, params: failParams2 }, 'warn', configId);
            });
          }
        } catch (err: unknown) {
          const caughtErr = err instanceof Error ? err : new Error(String(err));
          batchOrderIds.forEach((id, idx) => {
            failCount++;
            const failReason3 = caughtErr.message || String(err);
            const failParams3 = JSON.stringify({ ordId: id, detail: translateAmendDetail(batchLogInfos[idx] || ''), amendParams: batchParams[idx] });
            LogService.logKey("amend", 'order.amend.fail', { num: successCount + failCount, reason: failReason3, params: failParams3 }, 'error', configId);
          });
        }

        if (i + BATCH_SIZE < ordersToProcess.length) {
          const delay = isAlgo ? 150 : 1000;
          await new Promise(r => setTimeout(r, delay));
        }
      }

      if (!testMode && successCount > 0) {
        const amendAlgoTypesMap: Record<string, string[]> = {
          trigger: ['trigger'],
          conditional: ['conditional'],
          oco: ['oco'],
          move_order_stop: ['move_order_stop'],
        };
        let amendAlgoTypes = amendAlgoTypesMap[amendOrderType] || [];
        if (isBinance && amendAlgoTypes.length > 0) {
          amendAlgoTypes = [];
        }
        const instIdParts = instId.split('-');
        const lastPart = instIdParts[instIdParts.length - 1];
        const amendInstType = ['SWAP', 'FUTURES', 'OPTION'].includes(lastPart)
          ? lastPart
          : (ordersToProcess[0]?.tdMode === 'cross' || ordersToProcess[0]?.tdMode === 'isolated' ? 'MARGIN' : 'SPOT');
        await AccountMonitor.getInstance().syncAccountOrders(accountIdx, amendAlgoTypes, amendInstType);
      }

      LogService.logKey("amend", 'action.complete', { op: '修改', success: successCount, fail: failCount }, 'info', configId);
    } catch (e: unknown) {
      const caughtErr = e instanceof Error ? e : new Error(String(e));
      LogService.logKey("amend", 'action.exception', { msg: caughtErr.message || String(e) }, 'error', configId);
    }
  }

  private static fetchLocalOrders(
    accountIdx: number,
    instId: string,
    amendOrderType: string,
    matchOrderType: (order: UnifiedOrder, targetType: string) => boolean,
    includeLimitMaker: boolean
  ): OrderWithAlgo[] {
    const ordersCache = globalThis.ORDERS_CACHE;

    const allOrders = ordersCache ? ordersCache.get(accountIdx).data : [];
    const filteredAll = allOrders.filter(o => {
      if (isPendingNewState(o)) return false;
      return !instId || SymbolUtils.isSameSymbol(o.instId, instId);
    });

    if (amendOrderType === 'limit') {
      const limitTypes = includeLimitMaker
        ? ['limit', 'post_only', 'limit_maker']
        : ['limit', 'post_only'];
      return filteredAll.filter(o => limitTypes.includes(o.ordType)) as OrderWithAlgo[];
    }
    return filteredAll.filter(o => matchOrderType(o, amendOrderType)) as OrderWithAlgo[];
  }
}
