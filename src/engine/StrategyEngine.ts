
import { OKXTradeService } from "../services/okxTradeService.ts";
import { BinanceSdkTradeService } from "../services/binanceSdkTradeService.ts";
import { AccountMonitor } from "../services/AccountMonitor.ts";
import { LogService } from "../services/logService.ts";
import { encodeDescFields } from "../lib/logTemplates.ts";
import { ErrorMonitor } from "../services/errorMonitor.ts";
import { OKXWebSocketManager } from "../bootstrap/ws/wsManager.ts";
import { loadSavedConfig } from "../services/configService.ts";
import { PlaceOrderAction } from "../blocks/actions/PlaceOrderAction.ts";
import { AmendOrderAction } from "../blocks/actions/AmendOrderAction.ts";
import { AddMarginAction } from "../blocks/actions/AddMarginAction.ts";
import { ScriptState, ModuleConfig, StrategyError } from "../types/strategy.ts";
import type { ScriptType } from "../types/strategy.ts";
import { Exchange } from "../types/core.ts";
import { buildAmendDescSegments, buildAmendDescText, type AmendConfigItem } from "../components/AmendModule.tsx";
import { buildCancelDescSegments, buildCancelDescText, type CancelConfigItem } from "../components/CancelModule.tsx";
import { buildMarginDescSegments, buildMarginDescText, type MarginConfigItem } from "../components/MarginModule.tsx";
import { buildCloseDescSegments, buildCloseDescText, type CloseConfigItem } from "../components/CloseModule.tsx";
import { resolveAccountFromConfig } from "../lib/resolveAccount.ts";
import { t } from "../lib/translateKey.ts";

const EMPTY_ACCOUNT_COLORS: Record<number, string> = {};

export class StrategyEngine {
  private static states: Record<string, ScriptState> = {
    trader: { timer: null, running: false, type: "trader" },
  };

  private static operationLocks: Record<string, boolean> = {};
  private static runTokens: Record<string, number> = {};

  private static toAmendDescConfig(config: ModuleConfig): AmendConfigItem {
    return {
      id: String(config.id || ""),
      name: String(config.name || ""),
      inst_id: String(config.inst_id || ""),
      account_id: config.account_id || '',
      order_type: String(config.amend_order_type || "trigger"),
      tp_sl_type: String(config.tp_sl_type || 'tp_sl'),
      trigger_px_increment: String(config.trigger_px_increment ?? "0"),
      tp_ord_px_increment: String(config.tp_ord_px_increment ?? "29"),
      sl_ord_px_increment: String(config.sl_ord_px_increment ?? "-1"),
      px_increment: String(config.px_increment ?? "0"),
      tp_px_increment: String(config.tp_px_increment ?? "0"),
      sl_px_increment: String(config.sl_px_increment ?? "0"),
      callback_ratio_spread: String(config.callback_ratio_spread ?? "0"),
      active_px: String(config.active_px ?? "-1"),
      new_contract_size: String(config.new_contract_size ?? "1"),
      test_mode: config.amend_test_mode !== undefined ? Boolean(config.amend_test_mode) : true,
    };
  }

  private static toCancelDescConfig(config: ModuleConfig): CancelConfigItem {
    const rawOrderTypes = config.cancel_order_types;
    const orderTypes = Array.isArray(rawOrderTypes) ? rawOrderTypes.map((v: unknown) => String(v)) : [];
    return {
      id: String(config.id || ""),
      name: String(config.name || ""),
      inst_id: String(config.inst_id || ""),
      account_id: config.account_id || '',
      order_types: orderTypes,
      side: config.cancel_side || config.side || '',
      test_mode: config.cancel_test_mode !== undefined ? Boolean(config.cancel_test_mode) : true,
    };
  }

  private static toCloseDescConfig(config: ModuleConfig): CloseConfigItem {
    return {
      id: String(config.id || ""),
      name: String(config.name || ""),
      inst_id: String(config.inst_id || ""),
      account_id: config.account_id || '',
      mgn_mode: config.mgn_mode || config.close_mgn_mode || '',
      pos_side: config.pos_side || config.close_pos_side || '',
      upl_filter: config.upl_filter || config.close_upl_filter || '',
      upl_ratio_filter: config.upl_ratio_filter || config.close_upl_ratio_filter || '',
      test_mode: config.close_test_mode !== undefined ? Boolean(config.close_test_mode) : true,
      reverse: config.reverse ?? false,
    };
  }

