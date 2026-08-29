
import { OKXTradeService } from "../../services/okxTradeService.ts";
import { LogService } from "../../services/logService.ts";
import { AccountMonitor } from "../../services/AccountMonitor.ts";
import { loadSavedConfig } from "../../services/configService.ts";
import { createChildIdempotencyKey, createRequestIdempotencyKey } from "../../lib/idempotency.ts";
import type { AppConfig } from "../../types/core.ts";
import { PlaceOrderActionConfig } from "../../types/blocks.ts";
import type { ActionPlaceOrderParams, ActionAttachAlgoOrd } from "../../types/blocks.ts";
import type { OKXPosition } from "../../types/okx.ts";
import type { TradeOrder } from "../../types/trade.ts";
import { buildPlaceDescSegments, buildPlaceDescText, PlaceConfigItem } from "../../components/PlaceModule.tsx";
import { t } from "../../lib/translateKey.ts";
import { encodeDescFields } from "../../lib/logTemplates.ts";
import { evaluateFormula, formulaNeedsVar, isFormula, roundToTickSize } from "../../lib/priceFormula.ts";
import { fetchMarketPrice, fetchSodUtc8 } from "../../lib/marketPrice.ts";
import { formatApiError } from "../../lib/apiErrorFormatter.ts";
import { InstrumentService } from "../../services/instrumentService.ts";

interface ExtendedOrder extends TradeOrder {
  exchange?: string;
  _algoType?: string;
  _execType?: string;
  contingencyType?: string;
  orderListId?: string;
  trailingDelta?: string | number;
  activationPrice?: string;
  activatePrice?: string;
  triggerPrice?: string;
  chaseVal?: string;
  tpPrice?: string;
  slPrice?: string;
  orderPrice?: string;
  _curActivePx?: number;
}

export class PlaceOrderAction {
  private static async resolvePrice(rawValue: string, instId: string, extraVars?: { o?: number; n?: number; s?: number; s8?: number; marketPrice?: number }): Promise<number | null> {
    if (!rawValue || rawValue === '-1') return null;

    if (!isFormula(rawValue)) {
      const num = parseFloat(rawValue);
      return Number.isFinite(num) ? num : null;
    }

    const fml = rawValue.slice(1);
    const needsMarketPrice = formulaNeedsVar(fml, 'm');
    const needsPositionSize = formulaNeedsVar(fml, 's');
    const needsSodUtc8 = formulaNeedsVar(fml, 's8');

    let marketPrice = extraVars?.marketPrice ?? null;
    if (needsMarketPrice && marketPrice === null) {
      marketPrice = await fetchMarketPrice(instId);
      if (marketPrice === null) {
        LogService.logKey("trader", 'trader.warn.noMarketPrice', {}, 'warn');
        return null;
      }
    }

    if (needsPositionSize && (extraVars?.s === undefined || extraVars?.s === null)) {
      LogService.logKey("trader", 'trader.warn.noPositionSize', {}, 'warn');
      return null;
    }

    if (needsSodUtc8 && (extraVars?.s8 === undefined || extraVars?.s8 === null)) {
      LogService.logKey("trader", 'trader.warn.noSodUtc8', {}, 'warn');
      return null;
    }

    const evalVars: Record<string, number> = {
      m: marketPrice ?? 0,
      M: marketPrice ?? 0,
      o: extraVars?.o ?? 0,
      O: extraVars?.o ?? 0,
      n: extraVars?.n ?? 0,
      N: extraVars?.n ?? 0,
      s: extraVars?.s ?? 0,
      S: extraVars?.s ?? 0
    };
    if (needsSodUtc8) {
      evalVars.s8 = extraVars!.s8 as number;
      evalVars.S8 = extraVars!.s8 as number;
    }

    const result = evaluateFormula(rawValue, evalVars);
    if (result.errorCode) {
      LogService.logKey("trader", 'trader.warn.formulaError', { formula: rawValue, error: result.errorCode + (result.error ? `: ${result.error}` : '') }, 'warn');
      return null;
    }

    return Math.round(result.result! * 1e8) / 1e8;
  }

  private static parseMarginValue(raw: string): { value: number; isPercent: boolean } {
    const trimmed = raw.trim();
    if (trimmed === '-1' || trimmed === '') return { value: -1, isPercent: false };
    const isPct = trimmed.endsWith('%');
    const num = parseFloat(isPct ? trimmed.slice(0, -1) : trimmed);
    return { value: Number.isFinite(num) ? num : -1, isPercent: isPct };
  }

  private static parseMarginPair(raw: string): {
    trigger: { value: number; isPercent: boolean };
    ord: { value: number; isPercent: boolean } | null;
  } {
    const trimmed = raw.trim();
    const parts = trimmed.split(/[;；]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const trigger = PlaceOrderAction.parseMarginValue(parts[0]);
      const ord = PlaceOrderAction.parseMarginValue(parts[1]);
      if (trigger.value === -1) return { trigger: { value: -1, isPercent: false }, ord: null };
      return { trigger, ord: ord.value === -1 ? null : ord };
    }
    return { trigger: PlaceOrderAction.parseMarginValue(trimmed), ord: null };
  }

  private static calcTpSlPrice(
    basePrice: number,
    margin: number,
    isPercent: boolean,
    side: string,
    isTakeProfit: boolean
  ): number {
    if (isPercent) {
      const factor = margin / 100;
      if (isTakeProfit) {
        return side === 'buy'
          ? basePrice * (1 + factor)
          : basePrice * (1 - factor);
      } else {
        return side === 'buy'
          ? basePrice * (1 - factor)
          : basePrice * (1 + factor);
      }
    }
    if (isTakeProfit) {
      return side === 'buy' ? basePrice + margin : basePrice - margin;
    } else {
      return side === 'buy' ? basePrice - margin : basePrice + margin;
    }
  }

