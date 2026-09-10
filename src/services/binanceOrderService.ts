import type { BinanceSdkTradeService, BinanceSdkInfra } from './binanceSdkTradeService.ts';
import { _shouldLogBinanceError } from './binanceSdkTradeService.ts';
import { LogService } from './logService.ts';
import { isPendingNewState } from '../lib/orderStates.ts';

export class BinanceOrderService {
  constructor(private sdk: BinanceSdkInfra) {}

  async getMarketPrice(instId: string): Promise<number | null> {
    const symbol = this.sdk.toBinanceSymbol(instId);
    try {
      if (this.sdk.isFutures(instId)) {
        const res = await this.sdk.usdsFuturesClient.restAPI.symbolPriceTicker({ symbol } as never);
        const data = await this.sdk.extractData(res);
        const price = Number(data?.price || data?.[0]?.price);
        return Number.isFinite(price) ? price : null;
      }
      const res = await this.sdk.spotClient.restAPI.tickerPrice({ symbol } as never);
      const data = await this.sdk.extractData(res);
      const price = Number(data?.price || data?.[0]?.price);
      return Number.isFinite(price) ? price : null;
    } catch(e: unknown) {
      LogService.logKey("system", 'account.market.failed', { exchange: 'BINANCE', label: this.sdk.accountLabel(), msg: (e as Error).message || String(e) }, 'error');
      return null;
    }
  }