  private static toMarginDescConfig(config: ModuleConfig): MarginConfigItem {
    return {
      id: String(config.id || ""),
      name: String(config.name || ""),
      account_id: config.account_id || '',
      margin_guard_redeem_amt: String(config.margin_guard_redeem_amt ?? "100"),
      margin_payment_account: String(config.margin_payment_account || "funding"),
      margin_to_account: config.margin_to_account ? String(config.margin_to_account) : undefined,
      test_mode: config.margin_test_mode !== undefined ? Boolean(config.margin_test_mode) : false,
    };
  }

  private static instanceKey(type: string, configId?: string): string {
    return configId ? `${type}:${configId}` : type;
  }

  private static bumpRunToken(key: string): number {
    const next = (this.runTokens[key] || 0) + 1;
    this.runTokens[key] = next;
    return next;
  }

  private static findRunningState(type: string, config: ModuleConfig): { state: ScriptState; key: string; runToken: number } | null {
    for (const [key, s] of Object.entries(this.states)) {
      if ((key === type || key.startsWith(`${type}:`)) && s.running && s.config === config) {
        return { state: s, key, runToken: this.runTokens[key] || 0 };
      }
    }
    return null;
  }

  private static async resolveAndGuardTradeService(
    config: ModuleConfig,
    type: string,
    stateKey: string,
    runToken: number
  ): Promise<unknown> {
    const tradeService = await this.getTradeService(config, type);
    if (!this.states[stateKey]?.running || this.runTokens[stateKey] !== runToken) return null;
    if (!tradeService) {
      LogService.logKey(type, 'strategy.noapikey', { module: this.getTypeLabel(type) });
      if (this.runTokens[stateKey] === runToken) {
        this.stop(type, undefined, stateKey.includes(':') ? stateKey.split(':')[1] : undefined);
      }
      return null;
    }
    return tradeService;
  }