  private static buildAttachAlgoOrds(
    config: {
      side: string;
      posSide: string;
      isMoveStop: boolean;
      tpMargin: number;
      slMargin: number;
      tpIsPercent: boolean;
      slIsPercent: boolean;
      tpOrdMargin?: number;
      slOrdMargin?: number;
      tpOrdIsPercent?: boolean;
      slOrdIsPercent?: boolean;
      callbackRatioVal: number;
      callbackSpreadVal: number;
      activePxVal: number;
    },
    basePrice: number,
    requestKey: string,
    orderIndex: number,
    tickSz: number | null
  ): ActionAttachAlgoOrd[] {
    const attachAlgoOrds: ActionAttachAlgoOrd[] = [];
    const isOpenPosition = !(config.side === 'sell' && config.posSide === 'long')
      && !(config.side === 'buy' && config.posSide === 'short');

    if (isOpenPosition) {
      if (config.isMoveStop) {
        const algoOrd: Record<string, string> = {};
        if (config.callbackRatioVal > 0) {
          algoOrd.callbackRatio = config.callbackRatioVal.toString();
        } else if (config.callbackSpreadVal > 0) {
          algoOrd.callbackSpread = config.callbackSpreadVal.toString();
        }
        if (config.activePxVal > 0) {
          algoOrd.activePx = roundToTickSize(config.activePxVal, tickSz).toString();
        }
        if (config.slMargin !== -1) {
          const slPrice = roundToTickSize(PlaceOrderAction.calcTpSlPrice(basePrice, config.slMargin, config.slIsPercent, config.side, false), tickSz);
          if (slPrice > 0) algoOrd.slTriggerPx = slPrice.toString();
        }
        if (Object.keys(algoOrd).length > 0) {
          attachAlgoOrds.push({
            ...algoOrd,
            clOrdId: createChildIdempotencyKey(requestKey, orderIndex * 10 + 1)
          } as ActionAttachAlgoOrd);
        }
      } else if (basePrice > 0 && (config.tpMargin !== -1 || config.slMargin !== -1)) {
        const algoOrd: Record<string, string> = {};
        if (config.tpMargin !== -1) {
          const tpPrice = roundToTickSize(PlaceOrderAction.calcTpSlPrice(basePrice, config.tpMargin, config.tpIsPercent, config.side, true), tickSz);
          if (tpPrice > 0) algoOrd.tpTriggerPx = tpPrice.toString();
          if (config.tpOrdMargin !== undefined && config.tpOrdMargin > 0) {
            const tpOrdPrice = roundToTickSize(PlaceOrderAction.calcTpSlPrice(basePrice, config.tpOrdMargin, config.tpOrdIsPercent ?? config.tpIsPercent, config.side, true), tickSz);
            if (tpOrdPrice > 0) algoOrd.tpOrdPx = tpOrdPrice.toString();
          }
        }
        if (config.slMargin !== -1) {
          const slPrice = roundToTickSize(PlaceOrderAction.calcTpSlPrice(basePrice, config.slMargin, config.slIsPercent, config.side, false), tickSz);
          if (slPrice > 0) algoOrd.slTriggerPx = slPrice.toString();
          if (config.slOrdMargin !== undefined && config.slOrdMargin > 0) {
            const slOrdPrice = roundToTickSize(PlaceOrderAction.calcTpSlPrice(basePrice, config.slOrdMargin, config.slOrdIsPercent ?? config.slIsPercent, config.side, false), tickSz);
            if (slOrdPrice > 0) algoOrd.slOrdPx = slOrdPrice.toString();
          }
        }
        if (Object.keys(algoOrd).length > 0) {
          attachAlgoOrds.push({
            ...algoOrd,
            clOrdId: createChildIdempotencyKey(requestKey, orderIndex * 10 + 1)
          } as ActionAttachAlgoOrd);
        }
      }
    }
    return attachAlgoOrds;
  }

  private static async placeTriggerOrder(params: {
    i: number; ordType: string; instId: string; side: string; tdMode: string;
    effectivePosSide: string | undefined; contractSize: string; requestKey: string;
    curFirstOrderPrice: number; priceOffset: number; direction: string;
    rawActivePx: string; activePxNeedsO: boolean; activePxNeedsN: boolean;
    activePxVal: number; isMoveStop: boolean; tpDisplay: string; slDisplay: string;
    callbackRatioVal: number; callbackSpreadVal: number;
    takeProfitMargin: number; stopLossMargin: number;
    tpIsPercent: boolean; slIsPercent: boolean;
    tpOrdMargin?: number; slOrdMargin?: number; tpOrdIsPercent?: boolean; slOrdIsPercent?: boolean;
    skipDuplicateOrders: boolean; existingPrices: number[];
    testMode: boolean; configId?: string;
    tradeService: OKXTradeService; cachedPositionSize: number | null; cachedMarketPrice: number | null; cachedSodUtc8: number | null;
    actualNumOrders: number; posSide: string; tickSz: number | null;
  }): Promise<{ success: boolean; placed: boolean }> {
    const { i, ordType, instId, side, tdMode, effectivePosSide, contractSize, requestKey,
      curFirstOrderPrice, priceOffset, rawActivePx, activePxNeedsO, activePxNeedsN,
      activePxVal, isMoveStop, tpDisplay, slDisplay, callbackRatioVal, callbackSpreadVal,
      takeProfitMargin, stopLossMargin, tpIsPercent, slIsPercent,
      tpOrdMargin, slOrdMargin, tpOrdIsPercent, slOrdIsPercent,
      skipDuplicateOrders, existingPrices, testMode, configId,
      tradeService, cachedPositionSize, cachedMarketPrice, cachedSodUtc8, actualNumOrders, posSide, tickSz } = params;

    const triggerPx = roundToTickSize(parseFloat((curFirstOrderPrice + priceOffset).toFixed(8)), tickSz);
    const curActivePx = (activePxNeedsO || activePxNeedsN)
      ? roundToTickSize(
          (await PlaceOrderAction.resolvePrice(rawActivePx, instId, { o: triggerPx, n: i, s: cachedPositionSize ?? undefined, s8: cachedSodUtc8 ?? undefined, marketPrice: cachedMarketPrice !== null ? cachedMarketPrice : undefined })) ?? -1,
          tickSz
        )
      : activePxVal;

    if (triggerPx <= 0) {
      LogService.logKey("trader", 'order.skipped', { num: i + 1, reason: `触发价 ${triggerPx} 无效 (请检查首单价格和间隔设置)` }, 'warn', configId);
      return { success: false, placed: false };
    }

    if (skipDuplicateOrders && existingPrices.includes(triggerPx)) {
      LogService.logKey("trader", 'order.skip.duplicate.trigger', { px: String(triggerPx) }, 'info', configId);
      return { success: false, placed: false };
    }

    if (testMode) {
      if (isMoveStop) {
        const simParams: Record<string, unknown> = { num: i + 1, triggerPx, sz: contractSize, sl: slDisplay };
        if (callbackRatioVal > 0) simParams.callbackRatio = callbackRatioVal;
        if (callbackSpreadVal > 0) simParams.callbackSpread = callbackSpreadVal;
        if (curActivePx > 0) simParams.activePx = curActivePx;
        LogService.logKey("trader", 'order.simulate', simParams, 'info', configId);
      } else {
        LogService.logKey("trader", 'order.simulate', { num: i + 1, triggerPx, sz: contractSize, tp: tpDisplay, sl: slDisplay }, 'info', configId);
      }
      return { success: true, placed: true };
    }

    const instType3 = instId.split('-').pop() || '';
    const isSwapOrFutures = instType3 === 'SWAP' || instType3 === 'FUTURES';
    let attachAlgoOrds: ActionAttachAlgoOrd[] = [];
    if (isSwapOrFutures) {
      attachAlgoOrds = PlaceOrderAction.buildAttachAlgoOrds(
        { side, posSide, isMoveStop, tpMargin: takeProfitMargin, slMargin: stopLossMargin, tpIsPercent, slIsPercent, tpOrdMargin, slOrdMargin, tpOrdIsPercent, slOrdIsPercent, callbackRatioVal, callbackSpreadVal, activePxVal: curActivePx },
        triggerPx,
        requestKey,
        i,
        tickSz
      );
    }

    const orderParams: ActionPlaceOrderParams = {
      instId,
      side,
      ordType,
      sz: contractSize.toString(),
      tdMode,
      triggerPx: triggerPx.toString(),
      posSide: effectivePosSide,
      clOrdId: createChildIdempotencyKey(requestKey, i),
      attachAlgoOrds: attachAlgoOrds.length > 0 ? attachAlgoOrds : undefined,
    };

    const result = await tradeService.placeOrder(orderParams);

    if (result && result.code === "0") {
      const orderId = result.data?.[0]?.algoId || result.data?.[0]?.ordId || "未知";
      if (isMoveStop) {
        const logParams: Record<string, unknown> = { num: i + 1, ordId: orderId, triggerPx, sz: contractSize, sl: slDisplay };
        if (callbackRatioVal > 0) logParams.callbackRatio = callbackRatioVal;
        if (callbackSpreadVal > 0) logParams.callbackSpread = callbackSpreadVal;
        if (curActivePx > 0) logParams.activePx = curActivePx;
        LogService.logKey("trader", 'order.placed', logParams, 'info', configId);
      } else {
        LogService.logKey("trader", 'order.placed', { num: i + 1, ordId: orderId, triggerPx, sz: contractSize, tp: tpDisplay, sl: slDisplay }, 'info', configId);
      }
      if (i < actualNumOrders - 1) await new Promise(r => setTimeout(r, 150));
      return { success: true, placed: true };
    } else {
      const reason = formatApiError(result);
      const paramsStr2 = JSON.stringify(orderParams);
      LogService.logKey("trader", 'order.placed.fail', { num: i + 1, reason, params: paramsStr2 }, 'warn', configId);
      if (i < actualNumOrders - 1) await new Promise(r => setTimeout(r, 150));
      return { success: false, placed: true };
    }
  }