    return this.sdk.marginClient.restAPI.marginAccountNewOrder(payload as never);
  }

    return this.sdk.marginClient.restAPI.marginAccountCancelOrder(payload as never);
  }

    return this.sdk.marginClient.restAPI.marginAccountCancelOco(payload as never);
  }

    return this.sdk.spotClient.restAPI.sendSignedRequest('/api/v3/orderList', 'DELETE', payload);
  }

    return this.sdk.marginClient.restAPI.marginAccountNewOco(payload as never);
  }

    return this.sdk.marginClient.restAPI.marginAccountNewOto(payload as never);
  }

    return this.sdk.marginClient.restAPI.marginAccountNewOtoco(payload as never);
  }

  async placeBatchOrders(orders: Array<Record<string, unknown>>) {
    return this.placeOrders(orders);
  }

  async placeAlgoOrder(params: Record<string, unknown>) {
    const instId = String(params.instId || "");
    const symbol = this.sdk.toBinanceSymbol(instId);
    const side = String(params.side || "buy").toUpperCase();
    const sz = String(params.sz || "0");

    try {
      const isTrailingStop = !!params.callbackRatio;
      if (isTrailingStop) {
        const res = await this.sdk.withTimestampRetry(false, async () => {
          const payload: any = {
            symbol,
            side,
            type: "TRAILING_STOP_MARKET",
            quantity: sz,
            callbackRate: String(parseFloat(String(params.callbackRatio)) * 100),
          };
          if (params.activePx && params.activePx !== '-1') payload.activationPrice = String(params.activePx);
          this.sdk.applyTiming(payload, false);
          return this.sdk.spotClient.restAPI.newOrder(payload as never);
        });
        const data = await this.sdk.extractData(res) || {};
        return this.sdk.ok([{ ...data, ordId: data.orderId ? String(data.orderId) : "" }]);
      }
      
      const stopPrice = params.triggerPx || params.slTriggerPx || params.tpTriggerPx;
      if (stopPrice) {
          const res = await this.sdk.withTimestampRetry(false, async () => {
            const payload: any = {
              symbol,
              side,
              type: "STOP_LOSS_LIMIT",
              quantity: sz,
              stopPrice: String(stopPrice),
              price: String(stopPrice),
              timeInForce: "GTC",
            };
            this.sdk.applyTiming(payload, false);
            return this.sdk.spotClient.restAPI.newOrder(payload as never);
          });
          const data = await this.sdk.extractData(res) || {};
          return this.sdk.ok([{ ...data, ordId: data.orderId ? String(data.orderId) : "" }]);
      }

      return this.sdk.fail("Unsupported Binance algo order configuration.");
    } catch (e: unknown) {
      return this.sdk.fail((e as Error).message || String(e));
    }
  }

  async amendBatchOrders(params: Array<Record<string, unknown>>) {
    if (!Array.isArray(params) || params.length === 0) return this.sdk.ok([]);

    const results: Array<Record<string, unknown>> = [];
    for (const item of params) {
      const instId = String(item.instId || "");
      const symbol = this.sdk.toBinanceSymbol(instId);
      const isFutures = this.sdk.isFutures(instId);
      const ordId = item.ordId ? String(item.ordId) : undefined;
      const algoId = item.algoId ? String(item.algoId) : undefined;
      const newPx = item.newPx !== undefined ? String(item.newPx) : undefined;
      const newSz = item.newSz !== undefined ? String(item.newSz) : undefined;
      const newTriggerPx = item.newTriggerPx || item.newTpTriggerPx || item.newSlTriggerPx;

      try {
        if (isFutures) {
          if (algoId) {
            await this.amendFuturesAlgoOrderByRecreate(item, instId, symbol, algoId);
          } else {
            if (!ordId) throw new Error("Missing ordId for futures amend.");
            const openOrders = await this.getOpenOrders(instId);
            const found = openOrders.find((o: any) => String(o.ordId || "") === ordId);
            let side = item.side ? String(item.side).toUpperCase() : "";
            if (!side) {
              side = found?.side ? String(found.side).toUpperCase() : "";
            }
            if (!side) throw new Error("Missing side for futures amend.");
            const price = newPx !== undefined
              ? newPx
              : (found?.px !== undefined ? String(found.px) : (found?.price !== undefined ? String(found.price) : ""));
            if (!price) throw new Error("Missing price for futures amend.");

            const payload: Record<string, unknown> = { symbol, orderId: ordId, side };
            payload.price = price;
            if (newSz !== undefined) payload.quantity = newSz;
            if (newTriggerPx !== undefined) payload.stopPrice = String(newTriggerPx);

            await this.sdk.withTimestampRetry(true, async () => {
              this.sdk.applyTiming(payload, true);
              return this.sdk.usdsFuturesClient.restAPI.modifyOrder(payload as never);
            });
          }
        } else {
          const tdMode = String(item.tdMode || "cash").toLowerCase();
          const isMargin = tdMode === 'cross' || tdMode === 'isolated';

          if (isMargin) {
            await this.amendMarginOrderByRecreate(item, instId, symbol, ordId);
          } else {
            await this.amendSpotOrderByRecreate(item, instId, symbol, ordId);
          }
        }
        results.push({ ordId: ordId || algoId || "", sCode: "0", sMsg: "" });
      } catch (e: unknown) {
        const message = (e as Error).message || String(e);
        results.push({ ordId: ordId || algoId || "", sCode: "-1", sMsg: message });
      }
    }
    return this.sdk.ok(results);
  }

    item: Record<string, unknown>,
    instId: string,
    symbol: string,
    ordId?: string
  ): Promise<void> {
    if (!ordId) throw new Error("Missing ordId for spot amend.");
    const openOrders = await this.getOpenOrders(instId);
    const target = openOrders.find((o: any) => String(o.ordId || "") === ordId);
    if (!target) {
      throw new Error(`Spot order not found for amend (cancel+recreate): ordId=${ordId}`);
    }

    const orderListId = target.orderListId ? String(target.orderListId) : undefined;
    const contingencyType = target.contingencyType ? String(target.contingencyType).toUpperCase() : undefined;
    const targetType = String(target.type || target.origType || "").toUpperCase();
    const isSpotOco =
      contingencyType === 'OCO' ||
      !!orderListId ||
      ['LIMIT_MAKER', 'STOP_LOSS_LIMIT', 'STOP_LOSS', 'TAKE_PROFIT_LIMIT', 'TAKE_PROFIT'].includes(targetType);
    if (isSpotOco) {
      const ocoPair = this.findMarginOcoPairBySnapshot(openOrders as any[], target as any);
      if (ocoPair) {
        await this.amendSpotOcoRecreateByPair(item, symbol, ocoPair.tpLeg, ocoPair.slLeg, orderListId);
        return;
      }
    }

    const otocoGroup = this.findSpotOtocoGroupBySnapshot(openOrders as any[], target as any);
    if (otocoGroup) {
      await this.amendSpotOtocoRecreateByGroup(item, symbol, otocoGroup.mainLeg, otocoGroup.tpLeg, otocoGroup.slLeg);
      return;
    }

    const otoGroup = this.findSpotOtoGroupBySnapshot(openOrders as any[], target as any);
    if (otoGroup) {
      await this.amendSpotOtoRecreateByGroup(item, symbol, otoGroup.mainLeg, otoGroup.pendingLeg);
      return;
    }

    const side = String(target.side || item.side || "").toUpperCase();
    if (!side) throw new Error(`Missing side for spot amend recreate: ordId=${ordId}`);

    const origType = String(target.type || target.origType || "LIMIT").toUpperCase();
    const newPx = item.newPx !== undefined ? String(item.newPx) : undefined;
    const newSz = item.newSz !== undefined ? String(item.newSz) : undefined;
    const newTriggerPx = item.newTriggerPx !== undefined ? String(item.newTriggerPx) : undefined;
    const newOrdPx = item.newOrdPx !== undefined ? String(item.newOrdPx) : undefined;
    const newCallbackRate = item.callbackRate !== undefined ? String(item.callbackRate) : undefined;
    const trailingDeltaNum = Number(target.trailingDelta);
    const isSpotTrailingByDelta = Number.isFinite(trailingDeltaNum) && trailingDeltaNum > 0;
    const moveStopHint = newCallbackRate !== undefined;
    const quantity = newSz ?? target.sz ?? target.quantity ?? target.origQty ?? "";
    if (!quantity) {
      throw new Error(`Invalid spot amend recreate payload: qty=${quantity}`);
    }

    const cancelPayload: Record<string, unknown> = { symbol, orderId: ordId };
    await this.sdk.withTimestampRetry(false, async () => {
      this.sdk.applyTiming(cancelPayload, false);
      return this.sdk.spotClient.restAPI.deleteOrder(cancelPayload as never);
    });

    const recreatePayload: Record<string, unknown> = { symbol, side, type: origType, quantity: String(quantity) };
    const tif = String(target.timeInForce || "GTC");

    if (origType === 'LIMIT' || origType === 'LIMIT_MAKER') {
      const price = newPx ?? target.px ?? target.price ?? target.ordPx ?? "";
      if (!price) throw new Error(`Invalid spot limit amend recreate payload: missing price`);
      recreatePayload.price = String(price);
      recreatePayload.timeInForce = tif;
    } else if (
      origType === 'TRAILING_STOP_MARKET'
      || isSpotTrailingByDelta
      || (moveStopHint && ['TAKE_PROFIT', 'STOP_LOSS', 'TAKE_PROFIT_LIMIT', 'STOP_LOSS_LIMIT'].includes(origType))
    ) {
      const callbackIncrementRatio = newCallbackRate !== undefined ? Number(newCallbackRate) / 100 : 0;
      const baseTrailingRatio = isSpotTrailingByDelta
        ? Number(target.trailingDelta) / 10000
        : Number(target.callbackRate ?? target.priceRate ?? 0.1);
      const nextTrailingRatio = Number((baseTrailingRatio + callbackIncrementRatio).toFixed(6));
      const nextTrailingDelta = Math.max(1, Math.round(nextTrailingRatio * 10000));
      const activationPrice = newTriggerPx ?? target.activationPrice ?? target.activatePrice ?? target.triggerPx ?? target.stopPrice ?? "";

      recreatePayload.trailingDelta = nextTrailingDelta;
      if (activationPrice) {
        recreatePayload.activationPrice = String(activationPrice);
        recreatePayload.stopPrice = String(activationPrice);
      }
    } else if (['STOP_LOSS_LIMIT', 'TAKE_PROFIT_LIMIT'].includes(origType)) {
      const price = newOrdPx ?? newPx ?? target.ordPx ?? target.px ?? target.price ?? "";
      const stopPrice = newTriggerPx ?? target.triggerPx ?? target.stopPrice ?? "";
      if (!price || !stopPrice) {
        throw new Error(`Invalid spot conditional amend recreate payload: price=${price}, stopPrice=${stopPrice}`);
      }
      recreatePayload.price = String(price);
      recreatePayload.stopPrice = String(stopPrice);
      recreatePayload.timeInForce = tif;
    } else if (['STOP_LOSS', 'TAKE_PROFIT'].includes(origType)) {
      const stopPrice = newTriggerPx ?? target.triggerPx ?? target.stopPrice ?? "";
      if (!stopPrice) throw new Error(`Invalid spot trigger amend recreate payload: missing stopPrice`);
      recreatePayload.stopPrice = String(stopPrice);
    } else {
      throw new Error(`Spot amend currently only supports LIMIT/CONDITIONAL by recreate: type=${origType}`);
    }

    recreatePayload.newClientOrderId = `amend_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    await this.sdk.withTimestampRetry(false, async () => {
      this.sdk.applyTiming(recreatePayload, false);
      return this.sdk.spotClient.restAPI.newOrder(recreatePayload as never);
    });
  }

    const targetTime = Number(target?.cTime ?? target?.time ?? 0);
    if (!Number.isFinite(targetTime) || targetTime <= 0) return null;
    const targetSide = String(target?.side || "").toUpperCase();
    const targetType = String(target?.type || "").toUpperCase();
    if (targetType !== "LIMIT") return null;

    const sameGroup = openOrders.filter((o: any) => {
      const t = Number(o?.cTime ?? o?.time ?? 0);
      return t === targetTime;
    });
    const mainLeg = sameGroup.find((o: any) => String(o?.type || "").toUpperCase() === "LIMIT" && String(o?.side || "").toUpperCase() === targetSide);
    const pendingLeg = sameGroup.find((o: any) => {
      const t = String(o?.type || "").toUpperCase();
      const side = String(o?.side || "").toUpperCase();
      return isPendingNewState(o)
        && side !== targetSide
        && ["LIMIT_MAKER", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT", "STOP_LOSS", "TAKE_PROFIT"].includes(t);
    });
    if (!mainLeg || !pendingLeg) return null;
    return { mainLeg, pendingLeg };
  }

    const targetTime = Number(target?.cTime ?? target?.time ?? 0);
    if (!Number.isFinite(targetTime) || targetTime <= 0) return null;
    const targetSide = String(target?.side || "").toUpperCase();
    const targetType = String(target?.type || "").toUpperCase();
    if (targetType !== "LIMIT") return null;

    const sameGroup = openOrders.filter((o: any) => Number(o?.cTime ?? o?.time ?? 0) === targetTime);
    const mainLeg = sameGroup.find((o: any) => String(o?.type || "").toUpperCase() === "LIMIT" && String(o?.side || "").toUpperCase() === targetSide);
    const pendingLegs = sameGroup.filter((o: any) => {
      const side = String(o?.side || "").toUpperCase();
      return isPendingNewState(o) && side !== targetSide;
    });
    if (!mainLeg || pendingLegs.length < 2) return null;

    const tpLeg = pendingLegs.find((o: any) => {
      const t = String(o?.type || "").toUpperCase();
      return t === "LIMIT_MAKER" || t === "TAKE_PROFIT_LIMIT" || t === "TAKE_PROFIT";
    });
    const slLeg = pendingLegs.find((o: any) => {
      const t = String(o?.type || "").toUpperCase();
      return t === "STOP_LOSS_LIMIT" || t === "STOP_LOSS";
    });
    if (!tpLeg || !slLeg) return null;
    return { mainLeg, tpLeg, slLeg };
  }

    item: Record<string, unknown>,
    symbol: string,
    mainLeg: any,
    pendingLeg: any
  ): Promise<void> {
    const workingSide = String(mainLeg.side || item.side || "").toUpperCase();
    const pendingSide = String(pendingLeg.side || (workingSide === "BUY" ? "SELL" : "BUY")).toUpperCase();
    const workingPriceBase = Number(mainLeg.price ?? mainLeg.px ?? 0);
    const workingQty = String(item.newSz ?? mainLeg.origQty ?? mainLeg.sz ?? mainLeg.quantity ?? "");
    if (!workingSide || !pendingSide || !workingQty || !Number.isFinite(workingPriceBase)) {
      throw new Error("Invalid spot OTO amend snapshot.");
    }

    const pxInc = Number(item.newPx !== undefined ? Number(item.newPx) - workingPriceBase : 0);
    const workingPrice = item.newPx !== undefined ? Number(item.newPx) : workingPriceBase;

    const tpParsed = this.sdk.parsePercentIncrement(item.tpIncrement ?? item.tpPxIncrement ?? 0);
    const slParsed = this.sdk.parsePercentIncrement(item.slIncrement ?? item.slPxIncrement ?? 0);

    const pendingType = String(pendingLeg.type || "").toUpperCase();

    const payload: any = {
      symbol,
      workingType: "LIMIT",
      workingSide,
      workingPrice: String(Number(workingPrice.toFixed(8))),
      workingQuantity: String(workingQty),
      workingTimeInForce: String(mainLeg.timeInForce || "GTC").toUpperCase(),
      pendingSide,
      pendingQuantity: String(workingQty),
      listClientOrderId: `amendoto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };

    if (pendingType === "LIMIT_MAKER") {
      payload.pendingType = "LIMIT_MAKER";
      let newPendingPrice: number;
      if (tpParsed.isPercent && tpParsed.value !== 0) {
        newPendingPrice = this.sdk.calculateTpSlPrice(workingPrice, tpParsed.value, true, workingSide, true);
      } else {
        const pendingPriceBase = Number(pendingLeg.price ?? pendingLeg.px ?? 0);
        newPendingPrice = Number((pendingPriceBase + (tpParsed.value || pxInc)).toFixed(8));
      }
      payload.pendingPrice = String(newPendingPrice);
    } else if (pendingType === "TAKE_PROFIT_LIMIT" || pendingType === "TAKE_PROFIT") {
      payload.pendingType = "TAKE_PROFIT_LIMIT";
      let newPendingPrice: number;
      let newPendingStop: number;
      if (tpParsed.isPercent && tpParsed.value !== 0) {
        newPendingPrice = this.sdk.calculateTpSlPrice(workingPrice, tpParsed.value, true, workingSide, true);
        newPendingStop = newPendingPrice;
      } else {
        const pendingPriceBase = Number(pendingLeg.price ?? pendingLeg.px ?? 0);
        const pendingStopBase = Number(pendingLeg.stopPrice ?? pendingLeg.triggerPx ?? 0);
        newPendingPrice = Number((pendingPriceBase + (tpParsed.value || pxInc)).toFixed(8));
        newPendingStop = Number((pendingStopBase + (tpParsed.value || pxInc)).toFixed(8));
      }
      payload.pendingPrice = String(newPendingPrice);
      payload.pendingStopPrice = String(newPendingStop);
      payload.pendingTimeInForce = "GTC";
    } else {
      payload.pendingType = "STOP_LOSS_LIMIT";
      let newPendingPrice: number;
      let newPendingStop: number;
      if (slParsed.isPercent && slParsed.value !== 0) {
        newPendingPrice = this.sdk.calculateTpSlPrice(workingPrice, slParsed.value, true, workingSide, false);
        newPendingStop = newPendingPrice;
      } else {
        const pendingPriceBase = Number(pendingLeg.price ?? pendingLeg.px ?? 0);
        const pendingStopBase = Number(pendingLeg.stopPrice ?? pendingLeg.triggerPx ?? 0);
        newPendingPrice = Number((pendingPriceBase + (slParsed.value || pxInc)).toFixed(8));
        newPendingStop = Number((pendingStopBase + (slParsed.value || pxInc)).toFixed(8));
      }
      payload.pendingPrice = String(newPendingPrice);
      payload.pendingStopPrice = String(newPendingStop);
      payload.pendingTimeInForce = "GTC";
    }

    for (const leg of [mainLeg, pendingLeg]) {
      const oid = String(leg.ordId || leg.orderId || "");
      if (!oid) continue;
      const cancelPayload: Record<string, unknown> = { symbol, orderId: oid };
      try {
        await this.sdk.withTimestampRetry(false, async () => {
          this.sdk.applyTiming(cancelPayload, false);
          return this.sdk.spotClient.restAPI.deleteOrder(cancelPayload as never);
        });
      } catch (e: unknown) {
        const msg = (e as any)?.response?.data?.msg || (e as Error)?.message || String(e);
        if (String(msg).toLowerCase().includes("unknown order")) continue;
        throw e;
      }
    }

    await this.sdk.withTimestampRetry(false, async () => {
      this.sdk.applyTiming(payload, false);
      if (typeof (this.sdk.spotClient.restAPI as any).orderListOto === "function") {
        return (this.sdk.spotClient.restAPI as any).orderListOto(payload as never);
      }
      throw new Error("orderListOto not supported by SDK format");
    });
  }

    item: Record<string, unknown>,
    symbol: string,
    mainLeg: any,
    tpLeg: any,
    slLeg: any
  ): Promise<void> {
    const workingSide = String(mainLeg.side || item.side || "").toUpperCase();
    const pendingSide = String(tpLeg.side || slLeg.side || (workingSide === "BUY" ? "SELL" : "BUY")).toUpperCase();
    const workingPriceBase = Number(mainLeg.price ?? mainLeg.px ?? 0);
    const workingQty = String(item.newSz ?? mainLeg.origQty ?? mainLeg.sz ?? mainLeg.quantity ?? "");
    if (!workingSide || !pendingSide || !workingQty || !Number.isFinite(workingPriceBase)) {
      throw new Error("Invalid spot OTOCO amend snapshot.");
    }

    const pxInc = Number(item.newPx !== undefined ? Number(item.newPx) - workingPriceBase : 0);
    const workingPrice = item.newPx !== undefined ? Number(item.newPx) : workingPriceBase;

    const tpParsed = this.sdk.parsePercentIncrement(item.tpPxIncrement ?? item.tpIncrement ?? 0);
    const slParsed = this.sdk.parsePercentIncrement(item.slPxIncrement ?? item.slIncrement ?? 0);

    let newTpPrice: number;
    let newSlPrice: number;
    let newSlStop: number;

    if (tpParsed.isPercent && tpParsed.value !== 0) {
      newTpPrice = this.sdk.calculateTpSlPrice(workingPrice, tpParsed.value, true, workingSide, true);
    } else {
      const tpPriceBase = Number(tpLeg.price ?? tpLeg.px ?? 0);
      newTpPrice = Number((tpPriceBase + (tpParsed.value || pxInc)).toFixed(8));
    }

    if (slParsed.isPercent && slParsed.value !== 0) {
      newSlPrice = this.sdk.calculateTpSlPrice(workingPrice, slParsed.value, true, workingSide, false);
      newSlStop = newSlPrice;
    } else {
      const slPriceBase = Number(slLeg.price ?? slLeg.px ?? 0);
      const slStopBase = Number(slLeg.stopPrice ?? slLeg.triggerPx ?? 0);
      newSlPrice = Number((slPriceBase + (slParsed.value || pxInc)).toFixed(8));
      newSlStop = Number((slStopBase + (slParsed.value || pxInc)).toFixed(8));
    }

    const payload: any = {
      symbol,
      workingType: "LIMIT",
      workingSide,
      workingPrice: String(Number(workingPrice.toFixed(8))),
      workingQuantity: String(workingQty),
      workingTimeInForce: String(mainLeg.timeInForce || "GTC").toUpperCase(),
      pendingSide,
      pendingQuantity: String(workingQty),
      pendingAboveType: "LIMIT_MAKER",
      pendingAbovePrice: String(newTpPrice),
      pendingBelowType: "STOP_LOSS_LIMIT",
      pendingBelowPrice: String(newSlPrice),
      pendingBelowStopPrice: String(newSlStop),
      pendingBelowTimeInForce: "GTC",
      listClientOrderId: `amendotoco_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };

    for (const leg of [mainLeg, tpLeg, slLeg]) {
      const oid = String(leg.ordId || leg.orderId || "");
      if (!oid) continue;
      const cancelPayload: Record<string, unknown> = { symbol, orderId: oid };
      try {
        await this.sdk.withTimestampRetry(false, async () => {
          this.sdk.applyTiming(cancelPayload, false);
          return this.sdk.spotClient.restAPI.deleteOrder(cancelPayload as never);
        });
      } catch (e: unknown) {
        const msg = (e as any)?.response?.data?.msg || (e as Error)?.message || String(e);
        if (String(msg).toLowerCase().includes("unknown order")) continue;
        throw e;
      }
    }

    await this.sdk.withTimestampRetry(false, async () => {
      this.sdk.applyTiming(payload, false);
      if (typeof (this.sdk.spotClient.restAPI as any).orderListOtoco === "function") {
        return (this.sdk.spotClient.restAPI as any).orderListOtoco(payload as never);
      }
      throw new Error("orderListOtoco not supported by SDK format");
    });
  }

    item: Record<string, unknown>,
    symbol: string,
    tpLeg: any,
    slLeg: any,
    orderListId?: string
  ): Promise<void> {
    const side = String(tpLeg.side || slLeg.side || item.side || "").toUpperCase();
    if (!side) throw new Error("Missing side for spot OCO amend recreate.");
    
    const tpIncStr = String(item.tpPxIncrement ?? "0");
    const slIncStr = String(item.slPxIncrement ?? "0");
    const isPercentTp = tpIncStr.includes('%');
    const isPercentSl = slIncStr.includes('%');
    const tpIncValue = parseFloat(tpIncStr.replace('%', '')) / (isPercentTp ? 100 : 1);
    const slIncValue = parseFloat(slIncStr.replace('%', '')) / (isPercentSl ? 100 : 1);
    
    const baseTpPrice = Number(tpLeg.price ?? tpLeg.px ?? 0);
    const baseSlTrigger = Number(slLeg.stopPrice ?? slLeg.triggerPx ?? 0);
    const baseSlLimit = Number(slLeg.price ?? slLeg.px ?? 0);
    
    const newTpPrice = isPercentTp 
      ? Number((baseTpPrice * (1 + tpIncValue)).toFixed(8))
      : Number((baseTpPrice + tpIncValue).toFixed(8));
    const newSlTrigger = isPercentSl 
      ? Number((baseSlTrigger * (1 + slIncValue)).toFixed(8))
      : Number((baseSlTrigger + slIncValue).toFixed(8));
    const newSlLimit = isPercentSl 
      ? Number((baseSlLimit * (1 + slIncValue)).toFixed(8))
      : Number((baseSlLimit + slIncValue).toFixed(8));
    const newQty = String(item.newSz ?? tpLeg.origQty ?? tpLeg.sz ?? slLeg.origQty ?? slLeg.sz ?? "");
    if (!newQty) throw new Error("Missing quantity for spot OCO amend recreate.");

    if (orderListId) {
      const cancelListPayload: Record<string, unknown> = { symbol, orderListId };
      await this.sdk.withTimestampRetry(false, async () => {
        this.sdk.applyTiming(cancelListPayload, false);
        return this.cancelOrderList(cancelListPayload);
      });
    } else {
      for (const leg of [tpLeg, slLeg]) {
        const oid = String(leg.ordId || leg.orderId || "");
        if (!oid) continue;
        const cancelPayload: Record<string, unknown> = { symbol, orderId: oid };
        try {
          await this.sdk.withTimestampRetry(false, async () => {
            this.sdk.applyTiming(cancelPayload, false);
            return this.sdk.spotClient.restAPI.deleteOrder(cancelPayload as never);
          });
        } catch (e: unknown) {
          const msg = (e as any)?.response?.data?.msg || (e as Error)?.message || String(e);
          if (String(msg).toLowerCase().includes("unknown order")) continue;
          throw e;
        }
      }
    }

    const ocoPayload: Record<string, unknown> = {
      symbol,
      side,
      quantity: newQty,
      price: String(newTpPrice),
      stopPrice: String(newSlTrigger),
      stopLimitPrice: String(newSlLimit),
      stopLimitTimeInForce: "GTC",
      listClientOrderId: `amendoco_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
    await this.sdk.withTimestampRetry(false, async () => {
      this.sdk.applyTiming(ocoPayload, false);
      return (this.sdk.spotClient.restAPI as any).orderOco(ocoPayload as never);
    });
  }

    item: Record<string, unknown>,
    instId: string,
    symbol: string,
    algoId: string
  ): Promise<void> {
    const openOrders = await this.getOpenOrders(instId);
    const target = openOrders.find((o: any) => String(o.algoId || o.ordId || "") === algoId);
    if (!target) {
      throw new Error(`Futures algo order not found for amend: algoId=${algoId}`);
    }

    const side = String(target.side || item.side || "").toUpperCase();
    const orderType = String(target.algoOrdType || target.ordType || "").toUpperCase();
    if (!side || !orderType) {
      throw new Error(`Invalid algo order snapshot for amend: algoId=${algoId}`);
    }
    const algoType = "CONDITIONAL";
    const executionType = String(target.type || "").toUpperCase();

    const quantity = String(item.newSz ?? target.sz ?? target.quantity ?? "");
    const triggerPrice = String(item.newTriggerPx ?? item.newTpTriggerPx ?? item.newSlTriggerPx ?? target.triggerPx ?? target.triggerPrice ?? "");
    const price = String(
      item.newPx ??
      item.newOrdPx ??
      item.newTpOrdPx ??
      item.newSlOrdPx ??
      target.ordPx ??
      target.px ??
      target.price ??
      ""
    );

    const newPayload: Record<string, unknown> = {
      symbol,
      side,
      algoType,
    };

    if (quantity) newPayload.quantity = quantity;
    if (target.posSide) {
      const pSide = String(target.posSide).toUpperCase();
      if (pSide !== 'NET' && pSide !== 'BOTH') {
        newPayload.positionSide = pSide;
      }
    }
    if (target.workingType) {
      newPayload.workingType = String(target.workingType).toUpperCase();
    }
    if (target.closePosition !== undefined) {
      newPayload.closePosition = target.closePosition;
    }

    const isTrailingStop = orderType === "MOVE_ORDER_STOP" || target.callbackRate !== undefined;
    if (isTrailingStop) {
      newPayload.type = "TRAILING_STOP_MARKET";
      const callbackRate = item.callbackRate ?? target.callbackRate;
      const activationPrice = item.newTriggerPx ?? item.newTpTriggerPx ?? item.newSlTriggerPx ?? target.activationPrice;
      if (callbackRate !== undefined && callbackRate !== "") {
        newPayload.callbackRate = Math.round(Number(callbackRate) * 100) / 100;
      }
      if (activationPrice !== undefined && activationPrice !== "") newPayload.activatePrice = Number(activationPrice);
      delete newPayload.price;
      delete newPayload.triggerPrice;
    } else {
      if (executionType === "TAKE_PROFIT" || executionType === "STOP") {
        newPayload.type = executionType;
      } else {
        const tp = Number(triggerPrice);
        const mp = await this.getMarketPrice(instId);
        if (Number.isFinite(tp) && Number.isFinite(mp) && mp !== null) {
          newPayload.type = this.sdk.inferConditionalExecutionType(side, tp, mp);
        } else {
          newPayload.type = "STOP";
        }
      }
      if (triggerPrice) newPayload.triggerPrice = Number(triggerPrice);
      if (price) newPayload.price = Number(price);
      if (target.timeInForce) {
        newPayload.timeInForce = String(target.timeInForce).toUpperCase();
      }
    }

    if (!newPayload.algoType || !newPayload.side || !newPayload.symbol) {
      throw new Error(`Invalid futures algo amend payload: ${JSON.stringify({ algoType: newPayload.algoType, side: newPayload.side, symbol: newPayload.symbol })}`);
    }

    await this.sdk.withTimestampRetry(true, async () => {
      const cancelPayload: Record<string, unknown> = { symbol, algoId };
      this.sdk.applyTiming(cancelPayload, true);
      return this.sdk.usdsFuturesClient.restAPI.cancelAlgoOrder(cancelPayload as never);
    });

    await this.sdk.withTimestampRetry(true, async () => {
      this.sdk.applyTiming(newPayload, true);
      return this.sdk.usdsFuturesClient.restAPI.newAlgoOrder(newPayload as never);
    });
  }

    item: Record<string, unknown>,
    instId: string,
    symbol: string,
    ordId: string
  ): Promise<void> {
    const openOrders = await this.getOpenOrders(instId);
    const target = openOrders.find((o: any) => String(o.ordId || "") === ordId);
    if (!target) {
      throw new Error(`Margin order not found for amend (cancel+recreate): ordId=${ordId}`);
    }

    const side = String(target.side || item.side || "").toUpperCase();
    if (!side) throw new Error(`Missing side for margin amend recreate: ordId=${ordId}`);

    const tdMode = String(item.tdMode || target.tdMode || "cross").toLowerCase();
    const isIsolated = tdMode === 'isolated';

    const orderListId = target.orderListId ? String(target.orderListId) : undefined;
    const contingencyType = target.contingencyType ? String(target.contingencyType).toUpperCase() : undefined;
    const isOCO = contingencyType === 'OCO';
    const isOTOCO = contingencyType === 'OTOCO';
    const isOTO = contingencyType === 'OTO' || (!!orderListId && contingencyType !== 'OCO' && contingencyType !== 'OTOCO');

    if (isOCO && orderListId) {
      await this.amendMarginOcoRecreate(item, instId, symbol, orderListId, side, isIsolated);
      return;
    }

    const targetType = String((target as any).type || (target as any).origType || "").toUpperCase();
    const maybeOcoLeg = ['LIMIT_MAKER', 'STOP_LOSS_LIMIT', 'STOP_LOSS', 'TAKE_PROFIT_LIMIT', 'TAKE_PROFIT'].includes(targetType);
    if (!orderListId && !contingencyType && maybeOcoLeg) {
      const ocoPair = this.findMarginOcoPairBySnapshot(openOrders as any[], target as any);
      if (ocoPair) {
        await this.amendMarginOcoRecreateByPair(item, symbol, side, isIsolated, ocoPair.tpLeg, ocoPair.slLeg);
        return;
      }
    }

    if (isOTO || isOTOCO) {
      await this.amendMarginOtoRecreate(item, instId, symbol, ordId, orderListId!, target, side, tdMode, isIsolated, isOTOCO);
      return;
    }

    const origType = String(target.type || target.origType || "LIMIT").toUpperCase();

    const newPx = item.newPx !== undefined ? String(item.newPx) : undefined;
    const newSz = item.newSz !== undefined ? String(item.newSz) : undefined;
    const newTriggerPx = item.newTriggerPx || item.newTpTriggerPx || item.newSlTriggerPx;
    const newOrdPx = item.newOrdPx !== undefined ? String(item.newOrdPx) : undefined;

    const newPayload: Record<string, unknown> = {
      symbol,
      side,
      type: origType,
    };

    const quantity = newSz ?? target.sz ?? target.quantity ?? target.origQty ?? "";
    if (!quantity) throw new Error(`Missing quantity for margin amend recreate: ordId=${ordId}`);
    newPayload.quantity = quantity;

    if (origType === 'MARKET') {
    } else if (origType === 'OCO') {
      newPayload.price = newPx ?? (target.px ?? target.price ?? "");
      newPayload.stopPrice = newTriggerPx ?? (target.slTriggerPx ?? target.stopPrice ?? "");
      newPayload.stopLimitPrice = target.slPx ?? target.stopLimitPrice ?? "";
      newPayload.stopLimitTimeInForce = "GTC";
      if (target.listClientOrderId) {
        newPayload.listClientOrderId = String(target.listClientOrderId);
      }
    } else if (['STOP_LOSS_LIMIT', 'TAKE_PROFIT_LIMIT', 'STOP_LOSS', 'TAKE_PROFIT'].includes(origType)) {
      newPayload.price = newOrdPx ?? newPx ?? (target.px ?? target.price ?? target.ordPx ?? "");
      newPayload.stopPrice = newTriggerPx ?? (target.triggerPx ?? target.stopPrice ?? target.tpTriggerPx ?? target.slTriggerPx ?? "");
      newPayload.timeInForce = target.timeInForce || "GTC";
    } else {
      newPayload.price = newPx ?? (target.px ?? target.price ?? target.ordPx ?? "");
      newPayload.timeInForce = target.timeInForce || "GTC";
    }

    if (isIsolated) newPayload.isIsolated = "TRUE";

    newPayload.newClientOrderId = `amend_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    if (!newPayload.symbol || !newPayload.side || !newPayload.quantity) {
      throw new Error(`Invalid margin amend recreate payload: ${JSON.stringify({ symbol: newPayload.symbol, side: newPayload.side, quantity: newPayload.quantity })}`);
    }

    const cancelPayload: Record<string, unknown> = { symbol, orderId: ordId };
    if (isIsolated) cancelPayload.isIsolated = "TRUE";
    await this.sdk.withTimestampRetry(false, async () => {
      this.sdk.applyTiming(cancelPayload, false);
      return this.marginCancelOrder(cancelPayload);
    });

    await this.sdk.withTimestampRetry(false, async () => {
      this.sdk.applyTiming(newPayload, false);
      return this.marginNewOrder(newPayload);
    });
  }

    const targetTime = Number(target?.cTime ?? target?.time ?? 0);
    const targetSide = String(target?.side || "").toLowerCase();
    const candidates = openOrders.filter((o: any) => {
      const sameTime = Number(o?.cTime ?? o?.time ?? 0) === targetTime;
      const sameSide = String(o?.side || "").toLowerCase() === targetSide;
      return sameTime && sameSide;
    });
    const tpLeg = candidates.find((o: any) => String(o?.type || "").toUpperCase() === "LIMIT_MAKER");
    const slLeg = candidates.find((o: any) => {
      const t = String(o?.type || "").toUpperCase();
      return t === "STOP_LOSS_LIMIT" || t === "STOP_LOSS";
    });
    if (!tpLeg || !slLeg) return null;
    return { tpLeg, slLeg };
  }

    item: Record<string, unknown>,
    instId: string,
    symbol: string,
    orderListId: string,
    side: string,
    isIsolated: boolean
  ): Promise<void> {
    const openOrders = await this.getOpenOrders(instId);
    const legs = openOrders.filter((o: any) => String(o.orderListId || "") === orderListId);
    if (legs.length < 2) {
      throw new Error(`Margin OCO legs not found: orderListId=${orderListId}`);
    }

    const tpLeg = legs.find((o: any) => String(o.type || "").toUpperCase() === "LIMIT_MAKER");
    const slLeg = legs.find((o: any) => {
      const t = String(o.type || "").toUpperCase();
      return t === "STOP_LOSS_LIMIT" || t === "STOP_LOSS";
    });
    if (!tpLeg || !slLeg) {
      throw new Error(`Margin OCO legs incomplete: orderListId=${orderListId}`);
    }

    const tpIncStr = String(item.tpPxIncrement ?? "0");
    const slIncStr = String(item.slPxIncrement ?? "0");
    const isPercentTp = tpIncStr.includes('%');
    const isPercentSl = slIncStr.includes('%');
    const tpIncValue = parseFloat(tpIncStr.replace('%', '')) / (isPercentTp ? 100 : 1);
    const slIncValue = parseFloat(slIncStr.replace('%', '')) / (isPercentSl ? 100 : 1);
    
    const baseTpPrice = Number(tpLeg.price ?? tpLeg.px ?? 0);
    const baseSlTrigger = Number(slLeg.stopPrice ?? slLeg.triggerPx ?? 0);
    const baseSlLimit = Number(slLeg.price ?? slLeg.px ?? 0);

    const newTpPrice = isPercentTp 
      ? Number((baseTpPrice * (1 + tpIncValue)).toFixed(8))
      : Number((baseTpPrice + tpIncValue).toFixed(8));
    const newSlTrigger = isPercentSl 
      ? Number((baseSlTrigger * (1 + slIncValue)).toFixed(8))
      : Number((baseSlTrigger + slIncValue).toFixed(8));
    const newSlLimit = isPercentSl 
      ? Number((baseSlLimit * (1 + slIncValue)).toFixed(8))
      : Number((baseSlLimit + slIncValue).toFixed(8));
    const newQty = String(item.newSz ?? tpLeg.origQty ?? tpLeg.sz ?? slLeg.origQty ?? slLeg.sz ?? "");
    if (!newQty) {
      throw new Error(`Missing quantity for margin OCO amend: orderListId=${orderListId}`);
    }

    const recreatePayload: Record<string, unknown> = {
      symbol,
      side,
      quantity: newQty,
      price: String(newTpPrice),
      stopPrice: String(newSlTrigger),
      stopLimitPrice: String(newSlLimit),
      stopLimitTimeInForce: "GTC",
      listClientOrderId: `amendoco_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
    if (isIsolated) recreatePayload.isIsolated = "TRUE";

    const cancelPayload: Record<string, unknown> = { symbol, orderListId };
    if (isIsolated) cancelPayload.isIsolated = "TRUE";
    await this.sdk.withTimestampRetry(false, async () => {
      this.sdk.applyTiming(cancelPayload, false);
      return this.marginCancelOco(cancelPayload);
    });

    await this.sdk.withTimestampRetry(false, async () => {
      this.sdk.applyTiming(recreatePayload, false);
      return this.marginOrderOco(recreatePayload);
    });
  }

    item: Record<string, unknown>,
    symbol: string,
    side: string,
    isIsolated: boolean,
    tpLeg: any,
    slLeg: any
  ): Promise<void> {
    const tpIncStr = String(item.tpPxIncrement ?? "0");
    const slIncStr = String(item.slPxIncrement ?? "0");
    const isPercentTp = tpIncStr.includes('%');
    const isPercentSl = slIncStr.includes('%');
    const tpIncValue = parseFloat(tpIncStr.replace('%', '')) / (isPercentTp ? 100 : 1);
    const slIncValue = parseFloat(slIncStr.replace('%', '')) / (isPercentSl ? 100 : 1);
    
    const baseTpPrice = Number(tpLeg.price ?? tpLeg.px ?? 0);
    const baseSlTrigger = Number(slLeg.stopPrice ?? slLeg.triggerPx ?? 0);
    const baseSlLimit = Number(slLeg.price ?? slLeg.px ?? 0);

    const newTpPrice = isPercentTp 
      ? Number((baseTpPrice * (1 + tpIncValue)).toFixed(8))
      : Number((baseTpPrice + tpIncValue).toFixed(8));
    const newSlTrigger = isPercentSl 
      ? Number((baseSlTrigger * (1 + slIncValue)).toFixed(8))
      : Number((baseSlTrigger + slIncValue).toFixed(8));
    const newSlLimit = isPercentSl 
      ? Number((baseSlLimit * (1 + slIncValue)).toFixed(8))
      : Number((baseSlLimit + slIncValue).toFixed(8));
    const newQty = String(item.newSz ?? tpLeg.origQty ?? tpLeg.sz ?? slLeg.origQty ?? slLeg.sz ?? "");
    if (!newQty) {
      throw new Error(`Missing quantity for margin OCO amend (pair fallback).`);
    }

    for (const leg of [tpLeg, slLeg]) {
      const oid = String(leg.ordId || leg.orderId || "");
      if (!oid) continue;
      const cancelPayload: Record<string, unknown> = { symbol, orderId: oid };
      if (isIsolated) cancelPayload.isIsolated = "TRUE";
      try {
        await this.sdk.withTimestampRetry(false, async () => {
          this.sdk.applyTiming(cancelPayload, false);
          return this.marginCancelOrder(cancelPayload);
        });
      } catch (e: unknown) {
        const msg = (e as any)?.response?.data?.msg || (e as Error)?.message || String(e);
        const msgLower = String(msg).toLowerCase();
        if (msgLower.includes("unknown order")) {
          continue;
        }
        throw e;
      }
    }

    const recreatePayload: Record<string, unknown> = {
      symbol,
      side,
      quantity: newQty,
      price: String(newTpPrice),
      stopPrice: String(newSlTrigger),
      stopLimitPrice: String(newSlLimit),
      stopLimitTimeInForce: "GTC",
      listClientOrderId: `amendoco_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
    if (isIsolated) recreatePayload.isIsolated = "TRUE";

    await this.sdk.withTimestampRetry(false, async () => {
      this.sdk.applyTiming(recreatePayload, false);
      return this.marginOrderOco(recreatePayload);
    });
  }

    item: Record<string, unknown>,
    _instId: string,
    symbol: string,
    ordId: string,
    orderListId: string,
    target: any,
    side: string,
    _tdMode: string,
    isIsolated: boolean,
    isOTOCO: boolean
  ): Promise<void> {
    const oppositeSide = side === "BUY" ? "SELL" : "BUY";

    const newPx = item.newPx !== undefined ? String(item.newPx) : undefined;
    const newSz = item.newSz !== undefined ? String(item.newSz) : undefined;
    void (item.newTriggerPx || item.newTpTriggerPx || item.newSlTriggerPx);

    const symInfo = await this.sdk.getSpotSymbolInfo(symbol);
    const pPrec = symInfo?.pricePrecision ?? 8;
    const qPrec = symInfo?.quantityPrecision ?? 2;

    const quantity = newSz ?? target.sz ?? target.quantity ?? target.origQty ?? target.workingQuantity ?? "";
    if (!quantity) throw new Error(`Missing quantity for margin OTO/OTOCO amend: ordId=${ordId}`);

    const workingPrice = newPx ?? target.px ?? target.price ?? target.ordPx ?? target.workingPrice ?? "0";
    const quantityFormatted = parseFloat(String(quantity)).toFixed(qPrec);
    const priceFormatted = parseFloat(String(workingPrice)).toFixed(pPrec);

    const itemAttachAlgos = (item.attachAlgoOrds as any[]) || [];
    const targetAttachAlgos = (target.attachAlgoOrds as any[]) || [];
    const attachAlgoOrds: any[] = itemAttachAlgos.length > 0 ? itemAttachAlgos : targetAttachAlgos;
    const tpAlgo = attachAlgoOrds.find((a: any) => a.tpOrdPx || a.tpTriggerPx);
    const slAlgo = attachAlgoOrds.find((a: any) => a.slOrdPx || a.slTriggerPx);

    const tpParsed = this.sdk.parsePercentIncrement(item.tpIncrement ?? 0);
    const slParsed = this.sdk.parsePercentIncrement(item.slIncrement ?? 0);

    const newTpAlgo = itemAttachAlgos.find((a: any) => a.newTpTriggerPx || a.newTpOrdPx);
    const newSlAlgo = itemAttachAlgos.find((a: any) => a.newSlTriggerPx || a.newSlOrdPx);

    if (isOTOCO && tpAlgo && slAlgo) {
      const newWorkingPrice = parseFloat(priceFormatted);

      let tpPrice: string;
      if (newTpAlgo) {
        tpPrice = parseFloat(String(newTpAlgo.newTpOrdPx || newTpAlgo.newTpTriggerPx)).toFixed(pPrec);
      } else if (tpParsed.isPercent && tpParsed.value !== 0) {
        tpPrice = String(this.sdk.calculateTpSlPrice(newWorkingPrice, tpParsed.value, true, side, true, pPrec));
      } else {
        tpPrice = parseFloat(String(tpAlgo.tpOrdPx || tpAlgo.tpTriggerPx || '0')).toFixed(pPrec);
      }

      let slPrice: string;
      let slStopPrice: string;
      if (newSlAlgo) {
        slPrice = parseFloat(String(newSlAlgo.newSlOrdPx || slAlgo.slOrdPx || '0')).toFixed(pPrec);
        slStopPrice = parseFloat(String(newSlAlgo.newSlTriggerPx || slAlgo.slTriggerPx || '0')).toFixed(pPrec);
      } else if (slParsed.isPercent && slParsed.value !== 0) {
        slPrice = String(this.sdk.calculateTpSlPrice(newWorkingPrice, slParsed.value, true, side, false, pPrec));
        slStopPrice = slPrice;
      } else {
        slPrice = parseFloat(String(slAlgo.slOrdPx || slAlgo.slTriggerPx || '0')).toFixed(pPrec);
        slStopPrice = parseFloat(String(slAlgo.slTriggerPx || '0')).toFixed(pPrec);
      }

      const workingTif = target.workingTimeInForce || target.timeInForce || "GTC";
      const newPayload: Record<string, unknown> = {
        symbol,
        workingType: "LIMIT",
        workingSide: side,
        workingPrice: priceFormatted,
        workingQuantity: quantityFormatted,
        workingTimeInForce: workingTif.toUpperCase(),
        pendingSide: oppositeSide,
        pendingQuantity: quantityFormatted,
      };
      if (workingTif.toUpperCase() === "GTC") {
        newPayload.workingIcebergQty = "0";
      }
      if (isIsolated) newPayload.isIsolated = "TRUE";

      if (oppositeSide === "SELL") {
        newPayload.pendingAboveType = "LIMIT_MAKER";
        newPayload.pendingAbovePrice = tpPrice;
        newPayload.pendingBelowType = "STOP_LOSS_LIMIT";
        newPayload.pendingBelowPrice = slPrice;
        newPayload.pendingBelowStopPrice = slStopPrice;
        newPayload.pendingBelowTimeInForce = "GTC";
        newPayload.pendingBelowIcebergQty = "0";
      } else {
        newPayload.pendingBelowType = "LIMIT_MAKER";
        newPayload.pendingBelowPrice = tpPrice;
        newPayload.pendingAboveType = "STOP_LOSS_LIMIT";
        newPayload.pendingAbovePrice = slPrice;
        newPayload.pendingAboveStopPrice = slStopPrice;
        newPayload.pendingAboveTimeInForce = "GTC";
        newPayload.pendingAboveIcebergQty = "0";
      }

      if (!newPayload.symbol || !newPayload.workingSide || !newPayload.workingQuantity) {
        throw new Error(`Invalid margin OTOCO amend payload: missing required fields`);
      }

      const partnerOrderIds: number[] = (target as any).otoPartnerOrderIds || [];
      if (partnerOrderIds.length > 0) {
        for (const partnerOrdId of partnerOrderIds) {
          const cancelPayload: Record<string, unknown> = { symbol, orderId: String(partnerOrdId) };
          if (isIsolated) cancelPayload.isIsolated = "TRUE";
          try {
            await this.sdk.withTimestampRetry(false, async () => {
              this.sdk.applyTiming(cancelPayload, false);
              return this.marginCancelOrder(cancelPayload);
            });
          } catch (e) {
            const errStr = String(e);
            if (!errStr.includes('-2011') && !errStr.includes('Unknown order')) {
              LogService.warn("amend", `[BINANCE] OTOCO撤单失败: ordId=${partnerOrdId}, 错误: ${errStr}`);
            }
          }
        }
      } else {
        const cancelPayload: Record<string, unknown> = { symbol, orderId: ordId };
        if (isIsolated) cancelPayload.isIsolated = "TRUE";
        await this.sdk.withTimestampRetry(false, async () => {
          this.sdk.applyTiming(cancelPayload, false);
          return this.marginCancelOrder(cancelPayload);
        });
      }

      await this.sdk.withTimestampRetry(false, async () => {
        this.sdk.applyTiming(newPayload, false);
        return this.marginOrderListOtoco(newPayload);
      });

    } else if (tpAlgo || slAlgo) {
      let pendingType: string;
      let pendingPrice: string;
      let pendingStopPrice: string | undefined;
      let pendingTif: string | undefined;

      const newWorkingPrice = parseFloat(priceFormatted);

      if (tpAlgo && (newTpAlgo || (tpParsed.isPercent && tpParsed.value !== 0))) {
        pendingType = "LIMIT_MAKER";
        if (newTpAlgo) {
          pendingPrice = parseFloat(String(newTpAlgo.newTpOrdPx || newTpAlgo.newTpTriggerPx)).toFixed(pPrec);
        } else if (tpParsed.isPercent && tpParsed.value !== 0) {
          pendingPrice = String(this.sdk.calculateTpSlPrice(newWorkingPrice, tpParsed.value, true, side, true, pPrec));
        } else {
          pendingPrice = parseFloat(String(tpAlgo.tpOrdPx || tpAlgo.tpTriggerPx || '0')).toFixed(pPrec);
        }
      } else if (slAlgo && (newSlAlgo || slParsed.value !== 0)) {
        pendingType = "STOP_LOSS_LIMIT";
        if (newSlAlgo) {
          pendingPrice = parseFloat(String(newSlAlgo.newSlOrdPx || slAlgo.slOrdPx || '0')).toFixed(pPrec);
          pendingStopPrice = parseFloat(String(newSlAlgo.newSlTriggerPx || slAlgo.slTriggerPx || '0')).toFixed(pPrec);
        } else if (slParsed.isPercent && slParsed.value !== 0) {
          pendingPrice = String(this.sdk.calculateTpSlPrice(newWorkingPrice, slParsed.value, true, side, false, pPrec));
          pendingStopPrice = pendingPrice;
        } else {
          pendingPrice = parseFloat(String(slAlgo.slOrdPx || slAlgo.slTriggerPx || '0')).toFixed(pPrec);
          pendingStopPrice = parseFloat(String(slAlgo.slTriggerPx || '0')).toFixed(pPrec);
        }
        pendingTif = "GTC";
      } else {
        throw new Error(`OTO订单缺少止盈止损信息: ordId=${ordId}, tpAlgo=${JSON.stringify(tpAlgo)}, slAlgo=${JSON.stringify(slAlgo)}`);
      }

      const workingTif = target.workingTimeInForce || target.timeInForce || "GTC";
      const newPayload: Record<string, unknown> = {
        symbol,
        workingType: "LIMIT",
        workingSide: side,
        workingPrice: priceFormatted,
        workingQuantity: quantityFormatted,
        workingTimeInForce: workingTif.toUpperCase(),
        pendingSide: oppositeSide,
        pendingQuantity: quantityFormatted,
        pendingType,
        pendingPrice,
      };
      if (workingTif.toUpperCase() === "GTC") {
        newPayload.workingIcebergQty = "0";
      }
      if (isIsolated) newPayload.isIsolated = "TRUE";
      if (pendingStopPrice) {
        newPayload.pendingStopPrice = pendingStopPrice;
        newPayload.pendingTimeInForce = pendingTif;
        newPayload.pendingIcebergQty = "0";
      }

      if (!newPayload.symbol || !newPayload.workingSide || !newPayload.workingQuantity) {
        throw new Error(`Invalid margin OTO amend payload: missing required fields`);
      }

      const partnerOrderIds: number[] = (target as any).otoPartnerOrderIds || [];
      if (partnerOrderIds.length > 0) {
        for (const partnerOrdId of partnerOrderIds) {
          const cancelPayload: Record<string, unknown> = { symbol, orderId: String(partnerOrdId) };
          if (isIsolated) cancelPayload.isIsolated = "TRUE";
          try {
            await this.sdk.withTimestampRetry(false, async () => {
              this.sdk.applyTiming(cancelPayload, false);
              return this.marginCancelOrder(cancelPayload);
            });
          } catch (e) {
            const errStr = String(e);
            if (!errStr.includes('-2011') && !errStr.includes('Unknown order')) {
              LogService.warn("amend", `[BINANCE] OTO撤单失败: ordId=${partnerOrdId}, 错误: ${errStr}`);
            }
          }
        }
      } else {
        const cancelPayload: Record<string, unknown> = { symbol, orderId: ordId };
        if (isIsolated) cancelPayload.isIsolated = "TRUE";
        await this.sdk.withTimestampRetry(false, async () => {
          this.sdk.applyTiming(cancelPayload, false);
          return this.marginCancelOrder(cancelPayload);
        });
      }

      await this.sdk.withTimestampRetry(false, async () => {
        this.sdk.applyTiming(newPayload, false);
        return this.marginOrderListOto(newPayload);
      });

    } else {
      LogService.warn("amend", `[BINANCE] 杠杆 OTO/OTOCO 订单缺少 attachAlgoOrds 数据，降级为普通 LIMIT 单重挂: ordId=${ordId}`);

      const newPayload: Record<string, unknown> = {
        symbol,
        side,
        type: "LIMIT",
        quantity: quantityFormatted,
        price: priceFormatted,
        timeInForce: "GTC",
      };
      if (isIsolated) newPayload.isIsolated = "TRUE";
      newPayload.newClientOrderId = `amend_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      const partnerOrderIds: number[] = (target as any).otoPartnerOrderIds || [];
      if (partnerOrderIds.length > 0) {
        for (const partnerOrdId of partnerOrderIds) {
          const cancelPayload: Record<string, unknown> = { symbol, orderId: String(partnerOrdId) };
          if (isIsolated) cancelPayload.isIsolated = "TRUE";
          try {
            await this.sdk.withTimestampRetry(false, async () => {
              this.sdk.applyTiming(cancelPayload, false);
              return this.marginCancelOrder(cancelPayload);
            });
          } catch (e) {
            LogService.warn("amend", `[BINANCE] OTO降级撤单失败(可能已不存在): ordId=${partnerOrdId}`);
          }
        }
      } else {
        const cancelPayload: Record<string, unknown> = { symbol, orderId: ordId };
        if (isIsolated) cancelPayload.isIsolated = "TRUE";
        await this.sdk.withTimestampRetry(false, async () => {
          this.sdk.applyTiming(cancelPayload, false);
          return this.marginCancelOrder(cancelPayload);
        });
      }

      await this.sdk.withTimestampRetry(false, async () => {
        this.sdk.applyTiming(newPayload, false);
        return this.marginNewOrder(newPayload);
      });
    }
  }

  async amendAlgoOrder(params: Record<string, unknown>) {
    const res = await this.amendBatchOrders([params]);
    if (res.code === "0" && Array.isArray(res.data) && res.data.length > 0) {
      const item = res.data[0] as any;
      return { code: item.sCode || "0", msg: item.sMsg || "OK", data: res.data };
    }
    return res;
  }

  async cancelOrder(params: { instId: string; ordId: string }) {
    const res = await this.cancelBatchOrders([params]);
    return {
      ...res,
      data: res.data?.[0] ? [res.data[0]] : [],
    };
  }

  async cancelBatchOrders(params: Array<Record<string, unknown>>) {
    if (!Array.isArray(params) || params.length === 0) return this.sdk.ok([]);

    const results: Array<Record<string, unknown>> = [];
    for (const item of params) {
      const instId = String(item.instId || "");
      const symbol = this.sdk.toBinanceSymbol(instId);
      const isFutures = this.sdk.isFutures(instId);
      const ordId = item.ordId ? String(item.ordId) : undefined;
      const orderListId = item.orderListId ? String(item.orderListId) : undefined;

      try {
        if (!ordId && !orderListId) throw new Error("Missing ordId or orderListId for cancel.");
        if (isFutures) {
          if (!ordId) throw new Error("Futures cancel requires ordId.");
          const cancelRes = await this.sdk.withTimestampRetry(true, async () => {
            const payload: Record<string, unknown> = { symbol, orderId: ordId };
            this.sdk.applyTiming(payload, true);
            return this.sdk.usdsFuturesClient.restAPI.sendSignedRequest('/fapi/v1/order', 'DELETE', payload);
          });
          const cancelData = await this.sdk.extractData(cancelRes);
          if (cancelData && cancelData.code !== undefined && Number(cancelData.code) !== 0) {
            throw new Error(String(cancelData.msg || `Cancel failed, code=${cancelData.code}`));
          }
          if (!cancelData || (cancelData.orderId === undefined && !cancelData.clientOrderId)) {
            throw new Error(`Cancel response missing orderId: ${JSON.stringify(cancelData).substring(0, 200)}`);
          }
        } else {
          const tdMode = String(item.tdMode || "cash").toLowerCase();
          const isMargin = tdMode === 'cross' || tdMode === 'isolated';
          const isIsolated = tdMode === 'isolated';

          await this.sdk.withTimestampRetry(false, async () => {
            const payload: Record<string, unknown> = { symbol };
            if (orderListId) {
              payload.orderListId = orderListId;
            } else {
              payload.orderId = ordId;
            }
            
            if (isMargin && isIsolated) payload.isIsolated = 'TRUE';
            this.sdk.applyTiming(payload, false);
            
            if (isMargin) {
              if (orderListId) {
                return this.marginCancelOco(payload);
              }
              return this.marginCancelOrder(payload);
            }
            
            if (orderListId) {
              return this.cancelOrderList(payload);
            }
            return this.sdk.spotClient.restAPI.deleteOrder(payload as never);
          });
        }
        results.push({ ordId, sCode: "0", sMsg: "" });
      } catch (e: unknown) {
        const message = (e as Error).message || String(e);
        results.push({ ordId: ordId || "", sCode: "-1", sMsg: message });
      }
    }
    return this.sdk.ok(results);
  }

  async cancelBatchAlgoOrders(params: Array<Record<string, unknown>>) {
    if (!Array.isArray(params) || params.length === 0) return this.sdk.ok([]);

    const results: Array<Record<string, unknown>> = [];
    for (const item of params) {
      const instId = String(item.instId || "");
      const symbol = this.sdk.toBinanceSymbol(instId);
      const isFutures = this.sdk.isFutures(instId);
      const ordId = item.ordId ? String(item.ordId) : undefined;
      const algoId = item.algoId ? String(item.algoId) : undefined;
      const tdMode = String(item.tdMode || "").toLowerCase();
      const isMargin = tdMode === 'cross' || tdMode === 'isolated';

      try {
        if (!isFutures && !isMargin) throw new Error("Spot algo cancel is not supported yet.");
        
        if (!isFutures && isMargin) {
          const targetId = algoId || ordId;
          if (!targetId) throw new Error("Missing algoId / ordId for margin cancel.");
          await this.sdk.withTimestampRetry(false, async () => {
            const payload: Record<string, unknown> = { symbol, orderId: targetId };
            if (tdMode === 'isolated') payload.isIsolated = 'TRUE';
            this.sdk.applyTiming(payload, false);
            return this.marginCancelOrder(payload);
          });
          results.push({ algoId: algoId || ordId, ordId: ordId || algoId, sCode: "0", sMsg: "" });
          continue;
        }
        
        const targetAlgoId = algoId || ordId;
        if (!targetAlgoId) throw new Error("Missing algoId / ordId for cancel.");

        const algoCancelRes = await this.sdk.withTimestampRetry(true, async () => {
          const payload: any = { symbol };
          if (/^[0-9]+$/.test(targetAlgoId)) {
            payload.algoId = targetAlgoId;
          } else {
            payload.clientAlgoId = targetAlgoId;
          }
          
          this.sdk.applyTiming(payload, true);
          return this.sdk.usdsFuturesClient.restAPI.sendSignedRequest('/fapi/v1/algoOrder', 'DELETE', payload);
        });
        const algoCancelData = await this.sdk.extractData(algoCancelRes);
        if (algoCancelData && algoCancelData.code !== undefined && Number(algoCancelData.code) !== 0) {
          throw new Error(String(algoCancelData.msg || `Cancel algo failed, code=${algoCancelData.code}`));
        }
        
        results.push({ algoId: targetAlgoId, ordId: targetAlgoId, sCode: "0", sMsg: "" });
      } catch (e: unknown) {
        const message = (e as Error).message || String(e);
        results.push({ algoId: ordId || "", ordId: ordId || "", sCode: "-1", sMsg: message });
      }
    }
    return this.sdk.ok(results);
  }

  async getOpenOrders(instId?: string, reqInstType?: string): Promise<any[]> {
    const allOrders: any[] = [];

    let orderListMap: Record<string, string> = {};
    const isFutures = instId ? this.sdk.isFutures(instId) : (reqInstType === 'SWAP' || reqInstType === 'FUTURES' || !reqInstType);
    const isSpot = instId ? !this.sdk.isFutures(instId) : (reqInstType === 'SPOT' || !reqInstType);
    const isMargin = instId ? !this.sdk.isFutures(instId) : (reqInstType === 'MARGIN' || !reqInstType);
    const isGlobal = !reqInstType;

    let futuresRiskMap: Map<string, any> = new Map();
    if (!instId || isFutures) {
      try {
        const riskData = await this.sdk.fetchPositionRiskCached();
        if (Array.isArray(riskData)) {
          riskData.forEach(item => {
            futuresRiskMap.set(String(item.symbol), item);
          });
        }
      } catch (e) {
        const errMsg = (e instanceof Error ? e : new Error(String(e))).message;
        if (_shouldLogBinanceError(`futuresRiskMap:${errMsg}`)) {
          LogService.logKey("system", 'account.risk.config.failed', { label: this.sdk.accountLabel(), msg: errMsg, exchange: 'BINANCE' }, 'error');
        }
      }
    }
    
    if (!instId || isSpot || isMargin) {
      const now = Date.now();
      if (this.sdk.sharedOrderListMap && now - this.sdk.sharedLastOcoFetch < 30000) {
        orderListMap = this.sdk.sharedOrderListMap;
      } else {
        try {
          if (isSpot || isGlobal) {
          const spotOListRes = await this.sdk.withTimestampRetry(false, async () => {
            const payload: Record<string, unknown> = {};
            this.sdk.applyTiming(payload, false);
            return this.sdk.spotClient.restAPI.sendSignedRequest('/api/v3/openOrderList', 'GET', payload);
          });
          const spotLists = (await this.sdk.extractData(spotOListRes) || []) as Array<Record<string, unknown>>;
          spotLists.forEach(l => {
            if (l.orderListId !== undefined && l.contingencyType) {
              orderListMap[String(l.orderListId)] = String(l.contingencyType);
            }
          });
        }

        if (isMargin || !reqInstType) {
          const marginOListRes = await this.sdk.withTimestampRetry(false, async () => {
            const payload: any = { isIsolated: 'FALSE' };
            this.sdk.applyTiming(payload, false);
            return this.sdk.marginClient.restAPI.sendSignedRequest('/sapi/v1/margin/openOrderList', 'GET', payload);
          });
          const marginLists = (await this.sdk.extractData(marginOListRes) || []) as Array<Record<string, unknown>>;
          marginLists.forEach(l => {
            if (l.orderListId !== undefined && l.contingencyType) {
              orderListMap[String(l.orderListId)] = String(l.contingencyType);
            }
          });
        }

        if (instId) {
          try {
            const symbol = this.sdk.toBinanceSymbol(instId);
            const isoMarginOListRes = await this.sdk.withTimestampRetry(false, async () => {
              const payload: any = { symbol, isIsolated: 'TRUE' };
              this.sdk.applyTiming(payload, false);
              return this.sdk.marginClient.restAPI.sendSignedRequest('/sapi/v1/margin/openOrderList', 'GET', payload);
            });
            const isoMarginLists = (await this.sdk.extractData(isoMarginOListRes) || []) as Array<Record<string, unknown>>;
            isoMarginLists.forEach(l => {
              if (l.orderListId !== undefined && l.contingencyType) {
                orderListMap[String(l.orderListId)] = String(l.contingencyType);
              }
            });
          } catch (e) {
          }
        }
        this.sdk.sharedOrderListMap = orderListMap;
        this.sdk.sharedLastOcoFetch = Date.now();
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        if (_shouldLogBinanceError(`orderListMaps:${errMsg}`)) {
          LogService.logKey("system", 'account.oco.preload.failed', { label: this.sdk.accountLabel(), msg: errMsg, exchange: 'BINANCE' }, 'error');
        }
      }
    }
  }

    if (instId) {
      const symbol = this.sdk.toBinanceSymbol(instId);
      if (isFutures) {
        const res = await this.sdk.withTimestampRetry(true, async () => {
          const payload: Record<string, unknown> = { symbol };
          this.sdk.applyTiming(payload, true);
          return this.sdk.usdsFuturesClient.restAPI.currentAllOpenOrders(payload as never);
        });
        const rows = (await this.sdk.extractData(res) || []) as Array<Record<string, unknown>>;
        const riskConfig = futuresRiskMap.get(symbol) || {};
        const normalOrders = rows.map((row) => {
          const rawType = row.type ? String(row.type).toUpperCase() : "";
          return {
            ordId: row.orderId ? String(row.orderId) : "",
            instId,
            ordType:
              rawType === "TRAILING_STOP_MARKET"
                ? "move_order_stop"
                : this.sdk.normalizeBinanceFuturesOrdType(row.type, row.timeInForce),
            px: row.price ? String(row.price) : undefined,
            triggerPx: row.stopPrice ? String(row.stopPrice) : undefined,
            sz: row.origQty ? String(row.origQty) : undefined,
            side: String(row.side || "").toLowerCase(),
            posSide: row.positionSide ? (String(row.positionSide).toUpperCase() === "BOTH" ? "net" : String(row.positionSide).toLowerCase()) : "net",
            timeInForce: row.timeInForce ? String(row.timeInForce).toUpperCase() : undefined,
            tdMode: "cross",
            lever: riskConfig.leverage ? String(riskConfig.leverage) : undefined,
            type: rawType,
            activationPrice: row.activatePrice !== undefined ? String(row.activatePrice) : undefined,
            priceRate: row.priceRate !== undefined ? Number(row.priceRate) : undefined,
            callbackRate: row.callbackRate !== undefined ? Number(row.callbackRate) : (row.priceRate !== undefined ? Number(row.priceRate) : undefined),
            cTime: row.time,
            state: "live",
            exchange: 'BINANCE',
          };
        });

        try {
          const algoRes = await this.sdk.withTimestampRetry(true, async () => {
            const payload: any = { symbol };
            this.sdk.applyTiming(payload, true);
            return this.sdk.usdsFuturesClient.restAPI.currentAllAlgoOpenOrders(payload as any);
          });
          const algoRows = (await this.sdk.extractData(algoRes) || []) as Array<Record<string, unknown>>;
          const algoOrders = algoRows.map((row) => {
            const rawAlgoType = String(row.algoType || "").toUpperCase();
            const rawExecType = String(row.orderType || row.type || "").toUpperCase();
            const hasCallbackRate = row.callbackRate !== undefined && row.callbackRate !== null;
            const hasPriceRate = row.priceRate !== undefined && row.priceRate !== null;
            const isTrailingStop = rawExecType === "TRAILING_STOP_MARKET" || hasCallbackRate || hasPriceRate;
            const isConditionalTpSl = rawAlgoType === "CONDITIONAL" && 
              ["STOP", "TAKE_PROFIT", "STOP_MARKET", "TAKE_PROFIT_MARKET"].includes(rawExecType);
            const isPlanOrder = rawAlgoType === "CONDITIONAL" && (!rawExecType || rawExecType === "") && !hasCallbackRate;

            let mappedOrdType: string;
            if (isTrailingStop) {
              mappedOrdType = "move_order_stop";
            } else if (isConditionalTpSl) {
              mappedOrdType = "conditional";
            } else if (isPlanOrder) {
              mappedOrdType = "trigger";
            } else {
              mappedOrdType = String(row.algoType || "conditional").toLowerCase();
            }
            return {
            _algoType: rawAlgoType,
            _execType: rawExecType,
            ordId: row.algoId ? String(row.algoId) : (row.clientAlgoId || ""),
            algoId: row.algoId ? String(row.algoId) : "",
            instId,
            ordType: mappedOrdType,
            algoOrdType: mappedOrdType,
            type: row.type ? String(row.type).toUpperCase() : undefined,
            triggerPx: row.triggerPrice ? String(row.triggerPrice) : undefined,
            ordPx: row.price ? String(row.price) : undefined,
            tpPrice: (rawExecType.includes("TAKE_PROFIT")) ? (row.price ? String(row.price) : (row.triggerPrice ? String(row.triggerPrice) : undefined)) : undefined,
            slPrice: (rawExecType.includes("STOP")) ? (row.price ? String(row.price) : (row.triggerPrice ? String(row.triggerPrice) : undefined)) : undefined,
            tpTriggerPx:
              String(row.algoType || "").toUpperCase() === "CONDITIONAL" &&
              String(row.type || "").toUpperCase() === "TAKE_PROFIT" &&
              row.triggerPrice !== undefined
                ? String(row.triggerPrice)
                : undefined,
            tpOrdPx:
              String(row.algoType || "").toUpperCase() === "CONDITIONAL" &&
              String(row.type || "").toUpperCase() === "TAKE_PROFIT" &&
              row.price !== undefined
                ? String(row.price)
                : undefined,
            slTriggerPx:
              String(row.algoType || "").toUpperCase() === "CONDITIONAL" &&
              String(row.type || "").toUpperCase() === "STOP" &&
              row.triggerPrice !== undefined
                ? String(row.triggerPrice)
                : undefined,
            slOrdPx:
              String(row.algoType || "").toUpperCase() === "CONDITIONAL" &&
              String(row.type || "").toUpperCase() === "STOP" &&
              row.price !== undefined
                ? String(row.price)
                : undefined,
            px: mappedOrdType === "conditional" ? undefined : (row.triggerPrice ? String(row.triggerPrice) : undefined),
            price: mappedOrdType === "conditional" ? undefined : (row.price ? String(row.price) : undefined),
            triggerPrice: row.triggerPrice ? String(row.triggerPrice) : undefined,
            sz: (row.quantity || row.origQty || row.sz) ? String(row.quantity || row.origQty || row.sz) : undefined,
            quantity: (row.quantity || row.origQty || row.sz) ? String(row.quantity || row.origQty || row.sz) : undefined,
            side: String(row.side || "").toLowerCase(),
            posSide: row.positionSide ? (String(row.positionSide).toUpperCase() === "BOTH" ? "net" : String(row.positionSide).toLowerCase()) : "net",
            workingType: row.workingType ? String(row.workingType) : undefined,
            timeInForce: row.timeInForce ? String(row.timeInForce) : undefined,
            callbackRate: row.callbackRate !== undefined ? Number(row.callbackRate) : undefined,
            activationPrice: row.activatePrice !== undefined ? String(row.activatePrice) : (row.triggerPrice ? String(row.triggerPrice) : undefined),
            reduceOnly: row.reduceOnly,
            closePosition: row.closePosition,
            tdMode: "cross",
            lever: riskConfig.leverage ? String(riskConfig.leverage) : undefined,
            isAlgo: true,
            state: "live",
            cTime: row.createTime || row.time,
            exchange: 'BINANCE',
          };
        });
        const seen = new Set<string>();
        const deduped = [...normalOrders, ...algoOrders].filter((o: any) => {
          const id = o.ordId ? String(o.ordId) : "";
          if (!id) return true;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
          return deduped;
        } catch {
          return normalOrders;
        }
      }

      const spotRes = await this.sdk.withTimestampRetry(false, async () => {
        const payload: Record<string, unknown> = { symbol };
        this.sdk.applyTiming(payload, false);
        return this.sdk.spotClient.restAPI.getOpenOrders(payload as never);
      });
      const spotRows = (await this.sdk.extractData(spotRes) || []) as Array<Record<string, unknown>>;
      const spotOrders = spotRows.map(row => {
        const oListId = (row.orderListId !== undefined && row.orderListId !== -1) ? String(row.orderListId) : undefined;
        let cType = row.contingencyType ? String(row.contingencyType) : undefined;
        if (!cType && oListId && orderListMap[oListId]) cType = orderListMap[oListId];
        const spotType = String(row.type || "").toUpperCase();

        const rawPrice = row.price ? String(row.price) : undefined;
        const rawStopPrice = row.stopPrice ? String(row.stopPrice) : undefined;
        const hasTrailingDelta = row.trailingDelta !== undefined && Number(row.trailingDelta) > 0;
        const rawActivationPrice = hasTrailingDelta
          ? rawStopPrice
          : (row.activationPrice ? String(row.activationPrice) : (row.activatePrice ? String(row.activatePrice) : undefined));
        const finalPrice = rawPrice && parseFloat(rawPrice) > 0 ? rawPrice : (hasTrailingDelta ? undefined : rawStopPrice);
        return {
          ordId: row.orderId ? String(row.orderId) : "",
          instId,
          ordType: String(row.type || "limit").toLowerCase(),
          type: String(row.type || "LIMIT").toUpperCase(),
          px: finalPrice,
          ordPx: finalPrice,
          triggerPx: rawStopPrice,
          sz: row.origQty ? String(row.origQty) : undefined,
          side: String(row.side || "").toLowerCase(),
          posSide: "net",
          tdMode: "cash",
          lever: "1",
          orderListId: oListId,
          contingencyType: cType,
          trailingDelta: row.trailingDelta !== undefined ? Number(row.trailingDelta) : undefined,
          callbackRate: row.trailingDelta !== undefined && Number(row.trailingDelta) > 0 
            ? Number(row.trailingDelta) / 100 
            : undefined,
          activationPrice: rawActivationPrice,
          activatePrice: rawActivationPrice,
          activatePx: rawActivationPrice,
          tpPrice: spotType.includes("TAKE_PROFIT") ? rawStopPrice : undefined,
          slPrice: spotType.includes("STOP") ? rawStopPrice : undefined,
          state: row.status ? String(row.status) : undefined,
          cTime: row.time,
          exchange: 'BINANCE',
        };
      });

      const spotTimeGroupMap = new Map<number, any[]>();
      spotOrders.forEach((order: any) => {
        const t = Number(order.cTime);
        if (!spotTimeGroupMap.has(t)) spotTimeGroupMap.set(t, []);
        spotTimeGroupMap.get(t)!.push(order);
      });

      const spotOtoOrderListIdMap = new Map<string, string>();
      const spotOtoContingencyTypeMap = new Map<string, string>();

      spotTimeGroupMap.forEach((orders, time) => {
        if (orders.length >= 2) {
          const pendingOrders = orders.filter((o: any) => isPendingNewState(o));
          const mainOrders = orders.filter((o: any) => o.state === 'NEW' && (o.ordType === 'limit' || o.type === 'LIMIT'));
          if (pendingOrders.length > 0 && mainOrders.length > 0) {
            const hasTp = pendingOrders.some((o: any) => String(o.type || o.ordType || '').includes('LIMIT_MAKER') || String(o.type || o.ordType || '').includes('TAKE_PROFIT'));
            const hasSl = pendingOrders.some((o: any) => String(o.type || o.ordType || '').includes('STOP_LOSS') || String(o.type || o.ordType || '').includes('STOP'));
            const isOtoco = hasTp && hasSl;
            const virtualOrderListId = isOtoco ? `OTOCO_${time}` : `OTO_${time}`;
            const contingencyType = isOtoco ? 'OTOCO' : 'OTO';

            mainOrders.forEach((o: any) => {
              const oid = o.ordId;
              if (oid && !o.orderListId) {
                spotOtoOrderListIdMap.set(oid, virtualOrderListId);
                spotOtoContingencyTypeMap.set(oid, contingencyType);
              }
            });
            pendingOrders.forEach((o: any) => {
              const oid = o.ordId;
              if (oid && !o.orderListId) {
                spotOtoOrderListIdMap.set(oid, virtualOrderListId);
                spotOtoContingencyTypeMap.set(oid, contingencyType);
              }
            });
          }
        }
      });

      spotOrders.forEach((order: any) => {
        const oid = order.ordId;
        if (oid && !order.orderListId && spotOtoOrderListIdMap.has(oid)) {
          order.orderListId = spotOtoOrderListIdMap.get(oid);
          order.contingencyType = spotOtoContingencyTypeMap.get(oid);
        }
      });

      let crossMarginOrders: any[] = [];
      try {
        const marginRes = await this.sdk.withTimestampRetry(false, async () => {
          const payload: any = { symbol, isIsolated: 'FALSE' };
          this.sdk.applyTiming(payload, false);
          return this.sdk.marginClient.restAPI.queryMarginAccountsOpenOrders(payload as never);
        });
        const marginRows = (await this.sdk.extractData(marginRes) || []) as Array<Record<string, unknown>>;
      const timeGroupMap = new Map<number, any[]>();
      marginRows.forEach(row => {
        const t = Number(row.time);
        if (!timeGroupMap.has(t)) timeGroupMap.set(t, []);
        timeGroupMap.get(t)!.push(row);
      });
      const otoOrderListIdMap = new Map<number, string>();
      const otoContingencyTypeMap = new Map<number, string>();
      const otoPartnerMap = new Map<number, number[]>();
      const otoAttachAlgosMap = new Map<number, any[]>();
      timeGroupMap.forEach((orders, time) => {
        if (orders.length >= 2) {
          const pendingOrders = orders.filter(o => isPendingNewState(o));
          const mainOrders = orders.filter(o => o.status === 'NEW' && o.type === 'LIMIT');
          if (pendingOrders.length > 0 && mainOrders.length > 0) {
            const hasTp = pendingOrders.some(o => String(o.type || '').includes('LIMIT_MAKER') || String(o.type || '').includes('TAKE_PROFIT'));
            const hasSl = pendingOrders.some(o => String(o.type || '').includes('STOP_LOSS') || String(o.type || '').includes('STOP'));
            const isOtoco = hasTp && hasSl;
            const virtualOrderListId = isOtoco ? `OTOCO_${time}` : `OTO_${time}`;
            const contingencyType = isOtoco ? 'OTOCO' : 'OTO';
            
            const allOrderIds: number[] = [];
            mainOrders.forEach(o => {
              const oid = Number(o.orderId);
              otoOrderListIdMap.set(oid, virtualOrderListId);
              otoContingencyTypeMap.set(oid, contingencyType);
              allOrderIds.push(oid);
            });
            pendingOrders.forEach(o => {
              const oid = Number(o.orderId);
              otoOrderListIdMap.set(oid, virtualOrderListId);
              otoContingencyTypeMap.set(oid, contingencyType);
              allOrderIds.push(oid);
            });
            allOrderIds.forEach(oid => otoPartnerMap.set(oid, allOrderIds));
            const attachAlgos: any[] = [];
            pendingOrders.forEach(pending => {
              const pendingType = String(pending.type || '');
              if (pendingType === 'LIMIT_MAKER') {
                attachAlgos.push({
                  tpOrdPx: pending.price ? String(pending.price) : undefined,
                  tpTriggerPx: pending.stopPrice ? String(pending.stopPrice) : undefined,
                });
              } else if (pendingType === 'STOP_LOSS_LIMIT' || pendingType === 'STOP_LOSS') {
                attachAlgos.push({
                  slOrdPx: pending.price ? String(pending.price) : undefined,
                  slTriggerPx: pending.stopPrice ? String(pending.stopPrice) : undefined,
                });
              } else if (pendingType === 'TAKE_PROFIT_LIMIT' || pendingType === 'TAKE_PROFIT') {
                attachAlgos.push({
                  tpOrdPx: pending.price ? String(pending.price) : undefined,
                  tpTriggerPx: pending.stopPrice ? String(pending.stopPrice) : undefined,
                });
              }
            });
            if (attachAlgos.length > 0) {
              allOrderIds.forEach(oid => otoAttachAlgosMap.set(oid, attachAlgos));
            }
          }
        }
      });

        crossMarginOrders = marginRows.map(row => {
          const oListId = (row.orderListId !== undefined && row.orderListId !== -1) ? String(row.orderListId) : undefined;
          let cType = row.contingencyType ? String(row.contingencyType) : undefined;
          if (!cType && oListId && orderListMap[oListId]) cType = orderListMap[oListId];
          const orderId = Number(row.orderId);
          const virtualOtoListId = otoOrderListIdMap.get(orderId);
          const virtualContingencyType = otoContingencyTypeMap.get(orderId);
          const finalOrderListId = oListId || virtualOtoListId;
          const finalContingencyType = cType || virtualContingencyType;
          const partnerOrderIds = otoPartnerMap.get(orderId);
          const virtualAttachAlgos = otoAttachAlgosMap.get(orderId);
          const rawPrice = row.price ? String(row.price) : undefined;
          const rawStopPrice = row.stopPrice ? String(row.stopPrice) : undefined;
          const rawActivationPrice = row.activationPrice
            ? String(row.activationPrice)
            : (row.activatePrice ? String(row.activatePrice) : undefined);
          const finalPrice = rawPrice && parseFloat(rawPrice) > 0 ? rawPrice : rawStopPrice;
          return {
            ordId: row.orderId ? String(row.orderId) : "",
            instId,
            ordType: String(row.type || "limit").toLowerCase(),
            type: String(row.type || "LIMIT").toUpperCase(),
            px: finalPrice,
            ordPx: finalPrice,
            triggerPx: rawStopPrice,
            sz: row.origQty ? String(row.origQty) : undefined,
            side: String(row.side || "").toLowerCase(),
            posSide: "net",
            tdMode: "cross",
            orderListId: finalOrderListId,
            contingencyType: finalContingencyType,
            otoPartnerOrderIds: partnerOrderIds,
            attachAlgoOrds: virtualAttachAlgos,
            trailingDelta: row.trailingDelta !== undefined ? Number(row.trailingDelta) : undefined,
          activatePrice: rawActivationPrice,
          activationPrice: rawActivationPrice,
            state: row.status ? String(row.status) : undefined,
            cTime: row.time,
            exchange: 'BINANCE',
          };
        });
      } catch (e) {  }

      let isolatedMarginOrders: any[] = [];
      try {
        const isoMarginRes = await this.sdk.withTimestampRetry(false, async () => {
          const payload: any = { symbol, isIsolated: 'TRUE' };
          this.sdk.applyTiming(payload, false);
          return this.sdk.marginClient.restAPI.queryMarginAccountsOpenOrders(payload as never);
        });
        const isoMarginRows = (await this.sdk.extractData(isoMarginRes) || []) as Array<Record<string, unknown>>;
        isolatedMarginOrders = isoMarginRows.map(row => {
          const oListId = (row.orderListId !== undefined && row.orderListId !== -1) ? String(row.orderListId) : undefined;
          let cType = row.contingencyType ? String(row.contingencyType) : undefined;
          if (!cType && oListId && orderListMap[oListId]) cType = orderListMap[oListId];
          const rawPrice = row.price ? String(row.price) : undefined;
          const rawStopPrice = row.stopPrice ? String(row.stopPrice) : undefined;
          const finalPrice = rawPrice && parseFloat(rawPrice) > 0 ? rawPrice : rawStopPrice;
          return {
            ordId: row.orderId ? String(row.orderId) : "",
            instId,
            ordType: String(row.type || "limit").toLowerCase(),
            type: String(row.type || "LIMIT").toUpperCase(),
            px: finalPrice,
            ordPx: finalPrice,
            triggerPx: rawStopPrice,
            sz: row.origQty ? String(row.origQty) : undefined,
            side: String(row.side || "").toLowerCase(),
            posSide: "net",
            tdMode: "isolated",
            orderListId: oListId,
            contingencyType: cType,
            trailingDelta: row.trailingDelta !== undefined ? Number(row.trailingDelta) : undefined,
            activatePrice: rawStopPrice,
            activationPrice: rawStopPrice,
            state: row.status ? String(row.status) : undefined,
            cTime: row.time,
            exchange: 'BINANCE',
          };
        });
      } catch (e) {  }

      return [...spotOrders, ...crossMarginOrders, ...isolatedMarginOrders];
    }

      if (isFutures) {
        const futuresRes = await this.sdk.withTimestampRetry(true, async () => {
          const payload: Record<string, unknown> = {};
          this.sdk.applyTiming(payload, true);
          return this.sdk.usdsFuturesClient.restAPI.currentAllOpenOrders(payload as never);
        });
        const futuresRows = (await this.sdk.extractData(futuresRes) || []) as Array<Record<string, unknown>>;
        futuresRows.forEach((row) => {
          const symbol = String(row.symbol || "");
          const riskConfig = futuresRiskMap.get(symbol) || {};
          const type = row.type ? String(row.type).toUpperCase() : "";
          const stopPx = row.stopPrice ? String(row.stopPrice) : undefined;
          
          allOrders.push({
            ordId: row.orderId ? String(row.orderId) : "",
            instId: this.sdk.fromBinanceSymbol(symbol) + "-SWAP",
            ordType:
              type === "TRAILING_STOP_MARKET"
                ? "move_order_stop"
                : this.sdk.normalizeBinanceFuturesOrdType(row.type, row.timeInForce),
            px: row.price ? String(row.price) : undefined,
            triggerPx: stopPx,
            tpPrice: type.includes("TAKE_PROFIT") ? (row.price ? String(row.price) : undefined) : undefined,
            slPrice: type.includes("STOP") ? (row.price ? String(row.price) : undefined) : undefined,
            sz: (row.quantity || row.origQty) ? String(row.quantity || row.origQty) : undefined,
            side: String(row.side || "").toLowerCase(),
            posSide: row.positionSide ? (String(row.positionSide).toUpperCase() === "BOTH" ? "net" : String(row.positionSide).toLowerCase()) : "net",
            timeInForce: row.timeInForce ? String(row.timeInForce).toUpperCase() : undefined,
            tdMode: "cross",
            lever: riskConfig.leverage ? String(riskConfig.leverage) : undefined,
            state: "live",
            cTime: row.time,
            exchange: 'BINANCE',
            type,
            activationPrice: row.activatePrice !== undefined ? String(row.activatePrice) : undefined,
            callbackRate: row.callbackRate !== undefined ? Number(row.callbackRate) : (row.priceRate !== undefined ? Number(row.priceRate) : undefined),
          });
        });

        try {
          const algoAllRes = await this.sdk.withTimestampRetry(true, async () => {
            const payload: any = {};
            this.sdk.applyTiming(payload, true);
            return this.sdk.usdsFuturesClient.restAPI.currentAllAlgoOpenOrders(payload as any);
          });
          const algoAllRows = (await this.sdk.extractData(algoAllRes) || []) as Array<Record<string, unknown>>;
          algoAllRows.forEach((row) => {
            const rawInstId = String(row.symbol || "");
            const riskConfig = futuresRiskMap.get(rawInstId) || {};
            const createTime = row.createTime || row.time;
            const rawAlgoType = String(row.algoType || "").toUpperCase();
            const rawExecType = String(row.orderType || row.type || "").toUpperCase();
            const hasCallbackRate = row.callbackRate !== undefined && row.callbackRate !== null;
            const isTrailingStop = rawExecType === "TRAILING_STOP_MARKET";
            const isConditionalTpSl = rawAlgoType === "CONDITIONAL" && 
              ["STOP", "TAKE_PROFIT", "STOP_MARKET", "TAKE_PROFIT_MARKET"].includes(rawExecType);
            const isPlanOrder = rawAlgoType === "CONDITIONAL" && (!rawExecType || rawExecType === "") && !hasCallbackRate;

            let mappedOrdType: string;
            if (isTrailingStop) {
              mappedOrdType = "move_order_stop";
            } else if (isConditionalTpSl) {
              mappedOrdType = "conditional";
            } else if (isPlanOrder) {
              mappedOrdType = "trigger";
            } else {
              mappedOrdType = String(row.algoType || "conditional").toLowerCase();
            }
            allOrders.push({
              _algoType: rawAlgoType,
              _execType: rawExecType,
              ordId: row.algoId ? String(row.algoId) : (row.clientAlgoId || ""),
              algoId: row.algoId ? String(row.algoId) : "",
              instId: this.sdk.fromBinanceSymbol(rawInstId) + "-SWAP",
              ordType: mappedOrdType,
              algoOrdType: mappedOrdType,
              type: row.type ? String(row.type).toUpperCase() : (row.orderType ? String(row.orderType).toUpperCase() : undefined),
              triggerPx: row.triggerPrice ? String(row.triggerPrice) : undefined,
              ordPx: row.price ? String(row.price) : undefined,
              tpPrice: (rawExecType.includes("TAKE_PROFIT")) ? (row.price ? String(row.price) : (row.triggerPrice ? String(row.triggerPrice) : undefined)) : undefined,
              slPrice: (rawExecType.includes("STOP")) ? (row.price ? String(row.price) : (row.triggerPrice ? String(row.triggerPrice) : undefined)) : undefined,
              tpTriggerPx:
                String(row.algoType || "").toUpperCase() === "CONDITIONAL" &&
                rawExecType.includes("TAKE_PROFIT") &&
                row.triggerPrice !== undefined
                  ? String(row.triggerPrice)
                  : undefined,
              tpOrdPx:
                String(row.algoType || "").toUpperCase() === "CONDITIONAL" &&
                rawExecType.includes("TAKE_PROFIT") &&
                row.price !== undefined
                  ? String(row.price)
                  : undefined,
              slTriggerPx:
                String(row.algoType || "").toUpperCase() === "CONDITIONAL" &&
                rawExecType.includes("STOP") &&
                row.triggerPrice !== undefined
                  ? String(row.triggerPrice)
                  : undefined,
              slOrdPx:
                String(row.algoType || "").toUpperCase() === "CONDITIONAL" &&
                rawExecType.includes("STOP") &&
                row.price !== undefined
                  ? String(row.price)
                  : undefined,
              px: mappedOrdType === "conditional" ? undefined : (row.triggerPrice ? String(row.triggerPrice) : undefined),
              price: mappedOrdType === "conditional" ? undefined : (row.price ? String(row.price) : undefined),
              triggerPrice: row.triggerPrice ? String(row.triggerPrice) : undefined,
              sz: (row.quantity || row.origQty || row.sz) ? String(row.quantity || row.origQty || row.sz) : undefined,
              quantity: (row.quantity || row.origQty || row.sz) ? String(row.quantity || row.origQty || row.sz) : undefined,
              side: String(row.side || "").toLowerCase(),
              posSide: row.positionSide ? (String(row.positionSide).toUpperCase() === "BOTH" ? "net" : String(row.positionSide).toLowerCase()) : "net",
              workingType: row.workingType ? String(row.workingType) : undefined,
              timeInForce: row.timeInForce ? String(row.timeInForce) : undefined,
              callbackRate: row.callbackRate !== undefined ? Number(row.callbackRate) : undefined,
              activationPrice: row.activatePrice !== undefined ? String(row.activatePrice) : (row.triggerPrice ? String(row.triggerPrice) : undefined),
              reduceOnly: row.reduceOnly,
              closePosition: row.closePosition,
              tdMode: "cross",
              lever: riskConfig.leverage ? String(riskConfig.leverage) : undefined,
              isAlgo: true,
              state: "live",
              cTime: createTime,
              exchange: 'BINANCE',
            });
          });
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          if (_shouldLogBinanceError(`globalAlgoOrders:${errMsg}`)) {
            LogService.logKey("system", 'account.conditional.orders.failed', { label: this.sdk.accountLabel(), msg: errMsg, exchange: 'BINANCE' }, 'error');
          }
        }
      }

      if (isSpot) {
        try {
          const spotRes = await this.sdk.withTimestampRetry(false, async () => {
            const payload: Record<string, unknown> = {};
            this.sdk.applyTiming(payload, false);
            return this.sdk.spotClient.restAPI.getOpenOrders(payload as never);
          });
          const spotRows = (await this.sdk.extractData(spotRes) || []) as Array<Record<string, unknown>>;
          const startIdx = allOrders.length;
          spotRows.forEach((row) => {
            let oListId = (row.orderListId !== undefined && row.orderListId !== -1) ? String(row.orderListId) : undefined;
            let cType = row.contingencyType ? String(row.contingencyType) : undefined;
            if (!cType && oListId && orderListMap[oListId]) {
              cType = orderListMap[oListId];
            }
            allOrders.push({
              ordId: row.orderId ? String(row.orderId) : "",
              instId: this.sdk.fromBinanceSymbol(String(row.symbol || "")),
              ordType: String(row.type || "limit").toLowerCase(),
              type: String(row.type || "LIMIT").toUpperCase(),
              px: row.price ? String(row.price) : undefined,
              triggerPx: row.stopPrice ? String(row.stopPrice) : undefined,
              sz: (row.quantity || row.origQty) ? String(row.quantity || row.origQty) : undefined,
              side: String(row.side || "").toLowerCase(),
              posSide: "net",
              tdMode: "cash",
              lever: "1",
              orderListId: oListId,
              contingencyType: cType,
              trailingDelta: row.trailingDelta !== undefined ? Number(row.trailingDelta) : undefined,
              activationPrice: row.stopPrice ? String(row.stopPrice) : undefined,
              activatePrice: row.stopPrice ? String(row.stopPrice) : undefined,
              state: row.status ? String(row.status) : undefined,
              cTime: row.time,
              exchange: 'BINANCE',
            });
          });

          const globalSpotOrders = allOrders.slice(startIdx);
          const globalSpotTimeGroupMap = new Map<number, any[]>();
          globalSpotOrders.forEach((order: any) => {
            const t = Number(order.cTime);
            if (!globalSpotTimeGroupMap.has(t)) globalSpotTimeGroupMap.set(t, []);
            globalSpotTimeGroupMap.get(t)!.push(order);
          });

          const globalSpotOtoOrderListIdMap = new Map<string, string>();
          const globalSpotOtoContingencyTypeMap = new Map<string, string>();

          globalSpotTimeGroupMap.forEach((orders, time) => {
            if (orders.length >= 2) {
              const pendingOrders = orders.filter((o: any) => isPendingNewState(o));
              const mainOrders = orders.filter((o: any) => o.state === 'NEW' && (o.ordType === 'limit' || String(o.type || '').toUpperCase() === 'LIMIT'));
              if (pendingOrders.length > 0 && mainOrders.length > 0) {
                const hasTp = pendingOrders.some((o: any) => String(o.type || o.ordType || '').includes('LIMIT_MAKER') || String(o.type || o.ordType || '').includes('TAKE_PROFIT'));
                const hasSl = pendingOrders.some((o: any) => String(o.type || o.ordType || '').includes('STOP_LOSS') || String(o.type || o.ordType || '').includes('STOP'));
                const isOtoco = hasTp && hasSl;
                const virtualOrderListId = isOtoco ? `OTOCO_${time}` : `OTO_${time}`;
                const contingencyType = isOtoco ? 'OTOCO' : 'OTO';

                mainOrders.forEach((o: any) => {
                  const oid = o.ordId;
                  if (oid && !o.orderListId) {
                    globalSpotOtoOrderListIdMap.set(oid, virtualOrderListId);
                    globalSpotOtoContingencyTypeMap.set(oid, contingencyType);
                  }
                });
                pendingOrders.forEach((o: any) => {
                  const oid = o.ordId;
                  if (oid && !o.orderListId) {
                    globalSpotOtoOrderListIdMap.set(oid, virtualOrderListId);
                    globalSpotOtoContingencyTypeMap.set(oid, contingencyType);
                  }
                });
              }
            }
          });

          globalSpotOrders.forEach((order: any) => {
            const oid = order.ordId;
            if (oid && !order.orderListId && globalSpotOtoOrderListIdMap.has(oid)) {
              order.orderListId = globalSpotOtoOrderListIdMap.get(oid);
              order.contingencyType = globalSpotOtoContingencyTypeMap.get(oid);
            }
          });
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          if (_shouldLogBinanceError(`globalSpotOrders:${errMsg}`)) {
            LogService.logKey("system", 'account.spot.orders.failed', { label: this.sdk.accountLabel(), msg: errMsg, exchange: 'BINANCE' }, 'error');
          }
        }
      }

      if (isMargin) {
        try {
          const marginOrders = await this.getMarginOpenOrders();
          allOrders.push(...marginOrders);
        } catch (e: unknown) {
        }
      }

      const seen = new Set<string>();
      const dedupedAll = allOrders.filter((o: any) => {
        const id = o.ordId ? String(o.ordId) : "";
        if (!id) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      return dedupedAll;
    }

    if (!marginData) return 1;
    const totalAsset = parseFloat(marginData.totalAssetOfBtc || "0");
    const totalLiability = parseFloat(marginData.totalLiabilityOfBtc || "0");
    const totalNetAsset = parseFloat(marginData.totalNetAssetOfBtc || "0");

    if (totalLiability <= 0) return 1;

    if (totalNetAsset > 0) {
      const leverage = totalAsset / totalNetAsset;
      return Math.min(Math.max(Math.round(leverage), 1), 10);
    }

    return 10;
  }

  async getMarginAccountInfo(): Promise<{ leverage?: number; [key: string]: any }> {
    try {
      const res = await this.sdk.withTimestampRetry(false, async () => {
        const payload: any = {};
        this.sdk.applyTiming(payload, false);
        return this.sdk.marginClient.restAPI.sendSignedRequest('/sapi/v1/margin/account', 'GET', payload);
      });
      const data = await this.sdk.extractData(res);
      return {
        ...data,
        leverage: this.calculateMarginLeverage(data),
      };
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (_shouldLogBinanceError(`marginAccountInfo:${err.message}`)) {
        LogService.logKey("system", 'account.margin.info.failed', { label: this.sdk.accountLabel(), msg: err.message, exchange: 'BINANCE' }, 'error');
      }
      return { leverage: 1 };
    }
  }

  async getMarginOpenOrders(instId?: string): Promise<any[]> {
    const allOrders: any[] = [];

    const ocoOrderIdMap = new Map<string, { orderListId: string; contingencyType: string }>();
    try {
      const crossOcoRes = await this.sdk.withTimestampRetry(false, async () => {
        const payload: any = { isIsolated: 'FALSE' };
        this.sdk.applyTiming(payload, false);
        return this.sdk.marginClient.restAPI.queryMarginAccountsOpenOco(payload as never);
      });
      const crossOcoRows = (await this.sdk.extractData(crossOcoRes) || []) as Array<Record<string, unknown>>;
      crossOcoRows.forEach((l: any) => {
        if (l.orderListId !== undefined && l.contingencyType && Array.isArray(l.orders)) {
          for (const sub of l.orders) {
            if (sub.orderId) {
              ocoOrderIdMap.set(String(sub.orderId), {
                orderListId: String(l.orderListId),
                contingencyType: String(l.contingencyType),
              });
            }
          }
        }
      });
      if (instId) {
        const isoOcoRes = await this.sdk.withTimestampRetry(false, async () => {
          const payload: any = { symbol: this.sdk.toBinanceSymbol(instId), isIsolated: 'TRUE' };
          this.sdk.applyTiming(payload, false);
          return this.sdk.marginClient.restAPI.queryMarginAccountsOpenOco(payload as never);
        });
        const isoOcoRows = (await this.sdk.extractData(isoOcoRes) || []) as Array<Record<string, unknown>>;
        isoOcoRows.forEach((l: any) => {
          if (l.orderListId !== undefined && l.contingencyType && Array.isArray(l.orders)) {
            for (const sub of l.orders) {
              if (sub.orderId) {
                ocoOrderIdMap.set(String(sub.orderId), {
                  orderListId: String(l.orderListId),
                  contingencyType: String(l.contingencyType),
                });
              }
            }
          }
        });
      }
    } catch (e) {
    }

    let marginLeverage: number | undefined;
    try {
      const marginInfo = await this.getMarginAccountInfo();
      marginLeverage = marginInfo.leverage;
    } catch (e) {
    }

    try {
      const marginRes = await this.sdk.withTimestampRetry(false, async () => {
        const payload: any = { isIsolated: 'FALSE' };
        if (instId) {
          payload.symbol = this.sdk.toBinanceSymbol(instId);
        }
        this.sdk.applyTiming(payload, false);
        return this.sdk.marginClient.restAPI.queryMarginAccountsOpenOrders(payload as never);
      });
      const marginRows = (await this.sdk.extractData(marginRes) || []) as Array<Record<string, unknown>>;
      marginRows.forEach((row) => {
        const marginType = String(row.type || "limit").toUpperCase();
        const rawOrdId = row.orderId ? String(row.orderId) : "";
        const oListId = (row.orderListId !== undefined && row.orderListId !== -1) ? String(row.orderListId) : undefined;
        let cType = row.contingencyType ? String(row.contingencyType) : undefined;
        if (!cType) {
          if (oListId && ocoOrderIdMap.has(oListId)) {
            cType = ocoOrderIdMap.get(oListId)!.contingencyType;
          } else if (rawOrdId && ocoOrderIdMap.has(rawOrdId)) {
            const ocoInfo = ocoOrderIdMap.get(rawOrdId)!;
            cType = ocoInfo.contingencyType;
          }
        }
        allOrders.push({
          ordId: row.orderId ? String(row.orderId) : "",
          instId: this.sdk.fromBinanceSymbol(String(row.symbol || "")),
          ordType: String(row.type || "limit").toLowerCase(),
          px: row.price ? String(row.price) : undefined,
          triggerPx: row.stopPrice ? String(row.stopPrice) : undefined,
          tpPrice: marginType.includes("TAKE_PROFIT") ? (row.price ? String(row.price) : undefined) : undefined,
          slPrice: marginType.includes("STOP") ? (row.price ? String(row.price) : undefined) : undefined,
          sz: row.origQty ? String(row.origQty) : undefined,
          side: String(row.side || "").toLowerCase(),
          posSide: "net",
          tdMode: "cross",
          lever: marginLeverage ? String(marginLeverage) : undefined,
          orderListId: oListId || (rawOrdId ? ocoOrderIdMap.get(rawOrdId)?.orderListId : undefined),
          contingencyType: cType,
          state: row.status ? String(row.status) : undefined,
          cTime: row.time,
          exchange: 'BINANCE',
          trailingDelta: row.trailingDelta !== undefined ? Number(row.trailingDelta) : undefined,
          activatePrice: row.stopPrice ? String(row.stopPrice) : undefined,
          activationPrice: row.stopPrice ? String(row.stopPrice) : undefined,
          activatePx: row.stopPrice ? String(row.stopPrice) : undefined,
        });
      });

      if (instId) {
        const isolatedRes = await this.sdk.withTimestampRetry(false, async () => {
          const payload: any = { isIsolated: 'TRUE', symbol: this.sdk.toBinanceSymbol(instId) };
          this.sdk.applyTiming(payload, false);
          return this.sdk.marginClient.restAPI.queryMarginAccountsOpenOrders(payload as never);
        });
        const isolatedRows = (await this.sdk.extractData(isolatedRes) || []) as Array<Record<string, unknown>>;
        isolatedRows.forEach((row) => {
          const marginType = String(row.type || "limit").toUpperCase();
          const isoOrdId = row.orderId ? String(row.orderId) : "";
          const oListId = (row.orderListId !== undefined && row.orderListId !== -1) ? String(row.orderListId) : undefined;
          let cType = row.contingencyType ? String(row.contingencyType) : undefined;
          if (!cType) {
            if (oListId && ocoOrderIdMap.has(oListId)) {
              cType = ocoOrderIdMap.get(oListId)!.contingencyType;
            } else if (isoOrdId && ocoOrderIdMap.has(isoOrdId)) {
              cType = ocoOrderIdMap.get(isoOrdId)!.contingencyType;
            }
          }
          allOrders.push({
            ordId: isoOrdId,
            instId: this.sdk.fromBinanceSymbol(String(row.symbol || "")),
            ordType: String(row.type || "limit").toLowerCase(),
            px: row.price ? String(row.price) : undefined,
            triggerPx: row.stopPrice ? String(row.stopPrice) : undefined,
            tpPrice: marginType.includes("TAKE_PROFIT") ? (row.price ? String(row.price) : undefined) : undefined,
            slPrice: marginType.includes("STOP") ? (row.price ? String(row.price) : undefined) : undefined,
            sz: row.origQty ? String(row.origQty) : undefined,
            side: String(row.side || "").toLowerCase(),
            posSide: "net",
            tdMode: "isolated",
            lever: marginLeverage ? String(marginLeverage) : undefined,
            orderListId: oListId || (isoOrdId ? ocoOrderIdMap.get(isoOrdId)?.orderListId : undefined),
            contingencyType: cType,
            state: row.status ? String(row.status) : undefined,
            cTime: row.time,
            exchange: 'BINANCE',
            trailingDelta: row.trailingDelta !== undefined ? Number(row.trailingDelta) : undefined,
            activatePrice: row.stopPrice ? String(row.stopPrice) : undefined,
            activationPrice: row.stopPrice ? String(row.stopPrice) : undefined,
            activatePx: row.stopPrice ? String(row.stopPrice) : undefined,
          });
        });
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (_shouldLogBinanceError(`marginOpenOrders:${errMsg}`)) {
        LogService.logKey("system", 'account.margin.orders.failed', { label: this.sdk.accountLabel(), msg: errMsg, exchange: 'BINANCE' }, 'error');
      }
    }

    return allOrders;
  }

  async fetchAllPagesForOrders(instType?: string): Promise<any[]> {
    const type = String(instType || "").toUpperCase();

    if (type && !["SWAP", "FUTURES", "SPOT", "MARGIN"].includes(type)) {
      return []; 
    }
    
    return this.getOpenOrders(undefined, instType);
  }

  async fetchAllPagesForAlgoType(_algoType: string, _instType?: string): Promise<any[]> {
    return [];
  }

  async getPositions(instId?: string): Promise<any[]> {
    const isFuturesId = instId ? this.sdk.isFutures(instId) : false;
    
    const allPositions: any[] = [];
    
    if (!instId || isFuturesId) {
      try {
        const riskRows = await this.sdk.fetchPositionRiskCached() as any[];
        const uAcct = await this.sdk.fetchFuturesAccountCached();
        
        const acctPosMap = new Map<string, any>();
        if (uAcct && Array.isArray(uAcct.positions)) {
          uAcct.positions.forEach((p: any) => {
            const key = `${p.symbol}_${String(p.positionSide || "").toUpperCase()}`;
            acctPosMap.set(key, p);
          });
        }

        const futuresPositions = (Array.isArray(riskRows) ? riskRows : [])
          .filter((row: any) => {
            const amt = Math.abs(Number(row.positionAmt || "0"));
            const notional = Math.abs(Number(row.notional || "0"));
            return Number.isFinite(amt) && amt > 0.0000001 && (isNaN(notional) || notional > 0.01); 
          })
          .map((row: any) => {
            const amt = Number(row.positionAmt || "0");
            const side = String(row.positionSide || "").toUpperCase();
            const symbol = String(row.symbol || "");
            const posSide = side === "LONG" ? "long" : side === "SHORT" ? "short" : "net";
            
            const acctPos = acctPosMap.get(`${symbol}_${side}`);
            
            const upl = Number(row.unRealizedProfit || "0");
            
            let margin = acctPos ? Number(acctPos.positionInitialMargin || acctPos.initialMargin || "0") : 0;
            if (margin <= 0) {
              margin = Number(row.isolatedMargin || "0");
            }
            if (margin <= 0) {
              const leverage = Number(row.leverage || "1");
              const notional = Math.abs(Number(row.notional || "0"));
              if (leverage > 0 && notional > 0) {
                margin = notional / leverage;
              }
            }

            let uplRatio = "0";
            if (margin > 0) {
              uplRatio = (upl / margin).toString();
            }

            return {
              instId: this.sdk.fromBinanceSymbol(symbol) + "-SWAP",
              instType: "futures",
              pos: side === "BOTH" ? String(amt) : String(Math.abs(amt)),
              posSide,
              mgnMode: String(row.marginType || "cross"),
              lever: String(row.leverage || "1"),
              avgPx: String(row.entryPrice || "0"),
              markPx: String(row.markPrice || "0"),
              liqPx: String(row.liquidationPrice || "0"),
              upl: String(upl),
              uplRatio: uplRatio,
              margin: String(margin), 
              imr: String(margin),    
              mgn: String(margin),    
            };
          });
        allPositions.push(...futuresPositions);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        if (_shouldLogBinanceError(`futuresPositions:${errMsg}`)) {
          LogService.logKey("system", 'account.futures.position.failed', { label: this.sdk.accountLabel(), msg: errMsg, exchange: 'BINANCE' }, 'error');
        }
      }
    }

    if (!instId || !isFuturesId) {
      try {
        const marginPositions = await this.getMarginPositions(instId);
        allPositions.push(...marginPositions);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        if (_shouldLogBinanceError(`marginPositions:${errMsg}`)) {
          LogService.logKey("system", 'account.margin.position.failed', { label: this.sdk.accountLabel(), msg: errMsg }, 'error');
        }
      }
    }

    return allPositions;
  }

  async getMarginPositions(instId?: string): Promise<any[]> {
    const marginPositions: any[] = [];
    const targetSymbol = instId ? this.sdk.toBinanceSymbol(instId) : undefined;
    const knownQuoteAssets = ["USDT", "FDUSD", "USDC", "TUSD", "BUSD", "BTC", "ETH", "BNB"];

    let marginLeverage = 1;
    try {
      const marginInfo = await this.getMarginAccountInfo();
      marginLeverage = marginInfo.leverage || 1;
    } catch (e) {
    }

    try {
      if (targetSymbol) {
        const isoRes = await this.sdk.withTimestampRetry(false, async () => {
          const payload: any = { symbol: targetSymbol };
          this.sdk.applyTiming(payload, false);
          return this.sdk.marginClient.restAPI.queryIsolatedMarginAccountInfo(payload as never);
        });
        const isoData = await this.sdk.extractData(isoRes);
        const assets = Array.isArray(isoData?.assets) ? isoData.assets : (isoData ? [isoData] : []);
        
        assets.forEach((pair: any) => {
          if (!pair.symbol || !pair.baseAsset || !pair.quoteAsset) return;
          const symbol = String(pair.symbol || "");
          const base = pair.baseAsset;
          
          const baseTotal = parseFloat(base.free || "0") + parseFloat(base.locked || "0");
          const baseBorrowed = parseFloat(base.borrowed || "0") + parseFloat(base.interest || "0");
          const baseNet = parseFloat(base.netAsset || "0");

          if (baseBorrowed > 0.00000001) {
            marginPositions.push({
              instId: this.sdk.fromBinanceSymbol(symbol),
              pos: String(baseBorrowed), 
              posSide: "short",
              mgnMode: "isolated",
              lever: String(marginLeverage),
              avgPx: "0",
              upl: "0",
              uplRatio: "0"
            });
          }

          if (baseNet > 0.00000001 || (baseTotal > baseBorrowed + 0.00000001)) {
            marginPositions.push({
              instId: this.sdk.fromBinanceSymbol(symbol),
              pos: String(baseTotal),
              posSide: "long",
              mgnMode: "isolated",
              lever: String(marginLeverage),
              avgPx: "0",
              upl: "0",
              uplRatio: "0"
            });
          }
        });
      }
    } catch (e) {
    }

    try {
      const crossRes = await this.sdk.withTimestampRetry(false, async () => {
        const payload: any = {};
        this.sdk.applyTiming(payload, false);
        return this.sdk.marginClient.restAPI.queryCrossMarginAccountDetails(payload as never);
      });
      const crossData = await this.sdk.extractData(crossRes);
      const userAssets = Array.isArray(crossData?.userAssets) ? crossData.userAssets : [];
      
      userAssets.forEach((asset: any) => {
        if (knownQuoteAssets.includes(asset.asset)) return;
        
        const total = parseFloat(asset.free || "0") + parseFloat(asset.locked || "0");
        const borrowed = parseFloat(asset.borrowed || "0") + parseFloat(asset.interest || "0");
        const net = total - borrowed;

        if (total < 1e-8 && borrowed < 1e-8) return;

        let potentialQuote = "USDT";
        if (targetSymbol && targetSymbol.startsWith(asset.asset)) {
          potentialQuote = targetSymbol.slice(asset.asset.length);
        }
        const instIdStr = this.sdk.fromBinanceSymbol(`${asset.asset}${potentialQuote}`);
        
        if (targetSymbol && this.sdk.toBinanceSymbol(instIdStr) !== targetSymbol) return;

        if (borrowed > 0.00000001) {
          marginPositions.push({
            instId: instIdStr,
            pos: String(borrowed),
            posSide: "short",
            mgnMode: "cross",
            lever: String(marginLeverage),
            avgPx: "0",
            upl: "0",
            uplRatio: "0"
          });
        }

        if (net > 0.00000001) {
          marginPositions.push({
            instId: instIdStr,
            pos: String(total),
            posSide: "long",
            mgnMode: "cross",
            lever: String(marginLeverage),
            avgPx: "0",
            upl: "0",
            uplRatio: "0"
          });
        }
      });
    } catch (e) {  }

    const seen = new Set();
    return marginPositions.filter(p => {
      const key = `${p.instId}-${p.posSide}-${p.mgnMode}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async closePosition(params: {
    instId: string;
    posSide?: string;
    sz?: string;
    mgnMode?: string;
    ccy?: string;
    autoCxl?: boolean;
  }) {
    const symbol = this.sdk.toBinanceSymbol(params.instId);
    const isFutures = this.sdk.isFutures(params.instId);

    if (!isFutures) {
      const tdMode = params.mgnMode || "cross";
      const isIsolated = tdMode === "isolated";
      const side = String(params.posSide || "long").toLowerCase() === "long" ? "SELL" : "BUY";
      
      try {
        const symInfo = await this.sdk.getSpotSymbolInfo(symbol);
        const qPrec = symInfo?.quantityPrecision ?? 8;

        const marginPositions = await this.getMarginPositions(params.instId);
        const target = marginPositions.find(p => p.mgnMode === tdMode && p.posSide === (params.posSide || "long"));
        
        if (!target) {
          LogService.warn("close", `[BINANCE] No open margin position found for ${params.instId} in ${tdMode} mode.`);
          return this.sdk.fail(`No open margin position found for ${params.instId} in ${tdMode} mode.`);
        }

        const rawQuantity = params.sz ? params.sz : target.pos;
        const quantity = this.sdk.roundStep(Number(rawQuantity), qPrec);

        const payload: Record<string, unknown> = {
          symbol,
          side,
          type: "MARKET",
          quantity,
          sideEffectType: "AUTO_REPAY"
        };
        if (isIsolated) payload.isIsolated = "TRUE";

        LogService.info("close", `[BINANCE] Spot/Margin closePosition payload: ${JSON.stringify(payload)}`);

        await this.sdk.withTimestampRetry(false, async () => {
          this.sdk.applyTiming(payload, false);
          return this.marginNewOrder(payload);
        });

        return this.sdk.ok([{ sCode: "0", sMsg: "" }]);
      } catch (e: unknown) {
        const message = (e as Error).message || String(e);
        LogService.apiError("close", `[BINANCE] Spot/Margin closePosition failed: ${message}`);
        return this.sdk.fail(message);
      } finally {
        this.sdk.clearTradeCaches();
      }
    }

    try {
      const posRes = await this.sdk.withTimestampRetry(true, async () => {
        const payload: Record<string, unknown> = { symbol };
        this.sdk.applyTiming(payload, true);
        return this.sdk.usdsFuturesClient.restAPI.positionInformationV2(payload as never);
      });
      const positions = (await this.sdk.extractData(posRes) || []) as Array<Record<string, unknown>>;
      
      let normalizedSide = String(params.posSide || "").toUpperCase();
      if (normalizedSide === "NET") normalizedSide = "BOTH";

      const targetPos = positions.find((p) => {
        const amt = Number(p.positionAmt || "0");
        if (amt === 0) return false;
        if (normalizedSide) {
          const pSide = String(p.positionSide || "").toUpperCase();
          if (normalizedSide === "BOTH" || normalizedSide === "NET") {
            return pSide === "BOTH";
          }
          if (pSide === "BOTH") {
            if (normalizedSide === "LONG") return amt > 0;
            if (normalizedSide === "SHORT") return amt < 0;
          }
          return pSide === normalizedSide;
        }
        return true;
      });

      if (!targetPos) {
        return this.sdk.fail("Unable to resolve Binance futures position for close (no matching open position found).");
      }

      const positionAmt = Number(targetPos.positionAmt || "0");
      const pSide = String(targetPos.positionSide || "").toUpperCase();
      
      let side = "";
      let payloadPositionSide = "";

      if (pSide === "BOTH") {
        side = positionAmt > 0 ? "SELL" : "BUY";
      } 
      else if (pSide === "LONG") {
        side = "SELL";
        payloadPositionSide = "LONG";
      } else if (pSide === "SHORT") {
        side = "BUY";
        payloadPositionSide = "SHORT";
      }

      let quantity = params.sz ? String(params.sz) : String(Math.abs(positionAmt));
      try {
        const symInfo = await this.sdk.getFuturesSymbolInfo(symbol);
        if (symInfo) {
          quantity = this.sdk.roundStep(Math.abs(positionAmt), symInfo.quantityPrecision);
        }
      } catch (e) {  }

      const payload: Record<string, unknown> = {
        symbol,
        side,
        type: "MARKET",
        quantity,
      };
      
      if (payloadPositionSide) {
        payload.positionSide = payloadPositionSide;
      } else {
        payload.reduceOnly = true;
      }

      const res = await this.sdk.withTimestampRetry(true, async () => {
        this.sdk.applyTiming(payload, true);
        return this.sdk.usdsFuturesClient.restAPI.newOrder(payload as never);
      });
      
      const data = await this.sdk.extractData(res);
      if (data && data.code && data.code !== 0 && data.code !== '0' && data.code !== 200) {
        throw new Error(data.msg || JSON.stringify(data));
      }

      this.sdk.clearTradeCaches();
      return this.sdk.ok([{ sCode: "0", sMsg: "平仓订单已下达", ordId: data.ordId || data.orderId }]);
    } catch (e: unknown) {
      const message = (e as Error).message || String(e);
      LogService.apiError("close", `[BINANCE] closePosition failed: ${message}`);
      return this.sdk.fail(message);
    } finally {
      this.sdk.clearTradeCaches();
    }
  }

  async redeemSavings(ccy: string, amt: string): Promise<boolean> {
    try {
      
      const resList = await this.sdk.withTimestampRetry(false, async () => {
        const p: any = { asset: ccy };
        this.sdk.applyTiming(p, false);
        return (this.sdk.simpleEarnClient.restAPI as any).getSimpleEarnFlexibleProductList(p as never);
      });

      const pData = await this.sdk.extractData(resList);
      const rows = Array.isArray(pData?.rows) ? pData.rows : [];
      const product = rows.find((r: any) => r.asset === ccy && r.canRedeem);
      
      if (!product) {
        LogService.warn("margin", `[BINANCE] No redeemable ${ccy} flexible product found.`);
        return false;
      }

      const payload: any = {
        productId: product.productId,
        amount: amt,
        destAccount: 'FUND' 
      };
      
      await this.sdk.withTimestampRetry(false, async () => {
        this.sdk.applyTiming(payload, false);
        return (this.sdk.simpleEarnClient.restAPI as any).redeemFlexibleProduct(payload as never);
      });
      
      return true;
    } catch (e: unknown) {
      LogService.logKey("margin", 'account.redeem.failed', { exchange: 'BINANCE', label: this.sdk.accountLabel(), msg: (e as Error).message || String(e) }, 'error');
      return false;
    }
  }

  async transferAsset(ccy: string, amt: string, from: string, to: string): Promise<boolean> {
    try {
      
      const isFromFunding = from === "6" || from === "FUNDING";
      const source = isFromFunding ? "FUNDING" : "MAIN";
      
      const TYPE_MAP: Record<string, string> = {
        "SPOT": "MAIN",
        "MARGIN": "MARGIN",
        "USDT_FUTURE": "UMFUTURE",
        "COIN_FUTURE": "CMFUTURE",
        "FUNDING": "FUNDING",
        "18": "MAIN"
      };

      const dest = TYPE_MAP[to] || "MAIN";
      
      if (source === dest) {
        LogService.info("margin", `[BINANCE] Transfer source and destination are both ${source}, skipping.`);
        return true;
      }

      const type = `${source}_${dest}`;
      
      LogService.info("margin", `[BINANCE] 发起划转: ${type} (资产: ${ccy}, 数量: ${amt})`);
      const payload: any = {
        asset: ccy,
        amount: amt,
        type
      };

      await this.sdk.withTimestampRetry(false, async () => {
        this.sdk.applyTiming(payload, false);
        return (this.sdk.walletClient.restAPI as any).userUniversalTransfer(payload as never);
      });
      
      return true;
    } catch (e: unknown) {
      LogService.logKey("margin", 'account.transfer.failed', { exchange: 'BINANCE', label: `${ccy} -> ${to}`, msg: (e as Error).message || String(e) }, 'error');
      return false;
    }
  }

  async placeOrder(request: any): Promise<any> {
    const isFutures = this.sdk.isFutures(request.instId);
    const tdMode = String(request.tdMode || "cash").toLowerCase();
    const isMargin = !isFutures && (tdMode === 'cross' || tdMode === 'isolated');
    const isIsolated = tdMode === 'isolated';

    const symbol = this.sdk.toBinanceSymbol(request.instId);
    const side = request.side.toUpperCase();
    const ordType = request.ordType.toUpperCase();

    const symInfo = isFutures 
      ? await this.sdk.getFuturesSymbolInfo(symbol) 
      : await this.sdk.getSpotSymbolInfo(symbol);
    const pPrec = symInfo?.pricePrecision ?? 8;
    const qPrec = symInfo?.quantityPrecision ?? 8;

    const isStandardOrder = (ordType === 'LIMIT' || ordType === 'MARKET' || ordType === 'POST_ONLY' || ordType === 'FOK' || ordType === 'IOC');

    if (!isFutures && isStandardOrder && (request.tpTriggerPx || request.slTriggerPx)) {
      if (!request.attachAlgoOrds || request.attachAlgoOrds.length === 0) {
        request.attachAlgoOrds = [{
          tpTriggerPx: request.tpTriggerPx,
          tpPx: request.tpPx,
          slTriggerPx: request.slTriggerPx,
          slPx: request.slPx
        }];
      }
    }

    const typeMap: Record<string, string> = {
      'LIMIT': 'LIMIT',
      'MARKET': 'MARKET',
      'POST_ONLY': isFutures ? 'LIMIT' : 'LIMIT_MAKER',
      'FOK': 'LIMIT',
      'IOC': 'LIMIT',
      'TRIGGER': isFutures ? 'STOP' : 'STOP_LOSS_LIMIT',
      'CONDITIONAL': isFutures ? 'STOP' : 'STOP_LOSS_LIMIT',
      'STOP': isFutures ? 'STOP_MARKET' : 'STOP_LOSS_LIMIT',
      'TAKE_PROFIT': isFutures ? 'TAKE_PROFIT_MARKET' : 'TAKE_PROFIT_LIMIT',
      'OCO': 'OCO',
      'TRAILING': isFutures ? 'TRAILING_STOP_MARKET' : 'TRAILING_STOP_MARKET',
      'MOVE_ORDER_STOP': isFutures ? 'TRAILING_STOP_MARKET' : 'TRAILING_STOP_MARKET'
    };
    
    const binanceType = typeMap[ordType] || ordType;

    const payload: any = {
      symbol,
      side,
      type: binanceType,
      newClientOrderId: request.clOrdId,
    };

    if (ordType === 'FOK') payload.timeInForce = 'FOK';
    if (ordType === 'IOC') payload.timeInForce = 'IOC';
    if (ordType === 'POST_ONLY' && isFutures) payload.timeInForce = 'GTX';
    if (binanceType === 'LIMIT' || binanceType === 'STOP_LOSS_LIMIT' || binanceType === 'TAKE_PROFIT_LIMIT') {
      payload.timeInForce = payload.timeInForce || 'GTC';
    }

    if (request.sz) payload.quantity = this.sdk.roundStep(Number(request.sz), qPrec);

    if (request.px) payload.price = Number(request.px).toFixed(pPrec);
    
    if (isFutures) {
       delete payload.reduceOnly;
    }
    
    if (request.triggerPx && !isStandardOrder) {
      payload.stopPrice = Number(request.triggerPx).toFixed(pPrec);
    }
    
    if (isFutures && request.posSide) {
      const pSide = request.posSide.toUpperCase();
      if (pSide !== 'NET' && pSide !== 'BOTH') {
        payload.positionSide = pSide;
      }
    }

    const tpTriggerPx = request.tpTriggerPx || (ordType === 'TAKE_PROFIT' ? request.triggerPx : null);
    const slTriggerPx = request.slTriggerPx || (ordType === 'STOP' ? request.triggerPx : null);
    const baseTriggerPx = tpTriggerPx || slTriggerPx || request.triggerPx;

    if (isFutures && (ordType === 'CONDITIONAL' || ordType === 'TRIGGER' || ordType === 'STOP' || ordType === 'TAKE_PROFIT' || ordType === 'TRAILING' || ordType === 'MOVE_ORDER_STOP')) {
      if (baseTriggerPx || ordType === 'TRAILING' || ordType === 'MOVE_ORDER_STOP') {
        if (baseTriggerPx) {
          payload.stopPrice = Number(baseTriggerPx).toFixed(pPrec);
        }
        
        const effectivePx = request.px || baseTriggerPx;
        if (ordType === 'CONDITIONAL') {
          if (tpTriggerPx) {
            payload.type = 'TAKE_PROFIT';
            payload.price = Number(effectivePx).toFixed(pPrec);
          } else {
            payload.type = 'STOP';
            payload.price = Number(effectivePx).toFixed(pPrec);
          }
        } else if (ordType === 'TRIGGER') {
           payload.type = 'STOP';
           if (effectivePx) payload.price = Number(effectivePx).toFixed(pPrec);
        } else if (ordType === 'STOP') {
           payload.type = 'STOP';
           if (effectivePx) payload.price = Number(effectivePx).toFixed(pPrec);
        } else if (ordType === 'TAKE_PROFIT') {
           payload.type = 'TAKE_PROFIT';
           if (effectivePx) payload.price = Number(effectivePx).toFixed(pPrec);
        } else if (ordType === 'TRAILING' || ordType === 'MOVE_ORDER_STOP') {
           payload.type = 'TRAILING_STOP_MARKET';
           delete payload.price;
        }
        
        try {
          const res = await this.sdk.withTimestampRetry(true, async () => {
            const algoParams: any = {
              algoType: 'CONDITIONAL',
              symbol: payload.symbol,
              side: payload.side,
              type: payload.type,
              quantity: Number(payload.quantity || 0),
              clientAlgoId: request.clOrdId
            };
            
            if (payload.stopPrice) algoParams.triggerPrice = Number(payload.stopPrice);
            
            if (payload.price) algoParams.price = Number(payload.price);
            if (payload.positionSide) algoParams.positionSide = payload.positionSide;

            if (payload.type === 'TRAILING_STOP_MARKET') {
              if (request.callbackRatio) {
                algoParams.callbackRate = Number(parseFloat(request.callbackRatio) * 100);
              }
              if (request.activePx && request.activePx !== '-1') {
                algoParams.activatePrice = Number(request.activePx);
              }
            }
            
            this.sdk.applyTiming(algoParams, true);
            return this.sdk.usdsFuturesClient.restAPI.newAlgoOrder(algoParams as any);
          });
          const data = await this.sdk.extractData(res) || {};
          const finalId = data.algoId ? String(data.algoId) : (data.orderId ? String(data.orderId) : "");
          return this.sdk.ok([{ ...data, ordId: finalId }]);
        } catch (e: unknown) {
          const msg = (e as Error).message || String(e);
          LogService.apiError("placeAlgo", `[BINANCE] algoOrder failed: ${msg}`);
          throw e;
        }
      }
    }

    if (!isFutures && (ordType === 'STOP' || ordType === 'CONDITIONAL')) {
      if (request.tpTriggerPx) {
        payload.stopPrice = Number(request.tpTriggerPx);
        payload.type = 'TAKE_PROFIT_LIMIT';
        payload.price = Number(request.px || request.tpPx || request.tpTriggerPx);
      }
      else if (request.slTriggerPx) {
        payload.stopPrice = Number(request.slTriggerPx);
        payload.type = 'STOP_LOSS_LIMIT';
        payload.price = Number(request.px || request.slPx || request.slTriggerPx);
      }
    } else if (!isFutures && ordType === 'TAKE_PROFIT') {
       if (request.tpTriggerPx) {
        payload.stopPrice = Number(request.tpTriggerPx);
        payload.type = 'TAKE_PROFIT_LIMIT';
        payload.price = Number(request.px || request.tpPx || request.tpTriggerPx);
      }
    }

    if (!isFutures && ordType === 'OCO') {
      payload.price = Number(parseFloat(request.px || request.tpPx || request.tpTriggerPx || '0'));
      payload.stopPrice = Number(parseFloat(request.slTriggerPx || '0'));
      payload.stopLimitPrice = Number(parseFloat(request.slPx || request.slTriggerPx || '0'));
      payload.stopLimitTimeInForce = "GTC";
      payload.listClientOrderId = ((request.clOrdId as string || `oco${Date.now()}`).replace(/[^a-zA-Z0-9]/g, '')).substring(0, 32);
    }

    if (!isFutures && (ordType === 'TRAILING' || ordType === 'MOVE_ORDER_STOP')) {
      if (isMargin) {
        throw new Error("币安杠杆暂不支持原生移动止盈止损 (trailingDelta)。");
      }
      
      payload.type = side === 'BUY' ? 'TAKE_PROFIT' : 'STOP_LOSS';
      
      if (request.callbackRatio) {
        payload.trailingDelta = Number(Math.round(parseFloat(request.callbackRatio) * 10000));
      }
      if (request.activePx) {
        payload.stopPrice = Number(request.activePx);
      }
      delete payload.price;
    }

    try {
      if (isFutures) {
        const res = await this.sdk.withTimestampRetry(true, async () => {
          this.sdk.applyTiming(payload, true);
          return this.sdk.usdsFuturesClient.restAPI.newOrder(payload as never);
        });
        const data = await this.sdk.extractData(res);
        this.sdk.clearTradeCaches();
        
        const attachAlgoOrdsRaw = (request.attachAlgoOrds as any[]) || [];
        if (isStandardOrder && attachAlgoOrdsRaw.length > 0) {
          LogService.logKey("trader", 'binance.futures.attachAlgoIgnored', { symbol }, 'warn');
        }
        const orderAttachAlgos = isStandardOrder ? [] : attachAlgoOrdsRaw;
        for (const algo of orderAttachAlgos) {
          const oppositeSide = side === "BUY" ? "SELL" : "BUY";
          if (algo.tpTriggerPx) {
            const tpPayload: any = {
              symbol,
              side: oppositeSide,
              type: "TAKE_PROFIT_MARKET",
              stopPrice: Number(algo.tpTriggerPx).toFixed(pPrec),
              closePosition: "true",
              timeInForce: "GTC",
            };
            if (payload.positionSide) tpPayload.positionSide = payload.positionSide;
            this.sdk.withTimestampRetry(true, async () => {
              this.sdk.applyTiming(tpPayload, true);
              return this.sdk.usdsFuturesClient.restAPI.newOrder(tpPayload as never);
            }).catch(e => LogService.apiError("trader", `[BINANCE] Attached TP failed: ${e.message}`));
          }
          if (algo.slTriggerPx) {
            const slPayload: any = {
              symbol,
              side: oppositeSide,
              type: "STOP_MARKET",
              stopPrice: Number(algo.slTriggerPx).toFixed(pPrec),
              closePosition: "true",
              timeInForce: "GTC",
            };
            if (payload.positionSide) slPayload.positionSide = payload.positionSide;
            this.sdk.withTimestampRetry(true, async () => {
              this.sdk.applyTiming(slPayload, true);
              return this.sdk.usdsFuturesClient.restAPI.newOrder(slPayload as never);
            }).catch(e => LogService.apiError("trader", `[BINANCE] Attached SL failed: ${e.message}`));
          }
        }

        return { code: "0", msg: "OK", data: [data] };
      } else {
        const orderAttachAlgos = (request.attachAlgoOrds as any[]) || [];
        
        if (!isFutures && (ordType === 'LIMIT' || ordType === 'LIMIT_MAKER') && orderAttachAlgos.length > 0) {
          const algo = orderAttachAlgos[0];
          const oppositeSide = side === "BUY" ? "SELL" : "BUY";
          const symbolInfo = await this.sdk.getSpotSymbolInfo(symbol);
          const pPrec = symbolInfo?.pricePrecision ?? 8;
          const qPrec = symbolInfo?.quantityPrecision ?? 2;
          
          const quantityFormatted = parseFloat(String(request.sz)).toFixed(qPrec);
          const targetPx = parseFloat(String(request.px || '0')).toFixed(pPrec);
          const tpPrice = parseFloat(String(algo.tpPx || algo.tpTriggerPx || '0')).toFixed(pPrec);
          const slPrice = parseFloat(String(algo.slPx || algo.slTriggerPx || '0')).toFixed(pPrec);
          const slStopPrice = parseFloat(String(algo.slTriggerPx || '0')).toFixed(pPrec);

          if (algo.tpTriggerPx && algo.slTriggerPx) {
            const workingTif = String(request.tif || "GTC").toUpperCase();
            const payload: any = {
              symbol,
              workingType: "LIMIT",
              workingSide: side,
              workingPrice: targetPx,
              workingQuantity: quantityFormatted,
              workingTimeInForce: workingTif,
              pendingSide: oppositeSide,
              pendingQuantity: quantityFormatted,
            };
            
            if (workingTif === "GTC") {
              payload.workingIcebergQty = "0";
            }
            
            if (isMargin) {
              payload.isIsolated = request.tdMode === 'isolated' ? "TRUE" : "FALSE";
            }

            if (oppositeSide === "SELL") {
              payload.pendingAboveType = "LIMIT_MAKER";
              payload.pendingAbovePrice = tpPrice;
              
              payload.pendingBelowType = "STOP_LOSS_LIMIT";
              payload.pendingBelowPrice = slPrice;
              payload.pendingBelowStopPrice = slStopPrice;
              const slTif = String(request.tif || "GTC").toUpperCase();
              payload.pendingBelowTimeInForce = slTif;
              if (slTif === "GTC") {
                payload.pendingBelowIcebergQty = "0";
              }
            } else {
              payload.pendingBelowType = "LIMIT_MAKER";
              payload.pendingBelowPrice = tpPrice;
              
              payload.pendingAboveType = "STOP_LOSS_LIMIT";
              payload.pendingAbovePrice = slPrice;
              payload.pendingAboveStopPrice = slStopPrice;
              const slTif = String(request.tif || "GTC").toUpperCase();
              payload.pendingAboveTimeInForce = slTif;
              if (slTif === "GTC") {
                payload.pendingAboveIcebergQty = "0";
              }
            }
            
            const res = await this.sdk.withTimestampRetry(false, async () => {
              this.sdk.applyTiming(payload, false);
              if (isMargin) {
                return this.marginOrderListOtoco(payload);
              }
              if (typeof (this.sdk.spotClient.restAPI as any).orderListOtoco === 'function') {
                return (this.sdk.spotClient.restAPI as any).orderListOtoco(payload as never);
              }
              throw new Error("orderListOtoco not supported by SDK format");
            });
            const data = await this.sdk.extractData(res) || {};
            const cType = data.contingencyType || "OTOCO";
            const reports = (data.orderReports || []).map((r: any) => ({
              ...r,
              contingencyType: cType,
              orderListId: r.orderListId ?? data.orderListId
            }));
            return { code: "0", msg: "OK", data: reports.length > 0 ? reports : [data] };
            
          } else {
            const workingTif = String(request.tif || "GTC").toUpperCase();
            const payload: any = {
              symbol,
              workingType: "LIMIT",
              workingSide: side,
              workingPrice: targetPx,
              workingQuantity: quantityFormatted,
              workingTimeInForce: workingTif,
              pendingSide: oppositeSide,
              pendingQuantity: quantityFormatted,
            };
            
            if (workingTif === "GTC") {
              payload.workingIcebergQty = "0";
            }
            
            if (isMargin) {
              payload.isIsolated = request.tdMode === 'isolated' ? "TRUE" : "FALSE";
            }

            if (algo.tpTriggerPx) {
              payload.pendingType = "LIMIT_MAKER"; 
              payload.pendingPrice = tpPrice;
            } else {
              payload.pendingType = "STOP_LOSS_LIMIT";
              payload.pendingPrice = slPrice;
              payload.pendingStopPrice = slStopPrice;
              const pendingTif = String(request.tif || "GTC").toUpperCase();
              payload.pendingTimeInForce = pendingTif;
              if (pendingTif === "GTC") {
                payload.pendingIcebergQty = "0";
              }
            }
            
            const res = await this.sdk.withTimestampRetry(false, async () => {
              this.sdk.applyTiming(payload, false);
              if (isMargin) {
                return this.marginOrderListOto(payload);
              }
              if (typeof (this.sdk.spotClient.restAPI as any).orderListOto === 'function') {
                return (this.sdk.spotClient.restAPI as any).orderListOto(payload as never);
              }
              throw new Error("orderListOto not supported by SDK format");
            });
            const data = await this.sdk.extractData(res) || {};
            const cType = data.contingencyType || "OTO";
            const reports = (data.orderReports || []).map((r: any) => ({
              ...r,
              contingencyType: cType,
              orderListId: r.orderListId ?? data.orderListId
            }));
            return { code: "0", msg: "OK", data: reports.length > 0 ? reports : [data] };
          }
        }

        const res = await this.sdk.withTimestampRetry(false, async () => {
          this.sdk.applyTiming(payload, false);
          if (isMargin && isIsolated) payload.isIsolated = 'TRUE';

          if (ordType === "OCO") {
            if (isMargin) return this.marginOrderOco(payload);
            return (this.sdk.spotClient.restAPI as any).orderOco(payload as never);
          }

          if (isMargin) return this.marginNewOrder(payload);
          return this.sdk.spotClient.restAPI.newOrder(payload as never);
        });
        const data = await this.sdk.extractData(res);

        for (const algo of orderAttachAlgos) {
          if (!isFutures && (ordType === 'LIMIT' || ordType === 'LIMIT_MAKER')) {
            LogService.logKey("trader", 'binance.spot.oto.unavailable', {}, 'warn');
            continue;
          }
          const oppositeSide = side === "BUY" ? "SELL" : "BUY";
          
          let qtyNum = parseFloat(request.sz || '0');
          if (data.executedQty && parseFloat(data.executedQty) > 0) {
            qtyNum = parseFloat(data.executedQty);
          } else if (data.origQty && parseFloat(data.origQty) > 0) {
            qtyNum = parseFloat(data.origQty);
          }
          let quantityStr = String(qtyNum);
          if (quantityStr === '0' || isNaN(qtyNum)) {
            quantityStr = request.sz;
          }
          const quantity = quantityStr;
          
          if (algo.tpTriggerPx && algo.slTriggerPx) {
              const ocoPayload: any = {
                symbol,
                side: oppositeSide,
                quantity,
                price: String(parseFloat(algo.tpPx || algo.tpTriggerPx || '0').toFixed(8)),
                stopPrice: String(parseFloat(algo.slTriggerPx || '0').toFixed(8)),
                stopLimitPrice: String(parseFloat(algo.slPx || algo.slTriggerPx || '0').toFixed(8)),
                stopLimitTimeInForce: "GTC",
                listClientOrderId: (request.clOrdId || `oco${Date.now()}`).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32),
              };
              if (isMargin && isIsolated) ocoPayload.isIsolated = 'TRUE';
              this.sdk.withTimestampRetry(false, async () => {
                this.sdk.applyTiming(ocoPayload, false);
                if (isMargin) {
                  return this.marginOrderOco(ocoPayload);
                }
                return (this.sdk.spotClient.restAPI as any).orderOco(ocoPayload as never);
              }).catch(e => LogService.apiError("trader", `[BINANCE] Attached OCO failed: ${e.message}`));
            } else if (algo.tpTriggerPx) {
              const tpPayload: any = {
                symbol,
                side: oppositeSide,
                type: "TAKE_PROFIT_LIMIT",
                quantity,
                price: String(parseFloat(algo.tpPx || algo.tpTriggerPx || '0').toFixed(8)),
                stopPrice: String(parseFloat(algo.tpTriggerPx || '0').toFixed(8)),
                timeInForce: "GTC"
              };
              if (isMargin && isIsolated) tpPayload.isIsolated = 'TRUE';
              this.sdk.withTimestampRetry(false, async () => {
                this.sdk.applyTiming(tpPayload, false);
                if (isMargin) {
                  return this.marginNewOrder(tpPayload);
                }
                return this.sdk.spotClient.restAPI.newOrder(tpPayload as never);
              }).catch(e => LogService.apiError("trader", `[BINANCE] Attached TP failed: ${e.message}`));
            } else if (algo.slTriggerPx) {
              const slPayload: any = {
                symbol,
                side: oppositeSide,
                type: "STOP_LOSS_LIMIT",
                quantity,
                stopPrice: String(parseFloat(algo.slTriggerPx || '0').toFixed(8)),
                price: String(parseFloat(algo.slPx || algo.slTriggerPx || '0').toFixed(8)),
                timeInForce: "GTC"
              };
              if (isMargin && isIsolated) slPayload.isIsolated = 'TRUE';
              this.sdk.withTimestampRetry(false, async () => {
                this.sdk.applyTiming(slPayload, false);
                if (isMargin) {
                  return this.marginNewOrder(slPayload);
                }
                return this.sdk.spotClient.restAPI.newOrder(slPayload as never);
              }).catch(e => LogService.apiError("trader", `[BINANCE] Attached SL failed: ${e.message}`));
            }
        }

        return { code: "0", msg: "OK", data: [data] };
      }
    } catch (e: unknown) {
      const msg = (e as any).response?.data?.msg || (e as any).message || String(e);
      const code = (e as any).response?.data?.code || "1";
      return { code: String(code), msg: `Binance Error: ${msg}`, data: [] };
    }
  }

  async placeOrders(requests: any[]): Promise<any> {
    const results = [];
    for (const req of requests) {
      results.push(await this.placeOrder(req));
    }
    
    const firstFail = results.find(r => r.code !== "0");
    return {
      code: firstFail ? firstFail.code : "0",
      msg: firstFail ? firstFail.msg : "Success",
      data: results.map(r => {
        const item = r.data?.[0] || {};
        return {
          ...item,
          sCode: r.code,
          sMsg: r.msg
        };
      })
    };
  }
}