  private static getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      trader: '批量下单', amend: '批量改单', cancel: '批量撤单',
      close: '批量平仓', margin: '批量转账',
    };
    return labels[type] || type;
  }

  private static notifyStatusChange(type: string, running: boolean) {
    const wsManager = OKXWebSocketManager.instance;
    if (wsManager) {
      wsManager.broadcast({
        type: 'script_status',
        scriptType: type,
        running: running,
        timestamp: Date.now()
      });
    }
  }

  static init() {
  }

  static getStatus(type: string, configId?: string) {
    if (!configId) {
      const anyRunning = Object.entries(this.states).some(([key, state]) => 
        (key === type || key.startsWith(`${type}:`)) && state.running
      );
      return { running: anyRunning, type };
    }

    const key = this.instanceKey(type, configId);
    const state = this.states[key];
    if (!state) return { timer: null, running: false, type: key as ScriptType };
    return {
      running: state.running,
      type: state.type,
      config: state.config
    };
  }

  static getAllInstanceStatuses(type: string): Array<{ id?: string; running: boolean; config?: ModuleConfig }> {
    const results: Array<{ id?: string; running: boolean; config?: ModuleConfig }> = [];
    for (const [key, state] of Object.entries(this.states)) {
      if (key.startsWith(type + ':') || key === type) {
        results.push({
          id: key.includes(':') ? key.split(':')[1] : undefined,
          running: state.running,
          config: state.config
        });
      }
    }
    return results;
  }

  static stop(type: string, reason?: string, configId?: string) {
    const lockKey = this.instanceKey(type, configId);
    if (this.operationLocks[lockKey]) {
      LogService.logKey(type, 'strategy.busy', { action: 'stop' });
      return false;
    }

    const state = this.states[lockKey];
    if (state && state.running) {
      this.operationLocks[lockKey] = true;
      
      try {
        this.bumpRunToken(lockKey);
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = null;
        }
        state.running = false;
        const stopReason = reason || '';
        LogService.logKey(type, 'strategy.stopped', { reason: stopReason }, 'info', configId);
        LogService.addLog(type, `--------------------------------------------------`, 'info', undefined, configId);
        this.notifyStatusChange(lockKey, false);
        return true;
      } finally {
        delete this.operationLocks[lockKey];
      }
    }
    return false;
  }

  static start(type: ScriptType, config: ModuleConfig, configId?: string) {
    const key = this.instanceKey(type, configId);
    if (this.operationLocks[key]) {
      LogService.logKey(type, 'strategy.busy', { action: 'start' });
      return false;
    }

    if (!this.states[key]) {
      this.states[key] = { timer: null, running: false, type: type };
    }
    const state = this.states[key];
    if (state.running) return false;

    this.operationLocks[key] = true;

    try {
      state.running = true;
      state.config = config;
      this.bumpRunToken(key);
      this.notifyStatusChange(key, true);

      if (type === "trader") this.runTraderLoop(config);
      else if (type === "amend") this.runAmendLoop(config);
      else if (type === "cancel") this.runCancelLoop(config);
      else if (type === "close") this.runCloseLoop(config);
      else if (type === "margin") this.runMarginLoop(config);

      return true;
    } finally {
      delete this.operationLocks[key];
    }
  }

  static async cancelSingleOrder(accountId: string, instId: string, ordId?: string, algoId?: string, tdMode?: string) {
    const config: ModuleConfig = { account_id: accountId };
    const tradeService = await this.getTradeService(config, "trader");
    if (!tradeService) throw new Error("账户未找到或未解密");

    if (algoId) {
      return await tradeService.cancelBatchAlgoOrders([{ instId, algoId, tdMode }]);
    } else if (ordId) {
      return await tradeService.cancelOrder({ instId, ordId, tdMode });
    } else {
      throw new Error("缺少订单ID或算法单ID");
    }
  }

  static async closePosition(accountId: string, instId: string, mgnMode: string, posSide?: string, ccy?: string) {
    const config: ModuleConfig = { account_id: accountId };
    const tradeService = await this.getTradeService(config, "trader");
    if (!tradeService) throw new Error("账户未找到或未解密");

    return await tradeService.closePosition({ instId, mgnMode, posSide, ccy, autoCxl: true });
  }

  static async closePositionAdvanced(params: {
    accountId: string;
    instId: string;
    mgnMode: string;
    posSide?: string;
    ccy?: string;
    priceType: 'market' | 'limit';
    px?: string;
    sz: string;
    posQty: string;
  }) {
    const config: ModuleConfig = { account_id: params.accountId };
    const tradeService = await this.getTradeService(config, "trader");
    if (!tradeService) throw new Error("账户未找到或未解密");

    let actualSz: string;
    if (params.sz.endsWith('%')) {
      const pct = parseFloat(params.sz.slice(0, -1));
      const totalQty = parseFloat(params.posQty || '0');
      if (isNaN(pct) || pct <= 0 || pct > 100 || totalQty <= 0) {
        throw new Error(`无效的数量: ${params.sz}`);
      }
      actualSz = String((totalQty * pct / 100).toFixed(8).replace(/\.?0+$/, ''));
    } else {
      actualSz = params.sz;
    }

    const isFullClose = params.sz === '100%' || params.sz === '100';
    if (params.priceType === 'market' && isFullClose) {
      return await tradeService.closePosition({
        instId: params.instId,
        mgnMode: params.mgnMode,
        posSide: params.posSide,
        ccy: params.ccy,
        autoCxl: true,
      });
    }

    const isLong = params.posSide === 'long' || (params.posSide === 'net' && parseFloat(params.posQty || '0') > 0);
    const side = isLong ? 'sell' : 'buy';
    const ordType = params.priceType === 'limit' ? 'limit' : 'market';

    const orderParams: Record<string, unknown> = {
      instId: params.instId,
      tdMode: params.mgnMode,
      side,
      ordType,
      sz: actualSz,
      reduceOnly: true,
    };

    if (params.posSide && params.posSide !== 'net') {
      orderParams.posSide = params.posSide;
    }

    if (params.priceType === 'limit' && params.px) {
      orderParams.px = params.px;
    }

    if (params.ccy) {
      orderParams.ccy = params.ccy;
    }

    return await tradeService.placeOrder(orderParams);
  }

  static async openPositionAdvanced(params: {
    accountId: string;
    instId: string;
    mgnMode: string;
    posSide?: string;
    ccy?: string;
    priceType: 'market' | 'limit';
    px?: string;
    sz: string;
    posQty: string;
  }) {
    const config: ModuleConfig = { account_id: params.accountId };
    const tradeService = await this.getTradeService(config, "trader");
    if (!tradeService) throw new Error("账户未找到或未解密");

    let actualSz: string;
    if (params.sz.endsWith('%')) {
      const pct = parseFloat(params.sz.slice(0, -1));
      const totalQty = parseFloat(params.posQty || '0');
      if (isNaN(pct) || pct <= 0 || pct > 99999 || totalQty <= 0) {
        throw new Error(`无效的数量: ${params.sz}`);
      }
      actualSz = String((totalQty * pct / 100).toFixed(8).replace(/\.?0+$/, ''));
    } else {
      actualSz = params.sz;
    }

    const isLong = params.posSide === 'long' || (params.posSide === 'net' && parseFloat(params.posQty || '0') > 0);
    const side = isLong ? 'buy' : 'sell';
    const ordType = params.priceType === 'limit' ? 'limit' : 'market';

    const orderParams: Record<string, unknown> = {
      instId: params.instId,
      tdMode: params.mgnMode,
      side,
      ordType,
      sz: actualSz,
    };

    if (params.posSide && params.posSide !== 'net') {
      orderParams.posSide = params.posSide;
    }

    if (params.priceType === 'limit' && params.px) {
      orderParams.px = params.px;
    }

    if (params.ccy) {
      orderParams.ccy = params.ccy;
    }

    return await (tradeService as any).placeOrder(orderParams);
  }

  static async reversePosition(params: {
    accountId: string;
    instId: string;
    mgnMode: string;
    posSide?: string;
    ccy?: string;
    posQty: string;
  }) {
    const config: ModuleConfig = { account_id: params.accountId };
    const tradeService = await this.getTradeService(config, "trader");
    if (!tradeService) throw new Error("账户未找到或未解密");
    const ts = tradeService as any;

    const pendingOrders = await ts.getPendingOrders(params.instId);
    if (pendingOrders && pendingOrders.length > 0) {
      const cancelResult = await ts.cancelBatchOrders(
        pendingOrders.map((o: any) => ({ instId: o.instId, ordId: o.ordId }))
      );
      if (cancelResult?.code !== '0') {
        throw new Error(`撤单失败: ${cancelResult?.msg || '未知错误'}`);
      }
    }

    const closeResult = await ts.closePosition({
      instId: params.instId,
      mgnMode: params.mgnMode,
      posSide: params.posSide,
      ccy: params.ccy,
      autoCxl: true,
    });
    if (closeResult?.code !== '0') {
      throw new Error(`平仓失败: ${closeResult?.data?.[0]?.sMsg || closeResult?.msg || '未知错误'}`);
    }

    const isLong = params.posSide === 'long' || (params.posSide === 'net' && parseFloat(params.posQty || '0') > 0);
    const side = isLong ? 'sell' : 'buy';

    const openParams: any = {
      instId: params.instId,
      tdMode: params.mgnMode,
      side,
      ordType: 'market',
      sz: params.posQty,
    };
    if (params.posSide && params.posSide !== 'net') {
      openParams.posSide = params.posSide === 'long' ? 'short' : 'long';
    }
    if (params.ccy) openParams.ccy = params.ccy;

    const openResult = await ts.placeOrder(openParams);
    if (openResult?.code !== '0') {
      throw new Error(`开仓失败(已平仓): ${openResult?.data?.[0]?.sMsg || openResult?.msg || '未知错误'}`);
    }

    return { closeResult, openResult };
  }

  public static async getTradeService(config: ModuleConfig, type: string): Promise<unknown> {
    const fullConfig = loadSavedConfig();
    const accounts = fullConfig.accounts || [];

    const result = resolveAccountFromConfig(config, type, accounts);
    if ('error' in result) {
      LogService.logKey(type, 'strategy.validation.accountResolve', { reason: result.error }, 'error');
      return null;
    }

    const { account, accountIdx } = result;

    if (!account || !account.apiKey || !account.secretKey) {
      const label = account?.name || ('#' + accountIdx);
      LogService.logKey(type, 'strategy.missing.apikey', { accountIdx, label }, 'error');
      return null;
    }

    if (account.id) {
      const cached = AccountMonitor.getInstance().getCachedService(account.id);
      if (cached) return cached;
    }

    const exchange = String(account.exchange || "").toUpperCase();
    if (exchange === Exchange.BINANCE) {
      const service = new BinanceSdkTradeService({
        apiKey: account.apiKey,
        secretKey: account.secretKey,
        accountIdx,
        accountName: account.name,
      });
      await service.syncTime();
      return service;
    }

    if (!account.passphrase) {
      const label = account?.name || ('#' + accountIdx);
      LogService.logKey(type, 'strategy.missing.passphrase', { accountIdx, label }, 'error');
      return null;
    }

    const service = new OKXTradeService({
      apiKey: account.apiKey,
      secretKey: account.secretKey,
      passphrase: account.passphrase,
      accountIdx,
      accountId: account.id,
      accountName: account.name,
    });

    await service.syncTime();

    return service;
  }

  private static async runTraderLoop(config: ModuleConfig) {
    const found = this.findRunningState("trader", config);
    if (!found) return;
    const { state: traderState, key: traderKey, runToken } = found;

    const tradeService = await this.resolveAndGuardTradeService(config, "trader", traderKey, runToken);
    if (!tradeService) return;

    try {
      await PlaceOrderAction.execute(config, tradeService, undefined, traderKey.includes(':') ? traderKey.split(':')[1] : undefined);
      if (this.states[traderKey]?.running && this.runTokens[traderKey] === runToken) {
        this.stop("trader", "单次执行完毕", traderKey.includes(':') ? traderKey.split(':')[1] : undefined);
      }
    } catch (e: unknown) {
      const error = e as StrategyError;
      LogService.logKey("trader", 'action.exception', { msg: error.message || String(e) }, 'error', traderKey.includes(':') ? traderKey.split(':')[1] : undefined);
      ErrorMonitor.captureStrategyError(error as Error, { scriptType: 'trader', config }, 'StrategyEngine');
      if (this.runTokens[traderKey] === runToken) {
        this.stop("trader", undefined, traderKey.includes(':') ? traderKey.split(':')[1] : undefined);
      }
    } finally {
      if (traderState.timer && this.runTokens[traderKey] === runToken) {
        clearTimeout(traderState.timer);
        traderState.timer = null;
      }
    }
  }

  private static async runAmendLoop(config: ModuleConfig) {
    const found = this.findRunningState("amend", config);
    if (!found) return;
    const { state: amendState, key: amendKey, runToken } = found;

    const tradeService = await this.resolveAndGuardTradeService(config, "amend", amendKey, runToken);
    if (!tradeService) return;

    const appConfig = loadSavedConfig();
    const accountNames: Record<number, string> = appConfig.accountNames || {};
    const accountList = appConfig.accounts || [];
    const amendConfigId = String(config.id || "");
    const cfgName = String(config.name || amendConfigId || "?");
    const descCfg = this.toAmendDescConfig(config);
    const descSegments = buildAmendDescSegments(descCfg, accountNames, EMPTY_ACCOUNT_COLORS, accountList, t);
    const descFields = encodeDescFields(descSegments);
    LogService.logKey("amend", 'strategy.start', { type: '改单', name: cfgName, desc: buildAmendDescText(descSegments), descFields }, 'info', amendConfigId);

    const loop = async () => {
      if (!amendState!.running || this.runTokens[amendKey] !== runToken) return;
      try {
        await AmendOrderAction.execute(config, tradeService);
        if (amendState!.running && this.runTokens[amendKey] === runToken) {
          this.stop("amend", "单次执行完毕", amendKey.includes(':') ? amendKey.split(':')[1] : undefined);
        }
      } catch (e: unknown) {
        const error = e as StrategyError;
        LogService.logKey("amend", 'action.exception', { msg: error.message || String(e) }, 'error', amendConfigId);
        ErrorMonitor.captureStrategyError(error as Error, { scriptType: 'amend', config }, 'StrategyEngine');
        if (this.runTokens[amendKey] === runToken) {
          this.stop("amend", undefined, amendKey.includes(':') ? amendKey.split(':')[1] : undefined);
        }
      }
    };
    loop();
  }

  private static async runCancelLoop(config: ModuleConfig) {
    const found = this.findRunningState("cancel", config);
    if (!found) return;
    const { state: cancelState, key: cancelKey, runToken } = found;

    const tradeService = await this.resolveAndGuardTradeService(config, "cancel", cancelKey, runToken);
    if (!tradeService) return;

    const appConfig = loadSavedConfig();
    const accountNames: Record<number, string> = appConfig.accountNames || {};
    const accountList = appConfig.accounts || [];
    const cancelConfigId = String(config.id || "");
    const cfgName = String(config.name || cancelConfigId || "?");
    const descCfg = this.toCancelDescConfig(config);
    const descSegments = buildCancelDescSegments(descCfg, accountNames, EMPTY_ACCOUNT_COLORS, accountList, t);
    const descFields = encodeDescFields(descSegments);
    LogService.logKey("cancel", 'strategy.start', { type: '撤单', name: cfgName, desc: buildCancelDescText(descSegments), descFields }, 'info', cancelConfigId);

    const loop = async () => {
      if (!cancelState!.running || this.runTokens[cancelKey] !== runToken) return;
      try {
        const { CancelOrderAction } = await import("../blocks/actions/CancelOrderAction.ts");
        await CancelOrderAction.execute(config, tradeService, () => cancelState!.running && this.runTokens[cancelKey] === runToken);
        if (cancelState!.running && this.runTokens[cancelKey] === runToken) {
          this.stop("cancel", "单次执行完毕", cancelKey.includes(':') ? cancelKey.split(':')[1] : undefined);
        }
      } catch (e: unknown) {
        const error = e as StrategyError;
        LogService.logKey("cancel", 'action.exception', { msg: error.message || String(e) }, 'error', cancelConfigId);
        ErrorMonitor.captureStrategyError(error as Error, { scriptType: 'cancel', config }, 'StrategyEngine');
        if (this.runTokens[cancelKey] === runToken) {
          this.stop("cancel", undefined, cancelKey.includes(':') ? cancelKey.split(':')[1] : undefined);
        }
      }
    };
    loop();
  }

  private static async runCloseLoop(config: ModuleConfig) {
    const found = this.findRunningState("close", config);
    if (!found) return;
    const { state: closeState, key: closeKey, runToken } = found;

    const tradeService = await this.resolveAndGuardTradeService(config, "close", closeKey, runToken);
    if (!tradeService) return;

    const appConfig = loadSavedConfig();
    const accountNames: Record<number, string> = appConfig.accountNames || {};
    const accountList = appConfig.accounts || [];
    const closeConfigId = String(config.id || "");
    const cfgName = String(config.name || closeConfigId || "?");
    const descCfg = this.toCloseDescConfig(config);
    const descSegments = buildCloseDescSegments(descCfg, accountNames, EMPTY_ACCOUNT_COLORS, accountList, t);
    const descFields = encodeDescFields(descSegments);
    LogService.logKey("close", 'strategy.start', { type: '平仓', name: cfgName, desc: buildCloseDescText(descSegments), descFields }, 'info', closeConfigId);

    const loop = async () => {
      if (!closeState!.running || this.runTokens[closeKey] !== runToken) return;
      try {
        const { ClosePositionAction } = await import("../blocks/actions/ClosePositionAction.ts");
        await ClosePositionAction.execute(config, tradeService, () => closeState!.running && this.runTokens[closeKey] === runToken);
        if (closeState!.running && this.runTokens[closeKey] === runToken) {
          this.stop("close", "单次执行完毕", closeKey.includes(':') ? closeKey.split(':')[1] : undefined);
        }
      } catch (e: unknown) {
        const error = e as StrategyError;
        LogService.logKey("close", 'action.exception', { msg: error.message || String(e) }, 'error', closeConfigId);
        ErrorMonitor.captureStrategyError(error as Error, { scriptType: 'close', config }, 'StrategyEngine');
        if (this.runTokens[closeKey] === runToken) {
          this.stop("close", undefined, closeKey.includes(':') ? closeKey.split(':')[1] : undefined);
        }
      }
    };
    loop();
  }

  private static async runMarginLoop(config: ModuleConfig) {
    const found = this.findRunningState("margin", config);
    if (!found) return;
    const { state, key, runToken } = found;

    state.config = config;

    const tradeService = await this.resolveAndGuardTradeService(config, "margin", key, runToken);
    if (!tradeService) return;

    const appConfig = loadSavedConfig();
    const accountNames: Record<number, string> = appConfig.accountNames || {};
    const accountList = appConfig.accounts || [];
    const marginConfigId = config.id || '';
    const cfgName = config.name || marginConfigId || '?';

    const descCfg = this.toMarginDescConfig(config);
    const segments = buildMarginDescSegments(descCfg, accountNames, EMPTY_ACCOUNT_COLORS, accountList, t);
    const descFields = encodeDescFields(segments);
    const descText = buildMarginDescText(segments);
    LogService.logKey("margin", 'strategy.start', { type: '转账', name: cfgName, desc: descText, descFields }, 'info', marginConfigId);

    try {
      await AddMarginAction.execute(config, tradeService, [], marginConfigId);
      if (this.runTokens[key] === runToken) {
        this.stop("margin", "单次执行完毕", marginConfigId);
      }
    } catch (e: unknown) {
      const error = e as StrategyError;
      LogService.logKey("margin", 'action.exception', { msg: error.message || String(e) }, 'error', marginConfigId);
      ErrorMonitor.captureStrategyError(error as Error, { scriptType: 'margin', config }, 'StrategyEngine');
      if (this.runTokens[key] === runToken) {
        this.stop("margin", undefined, marginConfigId);
      }
    }
  }
}