  private static async placeConditionalOrder(params: {
    i: number; ordType: string; instId: string; side: string; tdMode: string;
    effectivePosSide: string | undefined; contractSize: string; requestKey: string;
    firstTpPrice: number; firstSlPrice: number; priceOffset: number;
    marketBasePrice: number | null;
    skipDuplicateOrders: boolean; existingPrices: number[];
    testMode: boolean; configId?: string;
    tradeService: OKXTradeService; actualNumOrders: number; tickSz: number | null;
  }): Promise<{ success: boolean; placed: boolean }> {
    const { i, ordType, instId, side, tdMode, effectivePosSide, contractSize, requestKey,
      firstTpPrice, firstSlPrice, priceOffset, marketBasePrice,
      skipDuplicateOrders, existingPrices, testMode, configId,
      tradeService, actualNumOrders, tickSz } = params;

    const tpDisabled = firstTpPrice === -1;
    const slDisabled = firstSlPrice === -1;

    if (tpDisabled && slDisabled) {
      LogService.logKey("trader", 'order.skipped', { num: i + 1, reason: '触发价未设置，请在首单止盈(触发价)框中填写价格' }, 'info', configId);
      return { success: false, placed: false };
    }

    let tpTriggerPx: string | undefined = undefined;
    let slTriggerPx: string | undefined = undefined;

    if (ordType === 'conditional' && marketBasePrice !== null) {
      const triggerPx = roundToTickSize(parseFloat((firstTpPrice + priceOffset).toFixed(8)), tickSz);
      const isBuy = side === 'buy';
      if (isBuy) {
        if (triggerPx < marketBasePrice) { tpTriggerPx = triggerPx.toString(); }
        else { slTriggerPx = triggerPx.toString(); }
      } else {
        if (triggerPx > marketBasePrice) { tpTriggerPx = triggerPx.toString(); }
        else { slTriggerPx = triggerPx.toString(); }
      }
      const autoType = tpTriggerPx ? '止盈' : '止损';
      const compareOp = triggerPx > marketBasePrice ? '>' : '<';
      if (i === 0) LogService.logKey("trader", 'order.net.detect', { triggerPx: String(triggerPx), marketPx: String(marketBasePrice), dir: compareOp, result: autoType }, 'info', configId);
    } else {
      const tpTriggerPxVal = tpDisabled ? null : roundToTickSize(parseFloat((firstTpPrice + priceOffset).toFixed(8)), tickSz);
      const slTriggerPxVal = slDisabled ? null : roundToTickSize(parseFloat((firstSlPrice + priceOffset).toFixed(8)), tickSz);
      tpTriggerPx = tpTriggerPxVal?.toString();
      slTriggerPx = slTriggerPxVal?.toString();
    }

    const checkPrice = tpTriggerPx || slTriggerPx;
    if (skipDuplicateOrders && checkPrice && existingPrices.includes(parseFloat(checkPrice))) {
      LogService.logKey("trader", 'order.skip.duplicate.trigger', { px: String(checkPrice) }, 'info', configId);
      return { success: false, placed: false };
    }

    if (testMode) {
      LogService.logKey("trader", 'order.simulate', { num: i + 1, sz: contractSize, tpPx: tpTriggerPx ? parseFloat(tpTriggerPx) : 0, slPx: slTriggerPx ? parseFloat(slTriggerPx) : 0 }, 'info', configId);
      return { success: true, placed: true };
    }

    const orderParams: ActionPlaceOrderParams = {
      instId, side, ordType, sz: contractSize.toString(), tdMode,
      posSide: effectivePosSide, clOrdId: createChildIdempotencyKey(requestKey, i),
      tpTriggerPx, slTriggerPx,
    };
    const result = await tradeService.placeOrder(orderParams);
    if (result && result.code === "0") {
      const orderId = result.data?.[0]?.algoId || result.data?.[0]?.ordId || "未知";
      LogService.logKey("trader", 'order.placed', { num: i + 1, ordId: orderId, sz: contractSize, tpPx: tpTriggerPx ? parseFloat(tpTriggerPx) : 0, slPx: slTriggerPx ? parseFloat(slTriggerPx) : 0 }, 'info', configId);
      if (i < actualNumOrders - 1) await new Promise(r => setTimeout(r, 150));
      return { success: true, placed: true };
    } else {
      const paramsStr2 = JSON.stringify(orderParams);
      LogService.logKey("trader", 'order.placed.fail', { num: i + 1, reason: formatApiError(result), params: paramsStr2 }, 'warn', configId);
      if (i < actualNumOrders - 1) await new Promise(r => setTimeout(r, 150));
      return { success: false, placed: true };
    }
  }

  private static async placeChaseOrder(params: {
    i: number; ordType: string; instId: string; side: string; tdMode: string;
    effectivePosSide: string | undefined; contractSize: string; requestKey: string;
    chaseVal: number; priceOffset: number;
    skipDuplicateOrders: boolean; existingPrices: number[];
    testMode: boolean; configId?: string;
    tradeService: OKXTradeService; actualNumOrders: number; tickSz: number | null;
  }): Promise<{ success: boolean; placed: boolean }> {
    const { i, ordType, instId, side, tdMode, effectivePosSide, contractSize, requestKey,
      chaseVal, priceOffset, skipDuplicateOrders, existingPrices,
      testMode, configId, tradeService, actualNumOrders, tickSz } = params;

    const currentChaseVal = parseFloat((chaseVal + Math.abs(priceOffset)).toFixed(8));
    if (currentChaseVal < 0) {
      LogService.logKey("trader", 'order.skipped', { num: i + 1, reason: `价距 ${currentChaseVal} 无效` }, 'warn', configId);
      return { success: false, placed: false };
    }
    if (skipDuplicateOrders && existingPrices.includes(currentChaseVal)) {
      LogService.logKey("trader", 'order.skip.duplicate.chase', { val: String(currentChaseVal) }, 'info', configId);
      return { success: false, placed: false };
    }
    if (testMode) {
      LogService.logKey("trader", 'order.simulate', { num: i + 1, sz: contractSize, chase: currentChaseVal }, 'info', configId);
      return { success: true, placed: true };
    }

    const orderParams: ActionPlaceOrderParams = {
      instId, side, ordType, sz: contractSize.toString(), tdMode,
      posSide: effectivePosSide, clOrdId: createChildIdempotencyKey(requestKey, i),
      chaseVal: currentChaseVal.toString(),
    };
    const result = await tradeService.placeOrder(orderParams);
    if (result && result.code === "0") {
      const orderId = result.data?.[0]?.algoId || result.data?.[0]?.ordId || "未知";
      LogService.logKey("trader", 'order.placed', { num: i + 1, ordId: orderId, sz: contractSize, chase: currentChaseVal }, 'info', configId);
      if (i < actualNumOrders - 1) await new Promise(r => setTimeout(r, 150));
      return { success: true, placed: true };
    } else {
      const reason2 = formatApiError(result);
      const paramsStr2 = JSON.stringify(orderParams);
      LogService.logKey("trader", 'order.placed.fail', { num: i + 1, reason: reason2, params: paramsStr2 }, 'warn', configId);
      if (i < actualNumOrders - 1) await new Promise(r => setTimeout(r, 150));
      return { success: false, placed: true };
    }
  }

  private static async placeMoveOrderStopOrder(params: {
    i: number; ordType: string; instId: string; side: string; tdMode: string;
    effectivePosSide: string | undefined; contractSize: string; requestKey: string;
    activePxVal: number; priceOffset: number;
    callbackRatioVal: number; callbackSpreadVal: number;
    skipDuplicateOrders: boolean; existingPrices: number[];
    testMode: boolean; configId?: string;
    tradeService: OKXTradeService; actualNumOrders: number; tickSz: number | null;
  }): Promise<{ success: boolean; placed: boolean }> {
    const { i, ordType, instId, side, tdMode, effectivePosSide, contractSize, requestKey,
      activePxVal, priceOffset, callbackRatioVal, callbackSpreadVal,
      skipDuplicateOrders, existingPrices, testMode, configId,
      tradeService, actualNumOrders, tickSz } = params;

    const currentActivePx = activePxVal > 0 ? roundToTickSize(parseFloat((activePxVal + priceOffset).toFixed(8)), tickSz) : null;
    if (skipDuplicateOrders && currentActivePx && existingPrices.includes(currentActivePx)) {
      LogService.logKey("trader", 'order.skip.duplicate.active', { px: String(currentActivePx) }, 'info', configId);
      return { success: false, placed: false };
    }
    if (testMode) {
      LogService.logKey("trader", 'order.simulate', { num: i + 1, sz: contractSize, callbackRatio: Number(callbackRatioVal), callbackSpread: Number(callbackSpreadVal), activePx: Number(currentActivePx || 0) }, 'info', configId);
      return { success: true, placed: true };
    }

    const orderParams: ActionPlaceOrderParams = {
      instId, side, ordType, sz: contractSize.toString(), tdMode,
      posSide: effectivePosSide, clOrdId: createChildIdempotencyKey(requestKey, i),
      activePx: currentActivePx?.toString(),
      callbackRatio: callbackRatioVal?.toString(),
      callbackSpread: callbackSpreadVal?.toString(),
    };
    const result = await tradeService.placeOrder(orderParams);
    if (result && result.code === "0") {
      const orderId = result.data?.[0]?.algoId || result.data?.[0]?.ordId || "未知";
      LogService.logKey("trader", 'order.placed', { num: i + 1, ordId: orderId, sz: contractSize, callbackRatio: Number(callbackRatioVal), callbackSpread: Number(callbackSpreadVal), activePx: Number(currentActivePx || 0) }, 'info', configId);
      if (i < actualNumOrders - 1) await new Promise(r => setTimeout(r, 150));
      return { success: true, placed: true };
    } else {
      const paramsStr3 = JSON.stringify(orderParams);
      LogService.logKey("trader", 'order.placed.fail', { num: i + 1, reason: formatApiError(result), params: paramsStr3 }, 'warn', configId);
      if (i < actualNumOrders - 1) await new Promise(r => setTimeout(r, 150));
      return { success: false, placed: true };
    }
  }

  private static async flushBatchOrders(params: {
    batchOrders: ActionPlaceOrderParams[]; i: number; actualNumOrders: number;
    tradeService: OKXTradeService; ordType: string;
    isMoveStop: boolean; callbackRatioVal: number; callbackSpreadVal: number;
    tpDisplay: string; slDisplay: string; configId?: string;
  }): Promise<{ successCount: number; failCount: number; failures: Array<{ index: number; sMsg: string }> }> {
    const { batchOrders, i, actualNumOrders, tradeService, ordType, isMoveStop,
      callbackRatioVal, callbackSpreadVal, tpDisplay, slDisplay, configId } = params;
    let successCount = 0;
    let failCount = 0;
    const failures: Array<{ index: number; sMsg: string }> = [];

    const result = await tradeService.placeOrders(batchOrders);
    if (result && (result.code === "0" || result.code === "2")) {
      batchOrders.forEach((order, idx) => {
        const resData = result.data?.[idx] || {};
        const sCode = resData.sCode;
        const orderId = resData.ordId || resData.orderId || resData.clOrdId || order.clOrdId || "未知";
        const pxText = ordType === 'market' ? '市价' : (order.px || '未知');
        const orderNum = i - batchOrders.length + idx + 2;
        if (sCode === "0") {
          successCount++;
          if (isMoveStop) {
            const logParams: Record<string, unknown> = { num: orderNum, ordId: orderId, ordPx: pxText, sz: order.sz, sl: slDisplay };
            if (callbackRatioVal > 0) logParams.callbackRatio = callbackRatioVal;
            if (callbackSpreadVal > 0) logParams.callbackSpread = callbackSpreadVal;
            const orderActivePx = order._curActivePx as number | undefined;
            if (orderActivePx && orderActivePx > 0) logParams.activePx = orderActivePx;
            LogService.logKey("trader", 'order.placed', logParams, 'info', configId);
          } else {
            LogService.logKey("trader", 'order.placed', { num: orderNum, ordId: orderId, ordPx: pxText, sz: order.sz, tp: tpDisplay, sl: slDisplay }, 'info', configId);
          }
        } else {
          failCount++;
          const sMsg = (typeof resData.sMsg === 'string' && resData.sMsg.trim()) ? resData.sMsg : '下单失败，详见日志';
          failures.push({ index: orderNum, sMsg });
          const paramsStr2 = JSON.stringify(order);
          LogService.logKey("trader", 'order.placed.fail', { num: orderNum, reason: formatApiError(result, idx), params: paramsStr2 }, 'warn', configId);
        }
      });
    } else {
      batchOrders.forEach((order, idx) => {
        failCount++;
        const orderNum = i - batchOrders.length + idx + 2;
        const sMsg = (typeof result.data?.[idx]?.sMsg === 'string' && result.data?.[idx]?.sMsg.trim()) ? result.data[idx].sMsg : '下单失败，详见日志';
        failures.push({ index: orderNum, sMsg });
        const paramsStr2 = JSON.stringify(order);
        LogService.logKey("trader", 'order.placed.fail', { num: orderNum, reason: formatApiError(result, idx), params: paramsStr2 }, 'warn', configId);
      });
    }
    batchOrders.length = 0;
    return { successCount, failCount, failures };
  }

static async execute(config: PlaceOrderActionConfig, tradeService: OKXTradeService, numOrders?: number, configId?: string, appConfig?: AppConfig, triggeredInstId?: string): Promise<{ successCount: number; failCount: number; failures: Array<{ index: number; sMsg: string }> }> {
    const accountIdx = tradeService.accountIdx;
    let failures: Array<{ index: number; sMsg: string }> = [];

    const finalAppConfig = appConfig || loadSavedConfig();
    const accountNames: Record<number, string> = finalAppConfig.accountNames || {};
    
    const instId = config.inst_id || triggeredInstId || '';
    if (!instId) {
      LogService.logKey('diy', 'diy.action.noInstId', { configId, triggeredInstId }, 'warn', configId);
      return { successCount: 0, failCount: 0, failures: [] };
    }

    const rawOrderInterval = config.order_interval || "1000";
    const rawContractSize = config.contract_size || "1";
    const actualNumOrders = numOrders ?? parseInt(config.order_count || "5");
    if (!Number.isFinite(actualNumOrders) || actualNumOrders <= 0) {
      LogService.logKey("trader", 'trader.validation.orderCount', {}, 'error', configId);
      return;
    }

    const isIntervalFormula = isFormula(rawOrderInterval);
    const isIntervalPercent = !isIntervalFormula && String(rawOrderInterval).trim().endsWith('%');
    let baseInterval = 0;
    let intervalPercent = 0;
    if (!isIntervalFormula) {
      if (isIntervalPercent) {
        intervalPercent = parseFloat(String(rawOrderInterval).replace('%', '')) / 100;
        if (!Number.isFinite(intervalPercent) || intervalPercent < 0) {
          LogService.logKey("trader", 'trader.validation.interval', {}, 'error', configId);
          return;
        }
      } else {
        baseInterval = parseFloat(rawOrderInterval);
        if (!Number.isFinite(baseInterval) || baseInterval < 0) {
          LogService.logKey("trader", 'trader.validation.interval', {}, 'error', configId);
          return;
        }
      }
    }

    const isSizeFormula = isFormula(rawContractSize);

    const tpPair = PlaceOrderAction.parseMarginPair(config.take_profit_margin || "-1");
    const slPair = PlaceOrderAction.parseMarginPair(config.stop_loss_margin || "-1");
    const takeProfitMargin = tpPair.trigger.value;
    const stopLossMargin = slPair.trigger.value;
    const tpIsPercent = tpPair.trigger.isPercent;
    const slIsPercent = slPair.trigger.isPercent;
    const tpOrdMargin = tpPair.ord?.value;
    const slOrdMargin = slPair.ord?.value;
    const tpOrdIsPercent = tpPair.ord?.isPercent;
    const slOrdIsPercent = slPair.ord?.isPercent;
    const tpDisplay = config.take_profit_margin || "-1";
    const slDisplay = config.stop_loss_margin || "-1";
    const instIdParts = instId.split('-');
    const isFuturesInst = ['SWAP', 'FUTURES', 'OPTION'].includes(instIdParts[instIdParts.length - 1]);
    const defaultTdMode = isFuturesInst ? "cross" : "cash";
    const tdMode = config.td_mode || defaultTdMode;
    const direction = config.order_direction || "up";
    const side = config.side || "buy";
    
    let ordType = config.order_type || "limit";
    const reverseOrdTypeMap: Record<string, string> = {
      '限价委托': 'limit', '市价委托': 'market',
      '限价-Post only': 'post_only', '限价-FOK': 'fok', '限价-IOC': 'ioc',
      '计划委托': 'trigger', '单向止盈止损': 'conditional', '双向止盈止损': 'oco',
      '追逐限价': 'chase', '移动止盈止损': 'move_order_stop'
    };
    if (reverseOrdTypeMap[ordType]) ordType = reverseOrdTypeMap[ordType];

    const typesNeedingFirstPrice = ['limit', 'post_only', 'fok', 'ioc', 'trigger', 'market'];
    const rawFirstOrderPrice = config.first_order_price || '0';
    const firstOrderPriceNeedsN = isFormula(rawFirstOrderPrice) && formulaNeedsVar(rawFirstOrderPrice, 'n');

    const posSide = config.pos_side || "net";
    const skipDuplicateOrders = config.skip_duplicate_orders ?? false;
    const testMode = config.place_test_mode === true || config.test_mode === true;

    const isOkxSpotOrMargin = (tradeService as OKXTradeService).exchangeType === 'OKX' && !instId.includes('SWAP') && !instId.includes('FUTURES');
    const effectivePosSide = isOkxSpotOrMargin ? undefined : posSide;

    const rawFirstTpPrice = config.first_tp_price || "-1";
    const rawFirstSlPrice = config.first_sl_price || "-1";
    const rawActivePx = config.active_px || '-1';
    const activePxNeedsO = isFormula(rawActivePx) && formulaNeedsVar(rawActivePx, 'o');
    const activePxNeedsN = isFormula(rawActivePx) && formulaNeedsVar(rawActivePx, 'n');

    const allFormulaFields = [rawFirstOrderPrice, rawFirstTpPrice, rawFirstSlPrice, rawActivePx, rawOrderInterval, rawContractSize];
    const anyFormulaNeedsMarket = allFormulaFields.some(v =>
      isFormula(v) && (/[^a-zA-Z](m|M)[^a-zA-Z]/.test(` ${v.slice(1)} `) || /^(m|M)$/.test(v.slice(1).trim()))
    );
    let cachedMarketPrice: number | null = null;
    if (anyFormulaNeedsMarket) {
      cachedMarketPrice = await fetchMarketPrice(instId);
    }

    const anyFormulaNeedsPosition = allFormulaFields.some(v =>
      isFormula(v) && formulaNeedsVar(v.slice(1), 's')
    );
    let cachedPositionSize: number | null = null;
    if (anyFormulaNeedsPosition) {
      try {
        const positions = await tradeService.getPositions(instId);
        if (positions && positions.length > 0) {
          const matched = positions.find((p: OKXPosition) => {
            if (p.posSide !== posSide) return false;
            if (p.mgnMode && p.mgnMode !== tdMode) return false;
            return true;
          });
          if (matched) {
            const pos = parseFloat(matched.pos || '0');
            if (Number.isFinite(pos)) {
              cachedPositionSize = pos;
            }
          }
        }
      } catch (e: unknown) {
        LogService.logKey("trader", 'trader.warn.positionQueryFailed', {}, 'warn');
      }
      if (cachedPositionSize === null) {
        LogService.logKey("trader", 'trader.warn.noPositionSize', {}, 'warn');
      }
    }

    const anyFormulaNeedsS8 = allFormulaFields.some(v =>
      isFormula(v) && formulaNeedsVar(v.slice(1), 's8')
    );
    let cachedSodUtc8: number | null = null;
    if (anyFormulaNeedsS8) {
      cachedSodUtc8 = await fetchSodUtc8(instId);
      if (cachedSodUtc8 === null) {
        LogService.logKey("trader", 'trader.warn.noSodUtc8', {}, 'warn', configId);
      }
    }

    const commonExtraVars = {
      s: cachedPositionSize ?? undefined,
      s8: cachedSodUtc8 ?? undefined,
      marketPrice: cachedMarketPrice ?? undefined,
    };

    let tickSz = InstrumentService.getTickSz(instId);
    if (tickSz === null) {
      tickSz = await InstrumentService.fetchTickSzIfNeeded(instId);
    }
    if (tickSz === null) {
      LogService.logKey("trader", 'trader.warn.noTickSz', { instId }, 'warn', configId);
    }

    const ctVal = InstrumentService.getCtVal(instId);
    const lotSz = InstrumentService.getLotSz(instId);

    let firstOrderPrice = 0;
    if (typesNeedingFirstPrice.includes(ordType) && !firstOrderPriceNeedsN) {
      firstOrderPrice = isFormula(rawFirstOrderPrice)
        ? (await this.resolvePrice(rawFirstOrderPrice, instId, commonExtraVars)) ?? 0
        : parseFloat(rawFirstOrderPrice);
      firstOrderPrice = roundToTickSize(firstOrderPrice, tickSz);
      if (ordType !== 'market' && firstOrderPrice <= 0) {
        LogService.logKey("trader", 'trader.validation.firstPrice', {}, 'error', configId);
        return;
      }
    }

    const firstTpPrice = roundToTickSize(
      isFormula(rawFirstTpPrice)
        ? (await this.resolvePrice(rawFirstTpPrice, instId, commonExtraVars)) ?? -1
        : parseFloat(rawFirstTpPrice),
      tickSz
    );
    const firstSlPrice = roundToTickSize(
      isFormula(rawFirstSlPrice)
        ? (await this.resolvePrice(rawFirstSlPrice, instId, commonExtraVars)) ?? -1
        : parseFloat(rawFirstSlPrice),
      tickSz
    );
    const chaseVal = parseFloat(config.chase_val || "0");
    const tpSlType = config.tp_sl_type || 'tp_sl';
    const isMoveStop = tpSlType === 'move_stop';
    const rawCallback = config.callback_ratio_spread || config.callback_ratio || '1%';
    const isPercent = String(rawCallback).endsWith('%');
    const callbackRatioVal = isPercent ? parseFloat(String(rawCallback).replace('%', '')) / 100 : -1;
    const callbackSpreadVal = isPercent ? -1 : parseFloat(String(rawCallback));
    let activePxVal = -1;
    if (!activePxNeedsO && !activePxNeedsN) {
      activePxVal = roundToTickSize(
        isFormula(rawActivePx)
          ? (await this.resolvePrice(rawActivePx, instId, commonExtraVars)) ?? -1
          : parseFloat(rawActivePx),
        tickSz
      );
    }

    const cfgName = config.name || config.id || '?';
    const requestKey = createRequestIdempotencyKey("place", config.id || cfgName);
    const tmpCfg = config as PlaceConfigItem;
    const accountList = (finalAppConfig.accounts || []) as Array<{ id: string; name: string }>;
    const descSegments = buildPlaceDescSegments(tmpCfg, accountNames, {}, accountList, t);
    const descText = buildPlaceDescText(descSegments);
    const descFields = encodeDescFields(descSegments);

    LogService.logKey("trader", 'strategy.start', { type: '下单', name: cfgName, desc: descText, descFields }, 'info', configId);

    try {
      const isRegularOrder = ["market", "limit", "post_only", "fok", "ioc"].includes(ordType);
      let algoTypes: string[] | undefined;
      if (ordType === 'trigger') algoTypes = ['trigger'];
      else if (ordType === 'oco') algoTypes = ['oco'];
      else if (ordType === 'chase') algoTypes = ['chase'];
      else if (ordType === 'move_order_stop') algoTypes = ['move_order_stop'];
      else if (isRegularOrder) algoTypes = [];
      else algoTypes = ['conditional'];
      if ((tradeService as OKXTradeService).exchangeType === 'BINANCE' && algoTypes && algoTypes.length > 0) {
        algoTypes = [];
      }
      let existingPrices: number[] = [];
      let querySuccess = true;
      const lastPart = instIdParts[instIdParts.length - 1];
      const orderInstType = isFuturesInst 
        ? lastPart 
        : (tdMode === 'cross' || tdMode === 'isolated' ? 'MARGIN' : 'SPOT');
      if (!testMode && skipDuplicateOrders) {
        const monitor = AccountMonitor.getInstance();
        LogService.logKey("trader", 'order.fetching.list', {}, 'info', configId);
        try {
          await monitor.syncAccountOrders(accountIdx, algoTypes, orderInstType);
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          LogService.logKey("trader", 'order.fetching.list.failed', { msg: err.message }, 'error', configId);
          querySuccess = false;
        }
        if (!querySuccess) {
          LogService.logKey("trader", 'trader.warn.queryFailed', {}, 'warn', configId);
          return;
        }
        const allOrders = monitor.getOrders(accountIdx, instId);
        const filteredOrders = allOrders.filter(o => o.ordType === ordType);
        const isConditional = ordType === 'conditional';
        const isOco = ordType === 'oco';
        let matchOrders = filteredOrders;
        if (isConditional || isOco) {
          const binanceFuturesTpSl = allOrders.filter(o => {
            const ext = o as ExtendedOrder;
            return o.ordType === 'move_order_stop' &&
              ext.exchange === 'BINANCE' &&
              ext._algoType === 'CONDITIONAL' &&
              ['STOP', 'TAKE_PROFIT', 'STOP_MARKET', 'TAKE_PROFIT_MARKET'].includes(ext._execType || '');
          });
          const binanceSpotMarginConditional = allOrders.filter(o => {
            const ext = o as ExtendedOrder;
            if (ext.exchange !== 'BINANCE') return false;
            if (ext.algoId) return false;
            const cType = String(ext.contingencyType || '').toUpperCase();
            if (cType === 'OCO' || cType === 'OTOCO') return false;
            const oListId = ext.orderListId;
            if (oListId && String(oListId) !== '-1' && String(oListId) !== 'undefined') return false;
            const ot = String(o.ordType || '').toLowerCase();
            return ['stop_loss_limit', 'take_profit_limit', 'stop_market', 'take_profit_market'].includes(ot);
          });
          const binanceSpotMarginOco = allOrders.filter(o => {
            const ext = o as ExtendedOrder;
            if (ext.exchange !== 'BINANCE') return false;
            if (ext.algoId) return false;
            const cType = String(ext.contingencyType || '').toUpperCase();
            if (cType === 'OCO' || cType === 'OTOCO') return true;
            const oListId = ext.orderListId;
            if (oListId && String(oListId) !== '-1' && String(oListId) !== 'undefined') return true;
            return false;
          });
          matchOrders = [...filteredOrders, ...binanceFuturesTpSl];
          if (isConditional) matchOrders.push(...binanceSpotMarginConditional);
          if (isOco) matchOrders.push(...binanceSpotMarginOco);
        }
        const isMoveOrderStop = ordType === 'move_order_stop';
        if (isMoveOrderStop) {
          const binanceSpotTrailing = allOrders.filter(o => {
            const ext = o as ExtendedOrder;
            if (ext.exchange !== 'BINANCE') return false;
            if (ext.algoId) return false;
            const td = ext.trailingDelta;
            return td !== undefined && td !== null && td !== 0;
          });
          matchOrders.push(...binanceSpotTrailing);
        }
        existingPrices = matchOrders.map(o => {
          const ext = o as ExtendedOrder;
          const oType = o.ordType as string;
          const isOAlgo = !!ext.algoId;

          if (oType === 'trigger') {
            return parseFloat(ext.triggerPrice || ext.triggerPx || "0");
          } else if (oType === 'chase') {
            return parseFloat(ext.chaseVal || "0");
          } else if (oType === 'move_order_stop' || oType === 'trailing_stop_market' ||
                     (ext.exchange === 'BINANCE' && ext.trailingDelta)) {
            const execType = String(ext._execType || "").toUpperCase();
            if (ext.exchange === 'BINANCE' && ['STOP', 'TAKE_PROFIT', 'STOP_MARKET', 'TAKE_PROFIT_MARKET'].includes(execType)) {
              return parseFloat(ext.tpTriggerPx || ext.slTriggerPx || ext.triggerPrice || ext.triggerPx || "0");
            }
            if (ext.exchange === 'BINANCE') {
              return parseFloat(ext.activationPrice || ext.activatePrice || ext.activePx || "0");
            }
            return parseFloat(ext.activePx || "0");
          } else if (!isOAlgo) {
            return parseFloat(ext.px || ext.orderPrice || "0");
          } else if (oType === 'conditional' || oType === 'oco' || isConditional || isOco) {
            const ot = String(oType || '').toLowerCase();
            const isBinanceSpotMarginTpSl = ext.exchange === 'BINANCE' &&
              ['stop_loss_limit', 'take_profit_limit', 'stop_market', 'take_profit_market'].includes(ot) &&
              !ext.algoId;
            if (isBinanceSpotMarginTpSl) {
              return parseFloat(ext.tpPrice || ext.slPrice || ext.triggerPx || "0");
            }
            return parseFloat(ext.tpTriggerPx || ext.slTriggerPx || ext.triggerPrice || ext.triggerPx || "0");
          }
          return 0;
        }).filter(p => p > 0);
      }

      let marketBasePrice: number | null = null;
      if (ordType === 'market' || ordType === 'conditional') {
        marketBasePrice = await tradeService.getMarketPrice(instId);
        if (marketBasePrice) {
          LogService.logKey("trader", ordType === 'market' ? 'order.market.preFetch' : 'order.conditional.preFetch', { price: String(marketBasePrice) }, 'info', configId);
        } else {
          LogService.logKey("trader", 'trader.warn.noMarketPrice', {}, 'warn', configId);
        }
      }

      const batchOrders: ActionPlaceOrderParams[] = [];
      let successCount = 0;
      let failCount = 0;
      const failures: Array<{ index: number; sMsg: string }> = [];

      let accumulatedOffset = 0;
      let actualPlacedCount = 0;

      let cachedVars: Record<string, number> = {};
      const needsM = formulaNeedsVar(rawOrderInterval, 'm') || formulaNeedsVar(rawContractSize, 'm');

      if (needsM && instId) {
        const marketPrice = await fetchMarketPrice(instId);
        if (marketPrice !== null) {
          cachedVars.m = marketPrice;
          cachedVars.M = marketPrice;
        }
      }

      if (cachedPositionSize !== null) {
        cachedVars.s = cachedPositionSize;
        cachedVars.S = cachedPositionSize;
      }

      if (cachedSodUtc8 !== null) {
        cachedVars.s8 = cachedSodUtc8;
        cachedVars.S8 = cachedSodUtc8;
      }

      if (ctVal !== null) {
        cachedVars.cv = ctVal;
        cachedVars.CV = ctVal;
      }
      if (lotSz !== null) {
        cachedVars.ls = lotSz;
        cachedVars.LS = lotSz;
      }

      for (let i = 0; i < actualNumOrders; i++) {
        try {
        const n = i;
        let curFirstOrderPrice = firstOrderPrice;
        if (firstOrderPriceNeedsN) {
          curFirstOrderPrice = roundToTickSize(
            (await PlaceOrderAction.resolvePrice(rawFirstOrderPrice, instId, { n, s: cachedPositionSize ?? undefined, s8: cachedSodUtc8 ?? undefined, marketPrice: cachedMarketPrice !== null ? cachedMarketPrice : undefined })) ?? 0,
            tickSz
          );
          if (curFirstOrderPrice <= 0 && ordType !== 'market') {
            LogService.logKey("trader", 'order.skipped', { num: i + 1, reason: `委托价公式求值失败` }, 'warn', configId);
            continue;
          }
        }

        let priceOffset = 0;
        if (isIntervalFormula) {
          if (formulaNeedsVar(rawOrderInterval, 's8') && cachedSodUtc8 === null) {
            LogService.logKey("trader", 'trader.warn.noSodUtc8', {}, 'warn', configId);
            continue;
          }
          if (i > 0) {
            const intervalN = actualPlacedCount;
            const vars = { ...cachedVars, n: intervalN, N: intervalN };
            const intervalResult = evaluateFormula(rawOrderInterval, vars);
            if (intervalResult.error || intervalResult.result === null) {
              LogService.logKey("trader", 'trader.warn.intervalFormulaError', { num: i + 1, formula: rawOrderInterval, error: intervalResult.error || '未知错误' }, 'warn', configId);
              continue;
            }
            accumulatedOffset += intervalResult.result;
            priceOffset = direction === "up" ? accumulatedOffset : -accumulatedOffset;
          }
        } else if (isIntervalPercent) {
          const percentInterval = curFirstOrderPrice * intervalPercent;
          priceOffset = direction === "up" ? i * percentInterval : -i * percentInterval;
        } else {
          priceOffset = direction === "up" ? i * baseInterval : -i * baseInterval;
        }

        let contractSize = "1";
        if (isSizeFormula) {
          const vars = { ...cachedVars, n, N: n, o: curFirstOrderPrice, O: curFirstOrderPrice };
          const sizeResult = evaluateFormula(rawContractSize, vars);
          if (sizeResult.error || sizeResult.result === null) {
            LogService.logKey("trader", 'trader.warn.sizeFormulaError', { num: i + 1, formula: rawContractSize, error: sizeResult.error || '未知错误' }, 'warn', configId);
            continue;
          }
          const roundedSize = Math.round(sizeResult.result * 1e8) / 1e8;
          contractSize = roundedSize.toString();
        } else {
          contractSize = rawContractSize;
        }

        if (ordType === 'trigger') {
          const r = await PlaceOrderAction.placeTriggerOrder({
            i, ordType, instId, side, tdMode, effectivePosSide, contractSize, requestKey,
            curFirstOrderPrice, priceOffset, direction, rawActivePx, activePxNeedsO, activePxNeedsN,
            activePxVal, isMoveStop, tpDisplay, slDisplay, callbackRatioVal, callbackSpreadVal,
            takeProfitMargin, stopLossMargin, tpIsPercent, slIsPercent,
            tpOrdMargin, slOrdMargin, tpOrdIsPercent, slOrdIsPercent,
            skipDuplicateOrders, existingPrices, testMode, configId,
            tradeService, cachedPositionSize, cachedMarketPrice, cachedSodUtc8, actualNumOrders, posSide, tickSz,
          });
          if (r.success) successCount++;
          if (r.placed) actualPlacedCount++;
          if (!r.success && r.placed) failCount++;
        } else if (ordType === 'conditional' || ordType === 'oco') {
          const r = await PlaceOrderAction.placeConditionalOrder({
            i, ordType, instId, side, tdMode, effectivePosSide, contractSize, requestKey,
            firstTpPrice, firstSlPrice, priceOffset, marketBasePrice,
            skipDuplicateOrders, existingPrices, testMode, configId,
            tradeService, actualNumOrders, tickSz,
          });
          if (r.success) successCount++;
          if (r.placed) actualPlacedCount++;
          if (!r.success && r.placed) failCount++;
        } else if (ordType === 'chase') {
          const r = await PlaceOrderAction.placeChaseOrder({
            i, ordType, instId, side, tdMode, effectivePosSide, contractSize, requestKey,
            chaseVal, priceOffset, skipDuplicateOrders, existingPrices,
            testMode, configId, tradeService, actualNumOrders, tickSz,
          });
          if (r.success) successCount++;
          if (r.placed) actualPlacedCount++;
          if (!r.success && r.placed) failCount++;
        } else if (ordType === 'move_order_stop') {
          const r = await PlaceOrderAction.placeMoveOrderStopOrder({
            i, ordType, instId, side, tdMode, effectivePosSide, contractSize, requestKey,
            activePxVal, priceOffset, callbackRatioVal, callbackSpreadVal,
            skipDuplicateOrders, existingPrices, testMode, configId,
            tradeService, actualNumOrders, tickSz,
          });
          if (r.success) successCount++;
          if (r.placed) actualPlacedCount++;
          if (!r.success && r.placed) failCount++;
        } else {
          let basePrice = curFirstOrderPrice;
          if (ordType === 'market') {
            if (marketBasePrice) { basePrice = marketBasePrice; }
            else if (basePrice <= 0) { LogService.logKey("trader", 'trader.warn.noMarketPriceTpSl', {}, 'warn', configId); }
          }
          const effectiveOffset = ordType === 'market' ? 0 : priceOffset;
          const px = roundToTickSize(parseFloat((basePrice + effectiveOffset).toFixed(8)), tickSz);
          const curActivePx = (activePxNeedsO || activePxNeedsN)
            ? roundToTickSize(
                (await PlaceOrderAction.resolvePrice(rawActivePx, instId, { o: px, n, s: cachedPositionSize ?? undefined, s8: cachedSodUtc8 ?? undefined, marketPrice: cachedMarketPrice !== null ? cachedMarketPrice : undefined })) ?? -1,
                tickSz
              )
            : activePxVal;
          if (px <= 0 && ordType !== 'market') {
            LogService.logKey("trader", 'order.skipped', { num: i + 1, reason: `委托价 ${px} 无效` }, 'warn', configId);
            continue;
          }
          if (skipDuplicateOrders && ordType !== 'market' && existingPrices.includes(px) && px > 0) {
            LogService.logKey("trader", 'order.skip.duplicate.ordPx', { px: String(px) }, 'info', configId);
            continue;
          }
          if (testMode) {
            if (isMoveStop) {
              const simParams: Record<string, unknown> = { num: i + 1, ordPx: ordType === 'market' ? '市价' : px, sz: contractSize, sl: slDisplay };
              if (callbackRatioVal > 0) simParams.callbackRatio = callbackRatioVal;
              if (callbackSpreadVal > 0) simParams.callbackSpread = callbackSpreadVal;
              if (curActivePx > 0) simParams.activePx = curActivePx;
              LogService.logKey("trader", 'order.simulate', simParams, 'info', configId);
            } else {
              LogService.logKey("trader", 'order.simulate', { num: i + 1, ordPx: ordType === 'market' ? '市价' : px, sz: contractSize, tp: tpDisplay, sl: slDisplay }, 'info', configId);
            }
          } else {
            const attachAlgoOrds = PlaceOrderAction.buildAttachAlgoOrds(
              { side, posSide, isMoveStop, tpMargin: takeProfitMargin, slMargin: stopLossMargin, tpIsPercent, slIsPercent, tpOrdMargin, slOrdMargin, tpOrdIsPercent, slOrdIsPercent, callbackRatioVal, callbackSpreadVal, activePxVal: curActivePx },
              px, requestKey, i, tickSz
            );
            const orderParams: ActionPlaceOrderParams = {
              instId, side, ordType, sz: contractSize.toString(), tdMode,
              posSide: effectivePosSide, px: ordType !== 'market' ? px.toString() : undefined,
              clOrdId: createChildIdempotencyKey(requestKey, i),
              attachAlgoOrds: attachAlgoOrds.length > 0 ? attachAlgoOrds : undefined,
              _curActivePx: isMoveStop && curActivePx > 0 ? curActivePx : undefined,
            };
            batchOrders.push(orderParams);
          }
        }

        if (batchOrders.length === 20 || i === actualNumOrders - 1) {
          if (batchOrders.length > 0) {
            const r = await PlaceOrderAction.flushBatchOrders({
              batchOrders, i, actualNumOrders, tradeService, ordType,
              isMoveStop, callbackRatioVal, callbackSpreadVal, tpDisplay, slDisplay, configId,
            });
            successCount += r.successCount;
            failCount += r.failCount;
            failures.push(...r.failures);
            actualPlacedCount += r.successCount;
          }
          await new Promise(r2 => setTimeout(r2, 150));
        }
        } catch (loopErr: unknown) {
          failCount++;
          const errMsg = loopErr instanceof Error ? loopErr.message : String(loopErr);
          LogService.logKey("trader", 'order.exception', { num: i + 1, msg: errMsg }, 'error', configId);
        }
      }

      if (!testMode && successCount > 0) {
        await AccountMonitor.getInstance().syncAccountOrders(accountIdx, algoTypes, orderInstType);
      }

      LogService.logKey("trader", 'action.complete', { op: '下单', success: successCount, fail: failCount }, 'info', configId);
      return { successCount, failCount, failures };
    } catch (e: unknown) {
      const err = e as Error;
      LogService.logKey("trader", 'action.exception', { msg: err.message || String(e) }, 'error', configId);
      throw e;
    }
  }
}
