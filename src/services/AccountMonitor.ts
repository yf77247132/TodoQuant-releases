
import { OKXTradeService } from "./okxTradeService.ts";
import type { BinanceSdkTradeService } from "./binanceSdkTradeService.ts";
import { LogService } from "./logService.ts";
import { loadSavedConfig } from "./configService.ts";
import { OKXWebSocketManager } from "./wsManager.ts";
import { SymbolUtils } from "../lib/symbolUtils.ts";
import EventEmitter from "events";
import type {
  AccountBalances,
  AccountOrder
} from '../types/monitorTypes.ts';
import type { OKXPosition } from '../types/okx.ts';
import type { ExchangeAccount } from '../types/index.ts';

export interface AccountData {
  accountIdx: number;
  accountId?: string;
  positions: OKXPosition[];
  orders: AccountOrder[];
  balances: AccountBalances | null;
  lastUpdate: number;
}

export class AccountMonitor extends EventEmitter {
  private static instance: AccountMonitor;
  private accounts: Record<number, AccountData> = {};
  private services: Record<number, OKXTradeService | BinanceSdkTradeService> = {};
  private timers: Record<number, NodeJS.Timeout> = {};
  private syncing: Record<number, boolean> = {};
  private syncFailCount: Record<number, number> = {};
  private triggerTimers: Record<number, NodeJS.Timeout[]> = {};
  private activeMonitors = new Set<number>();
  private starting: Record<number, boolean> = {};
  private stoppedAccounts = new Set<number>();
  private wsPositionsTimestamp: Record<number, number> = {};

  private constructor() {
    super();
  }

  private static accountLabel(accountIdx: number, _accountId?: string, accountName?: string): string {
    return accountName || ('#' + accountIdx);
  }

  static getInstance(): AccountMonitor {
    if (!AccountMonitor.instance) {
      AccountMonitor.instance = new AccountMonitor();
    }
    return AccountMonitor.instance;
  }

  isAccountStopped(accountIdx: number): boolean {
    return this.stoppedAccounts.has(accountIdx);
  }

  async startMonitoring(accountIdx: number, intervalMs: number = 10000) {
    if (this.timers[accountIdx] || this.starting[accountIdx]) return;
    this.starting[accountIdx] = true;
    this.activeMonitors.add(accountIdx);
    this.stoppedAccounts.delete(accountIdx);

    let service: OKXTradeService | BinanceSdkTradeService;
    let account: ExchangeAccount | undefined;
    let label: string;

    try {
      const config = loadSavedConfig();
      const accounts = config.accounts || [];

      account = accounts[accountIdx];

      label = account ? AccountMonitor.accountLabel(accountIdx, account.id, account.name) : ('#' + accountIdx);

      if (!account) {
        LogService.logKey("system", 'account.monitor.notConfigured', { accountIdx, label });
        this.activeMonitors.delete(accountIdx);
        return;
      }

      if (account.exchange !== 'OKX' && account.exchange !== 'BINANCE') {
        LogService.logKey("system", 'account.monitor.unsupported', { accountIdx, label, name: account.name, exchange: account.exchange });
        this.activeMonitors.delete(accountIdx);
        return;
      }

      const { apiKey, secretKey, passphrase } = account;
      const exchange = String(account.exchange || '').toUpperCase();

      if (!apiKey || !secretKey || (!passphrase && exchange === 'OKX') || (account as ExchangeAccount & { _decryptionFailed?: boolean })._decryptionFailed) {
        LogService.logKey("system", 'account.monitor.missingCreds', { accountIdx, label, exchange });
        this.activeMonitors.delete(accountIdx);
        return;
      }

      if (exchange === 'BINANCE') {
        try {
          const { BinanceSdkTradeService } = await import("./binanceSdkTradeService.ts");
          service = new BinanceSdkTradeService({ apiKey, secretKey, accountIdx, accountName: account.name });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          LogService.logKey('system', 'account.monitor.serviceLoadFailed', { accountIdx, label, msg: errMsg }, 'error');
          this.activeMonitors.delete(accountIdx);
          return;
        }
      } else {
        service = new OKXTradeService({ apiKey, secretKey, passphrase: passphrase || "", accountIdx, accountId: account.id, accountName: account.name });
      }

      const backgroundInit = (async () => {
        try {
          await Promise.race([
            service.syncTime(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Time sync timeout")), 8000)
            )
          ]);
          LogService.logKey('system', 'account.init.timeSyncOk', { accountIdx, label });
        } catch {
          LogService.logKey('system', 'account.init.timeSyncTimeout', { accountIdx, label });
        }

        try {
          const testBalance = await Promise.race([
            service.getAccountBalance(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Balance fetch timeout")), 5000)
            )
          ]);
          if (testBalance === null) {
            LogService.logKey('system', 'account.init.apiTestFail', { accountIdx, label }, 'error');
          } else {
            LogService.logKey('system', 'account.init.apiTestOk', { accountIdx, label });
          }
        } catch (e: unknown) {
          const err = e instanceof Error ? e : new Error(String(e));
          LogService.logKey('system', 'account.monitor.apiTestException', { accountIdx, label, msg: err.message }, 'warn');
        }
      })();
      backgroundInit.catch(() => {});
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      LogService.logKey('system', 'account.init.fatal', { accountIdx, label, msg: errMsg }, 'error');
      this.activeMonitors.delete(accountIdx);
      return;
    } finally {
      this.starting[accountIdx] = false;
    }

    if (!this.activeMonitors.has(accountIdx)) {
      LogService.logKey('system', 'account.monitor.initStopped', { accountIdx, label });
      return;
    }

    this.services[accountIdx] = service;
    this.accounts[accountIdx] = {
      accountIdx,
      accountId: account.id,
      accountName: account.name,
      positions: [],
      orders: [],
      balances: null,
      lastUpdate: 0
    };

    const sync = async () => {
      const instance = OKXWebSocketManager.instance;

      if (!this.activeMonitors.has(accountIdx)) {
        return;
      }

      if (this.syncing[accountIdx]) {
        return;
      }

      if (instance?.isPermanentlyStopped(accountIdx)) {
        this.stopMonitoring(accountIdx);
        return;
      }

      this.syncing[accountIdx] = true;
      try {
        await this.syncAccount(accountIdx);
        this.syncFailCount[accountIdx] = 0;
      } catch (e: unknown) {
        const error = e as Error;
        const failCount = (this.syncFailCount[accountIdx] || 0) + 1;
        this.syncFailCount[accountIdx] = failCount;
        
        LogService.logKey("system", 'account.sync.error', { accountIdx, label, failCount, msg: error.message || String(e) }, 'error');
        
        if (failCount >= 5) {
          LogService.logKey("system", 'account.sync.stopped', { accountIdx, label, count: failCount }, 'error');
          this.stopMonitoring(accountIdx);
          return;
        }
      } finally {
        this.syncing[accountIdx] = false;
      }

      if (!this.activeMonitors.has(accountIdx) || instance?.isPermanentlyStopped(accountIdx)) {
        if (this.timers[accountIdx]) {
          clearTimeout(this.timers[accountIdx]);
          delete this.timers[accountIdx];
        }
        return;
      }

      this.timers[accountIdx] = setTimeout(sync, intervalMs);
    };

    const jitter = accountIdx * 500 + Math.floor(Math.random() * 1000);
    
    this.timers[accountIdx] = setTimeout(sync, jitter);
    LogService.logKey("system", 'account.monitoring.started', { accountIdx, label, intervalMs });
  }

  public async triggerSyncByAccountId(accountId: string) {
    const accountIdx = Object.keys(this.accounts).find(idx => this.accounts[Number(idx)].accountId === accountId);
    if (accountIdx !== undefined) {
      const idx = Number(accountIdx);

      const runSync = async (tag: string) => {
        if (this.syncing[idx]) return;

        const service = this.services[idx];
        if (service && typeof (service as { clearTradeCaches?: () => void }).clearTradeCaches === 'function') {
          try { (service as { clearTradeCaches: () => void }).clearTradeCaches(); } catch (e: unknown) {
            const err = e instanceof Error ? e : new Error(String(e));
            LogService.warn("monitor", `账户 ${idx} clearTradeCaches 失败: ${err.message}`);
          }
        }
        
        try {
          await this.syncAccount(idx);
          
        } catch (err: unknown) {
          LogService.warn("monitor", `账户 ${idx} 同步失败 (${tag}): ${(err as Error).message}`);
        }
      };

      this.triggerTimers[idx] = [
        setTimeout(() => runSync("快速"), 500),
        setTimeout(() => runSync("补丁"), 2000),
        setTimeout(() => runSync("最终保障"), 5000),
      ];
    }
  }

  static stopAll() {
    if (AccountMonitor.instance) {
      AccountMonitor.instance.stopAll();
    }
  }

  stopAll() {
    this.activeMonitors.clear();
    this.starting = {};
    Object.keys(this.timers).forEach(idx => {
      this.stopMonitoring(Number(idx));
    });
    this.accounts = {};
    this.services = {};
    this.stoppedAccounts.clear();
    this.syncing = {};
    this.syncFailCount = {};
    this.triggerTimers = {};
    this.wsPositionsTimestamp = {};
  }

  stopMonitoring(accountIdx: number) {
    this.activeMonitors.delete(accountIdx);
    delete this.starting[accountIdx];
    this.stoppedAccounts.add(accountIdx);
    this.syncing[accountIdx] = true;
    if (this.timers[accountIdx]) {
      clearTimeout(this.timers[accountIdx]);
      delete this.timers[accountIdx];
    }
    if (this.triggerTimers[accountIdx]) {
      this.triggerTimers[accountIdx].forEach(t => clearTimeout(t));
      delete this.triggerTimers[accountIdx];
    }
    LogService.logKey("system", 'account.monitor.stopped', { accountIdx, label: AccountMonitor.accountLabel(accountIdx, this.accounts[accountIdx]?.accountId, this.accounts[accountIdx]?.accountName) });
  }

  private async syncAccount(accountIdx: number) {
    const instance = OKXWebSocketManager.instance;
    if (instance?.isPermanentlyStopped(accountIdx) || !this.activeMonitors.has(accountIdx)) {
      return;
    }

    const service = this.services[accountIdx];
    const data = this.accounts[accountIdx];

    if (!service || !data) {
      LogService.logKey("system", 'account.sync.skip.uninitialized', { accountIdx, label: '#' + accountIdx });
      return;
    }

    const fetchStart = Date.now();

    try {
      const [positions, orders, balance] = await Promise.all([
        service.getPositions(),
        this.fetchAllPendingOrders(service),
        service.getAccountBalance()
      ]);

      if (!this.activeMonitors.has(accountIdx)) {
        return;
      }

      if (balance !== null) {
        if (balance && typeof balance === 'object' && ('totalEq' in balance || 'details' in balance)) {
          data.balances = balance as AccountBalances;
        } else {
          LogService.logKey('system', 'account.balance.unrecognized', {
            accountIdx, type: typeof balance, keys: balance ? Object.keys(balance as object) : null
          }, 'warn');
          data.balances = balance as unknown as AccountBalances;
        }

        const wsManager = globalThis.OKX_WS_MANAGER;
        if (wsManager && typeof wsManager.broadcast === 'function') {
          wsManager.broadcast({
            type: 'account_update',
            account: accountIdx,
            balances: {
              ...data.balances,
              ...(data.accountId ? { _accountId: data.accountId } : {})
            }
          });
        }
      }
      if (positions !== null) {
        const wsTs = this.wsPositionsTimestamp[accountIdx];
        if (wsTs && wsTs > fetchStart) {
        } else {
          data.positions = positions;

          const wsManager = globalThis.OKX_WS_MANAGER;
          if (wsManager && typeof wsManager.broadcast === 'function') {
            wsManager.broadcast({
              type: 'positions_update',
              account: accountIdx,
              data: positions.map(p => ({
                ...p,
                _account: accountIdx,
                ...(data.accountId ? { _accountId: data.accountId } : {})
              }))
            });
          }
        }
      }
      if (orders !== null) {
        data.orders = orders;
      }
      if (balance !== null || positions !== null || orders !== null) {
        data.lastUpdate = Date.now();
      }
    } catch (e: unknown) {
      const error = e as Error;
      if (error.message.includes('PASSPHRASE incorrect') || error.message.includes('50111')) {
        data.balances = undefined;
        data.positions = [];
        data.orders = [];
        data.lastUpdate = Date.now();
        LogService.logKey("system", 'account.sync.authFailure', { accountIdx, label: AccountMonitor.accountLabel(accountIdx, data.accountId) }, 'debug');
      }
      throw e;
    }
  }

  private async fetchAllPendingOrders(service: OKXTradeService | BinanceSdkTradeService, algoTypes?: string[], instType?: string): Promise<AccountOrder[]> {
    if (algoTypes && algoTypes.length > 0) {
      const requests: Promise<AccountOrder[]>[] = [];
      for (const type of algoTypes) {
        requests.push(service.fetchAllPagesForAlgoType(type, instType) as Promise<AccountOrder[]>);
      }
      const results = await Promise.all(requests);
      return results.flat().map(order => AccountMonitor.transformOrder(order) as AccountOrder);
    }

    const isLightSync = Array.isArray(algoTypes) && algoTypes.length === 0;

    if (isLightSync) {
      const instTypes = instType ? [instType] : ['SWAP', 'SPOT', 'MARGIN', 'FUTURES', 'OPTION'];
      const allOrders: AccountOrder[] = [];
      for (const type of instTypes) {
        if (service.exchangeType === 'BINANCE' && !instType && type !== 'SWAP') continue;
        const apiParam = type === 'SWAP' ? undefined : type;
        const orders = await service.fetchAllPagesForOrders(apiParam);
        if (orders && orders.length > 0) allOrders.push(...orders);
        await new Promise(r => setTimeout(r, 100));
      }
      return allOrders.map(order => AccountMonitor.transformOrder(order) as AccountOrder);
    }

    const instTypes = ['SWAP', 'SPOT', 'MARGIN', 'FUTURES', 'OPTION'];
    const algoTypesToFetch = ['conditional', 'oco', 'chase', 'trigger', 'move_order_stop', 'iceberg', 'twap', 'trailing_stop'];

    const allOrders: AccountOrder[] = [];

    for (const type of instTypes) {
      if (service.exchangeType === 'BINANCE' && type !== 'SWAP') continue;
      const orders = await service.fetchAllPagesForOrders(type === 'SWAP' ? undefined : type);
      if (orders && orders.length > 0) allOrders.push(...orders);
      await new Promise(r => setTimeout(r, 100));
    }

    for (let i = 0; i < algoTypesToFetch.length; i += 2) {
      const batch = algoTypesToFetch.slice(i, i + 2);
      const batchResults = await Promise.all(batch.map(type => service.fetchAllPagesForAlgoType(type)));
      batchResults.forEach(orders => {
        if (orders && orders.length > 0) allOrders.push(...orders);
      });
      await new Promise(r => setTimeout(r, 100));
    }

    return allOrders.map(order => AccountMonitor.transformOrder(order) as AccountOrder);
  }

  async syncPositions(accountIdx: number) {
    if (!this.activeMonitors.has(accountIdx)) {
      LogService.logKey("system", 'account.sync.positions.silentSkip.notMonitored', { accountIdx, activeCount: this.activeMonitors.size }, 'warn');
      return;
    }
    const service = this.services[accountIdx];
    const data = this.accounts[accountIdx];

    if (!service || !data) {
      LogService.logKey("system", 'account.sync.positions.skip.uninitialized', { accountIdx, label: '#' + accountIdx });
      return;
    }

    const fetchStart = Date.now();
    const positions = await service.getPositions();

    if (positions !== null) {
      const wsTs = this.wsPositionsTimestamp[accountIdx];
      if (wsTs && wsTs > fetchStart) {
      } else {
        data.positions = positions;

        const wsManager = globalThis.OKX_WS_MANAGER;
        if (wsManager && typeof wsManager.broadcast === 'function') {
          wsManager.broadcast({
            type: 'positions_update',
            account: accountIdx,
            data: positions.map(p => ({
              ...p,
              _account: accountIdx,
              ...(data.accountId ? { _accountId: data.accountId } : {})
            }))
          });
        }
      }
      data.lastUpdate = Date.now();
    }
  }

  async syncAccountOrders(accountIdx: number, algoTypes?: string[], instType?: string) {
    if (!this.activeMonitors.has(accountIdx)) {
      LogService.logKey("system", 'account.sync.orders.silentSkip.notMonitored', { accountIdx, activeCount: this.activeMonitors.size }, 'warn');
      return;
    }
    const service = this.services[accountIdx];
    const data = this.accounts[accountIdx];

    if (!service || !data) {
      LogService.logKey("system", 'account.sync.orders.skip.uninitialized', { accountIdx, label: '#' + accountIdx });
      return;
    }

    const fetchedOrders = AccountMonitor.mergeBinanceOtoOrders(
      await this.fetchAllPendingOrders(service, algoTypes, instType)
    );
    const newOrders = fetchedOrders.map(order => ({
      ...order,
      _account: accountIdx,
    }));
    if (!this.activeMonitors.has(accountIdx)) {
      LogService.logKey("system", 'account.sync.orders.aborted.monitorStopped', { accountIdx }, 'warn');
      return;
    }
    if (newOrders !== null) {
      if (newOrders.length === 0 && algoTypes && algoTypes.length > 0) {
        LogService.logKey('system', 'account.sync.emptyResult', {}, 'warn');
      }

      const actualTypes = newOrders.length > 0
        ? new Set(newOrders.map((o) => o.ordType as string))
        : (algoTypes && algoTypes.length > 0 ? new Set(algoTypes) : new Set<string>());
      const otherOrders = actualTypes.size > 0
        ? data.orders.filter(o => !actualTypes.has(o.ordType as string))
        : [];
      const seen = new Set<string>();
      const deduped = [...otherOrders, ...newOrders].filter((o) => {
        const id = o.ordId ? String(o.ordId) : "";
        if (!id) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      data.orders = deduped;
      data.lastUpdate = Date.now();

      const ordersCache = (globalThis as Record<string, unknown>).ORDERS_CACHE as { cache?: Record<number, { data: AccountOrder[] }>; broadcastSyncSignal?: () => void; setAccountOrders?: (idx: number, orders: AccountOrder[], ts: number) => void } | undefined;
      if (ordersCache?.broadcastSyncSignal) {
        const cacheOrders = ordersCache.cache?.[accountIdx]?.data || [];
        const cacheOtherOrders = actualTypes.size > 0
          ? cacheOrders.filter((o) => !actualTypes.has(o.ordType as string))
          : [];
        const cacheSeen = new Set<string>();
        const cacheDeduped = [...cacheOtherOrders, ...newOrders].filter((o) => {
          const id = o.ordId ? String(o.ordId) : "";
          if (!id) return true;
          if (cacheSeen.has(id)) return false;
          cacheSeen.add(id);
          return true;
        });
        ordersCache.setAccountOrders?.(accountIdx, cacheDeduped, Date.now());
        ordersCache.broadcastSyncSignal();
      } else {
        LogService.logKey("system", 'account.sync.orders.cacheMissing', { accountIdx }, 'warn');
      }
    }
  }

  public static transformOrder(order: Record<string, unknown>): Record<string, unknown> {
    const isAlgo = !!order.algoId;
    const baseOrdType = String(order.ordType || "").toLowerCase();

    const typeMap: Record<string, string> = {
      'market': '市价委托',
      'limit': '限价委托',
      'post_only': '限价-Post only',
      'fok': '限价-FOK',
      'ioc': '限价-IOC',
      'conditional': '单向止盈止损',
      'oco': '双向止盈止损',
      'chase': '追逐限价',
      'trigger': '计划委托',
      'move_order_stop': '移动止盈止损',
      'twap': '时间加权委托',
      'limit_maker': '限价-Post only',
      'stop_loss_limit': '止损限价',
      'take_profit_limit': '止盈限价',
      'stop_market': '止损市价',
      'take_profit_market': '止盈市价',
      'stop_loss': '止损委托',
      'take_profit': '止盈委托',
      'trailing_stop_market': '跟踪止损市价',
    };
    let orderTypeDisplay = typeMap[baseOrdType] || order.ordType;

    const isBinanceConditionalTpSl = order.exchange === 'BINANCE' && order._algoType === 'CONDITIONAL' &&
      order._execType && ['STOP','TAKE_PROFIT','STOP_MARKET','TAKE_PROFIT_MARKET'].includes(order._execType);
    if (!isBinanceConditionalTpSl && order.trailingDelta) {
      orderTypeDisplay = "移动止盈止损";
    } else if (!isBinanceConditionalTpSl && order.exchange === 'BINANCE' && (order.tdMode === 'cross' || order.tdMode === 'isolated') && order.activationPrice && (!order.px || String(order.px) === '0')) {
      orderTypeDisplay = "移动止盈止损";
    } else if (isBinanceConditionalTpSl) {
      orderTypeDisplay = "单向止盈止损";
    } else if (order.orderListId && String(order.orderListId) !== "-1") {
      const isOco = order.contingencyType === "OCO" || (!order.contingencyType && order.orderListId);
      const isOto = order.contingencyType === "OTO" || order.contingencyType === "OTOCO";

      if (isOco) {
        orderTypeDisplay = "双向止盈止损";
      } else if (isOto) {
        if (baseOrdType === "limit_maker" || baseOrdType === "limit") {
          orderTypeDisplay = "限价委托";
        } else if (baseOrdType === "stop_loss_limit" || baseOrdType === "stop_loss") {
          orderTypeDisplay = "止损子单 (OTO)";
        } else {
          orderTypeDisplay = "限价委托";
        }
      } else {
        orderTypeDisplay = "双向止盈止损";
      }
    } else if (["stop_loss_limit", "take_profit_limit", "stop_market", "take_profit_market", "stop_loss", "take_profit"].includes(baseOrdType)) {
      orderTypeDisplay = "单向止盈止损";
    }

    const result: Record<string, unknown> = {
      ...order,
      orderTypeDisplay
    };

    if (order.cTime) {
      result.orderTime = order.cTime;
    }

    const addIfExist = (key: string, val: unknown) => {
      if (val !== undefined && val !== null && val !== '') {
        result[key] = val;
      }
    };

    if (isAlgo) {
      if (order.ordType === 'oco') {
        const tpTrig = order.tpTriggerPx || '-';
        const slTrig = order.slTriggerPx || '-';
        if (order.tpTriggerPx || order.slTriggerPx) {
          result.triggerPrice = `${tpTrig}/${slTrig}`;
        }
        result.orderPrice = '-';
      } else if (isBinanceConditionalTpSl) {
        addIfExist('triggerPrice', order.triggerPx || order.triggerPrice);
        result.orderPrice = '-';
        if (order._execType?.includes('TAKE_PROFIT')) {
          addIfExist('tpPrice', order.price || order.px || order.ordPx);
        }
        if (order._execType?.includes('STOP')) {
          addIfExist('slPrice', order.price || order.px || order.ordPx);
        }
      } else {
        addIfExist('triggerPrice', order.triggerPx || order.activePx || order.tpTriggerPx || order.slTriggerPx);

        if (baseOrdType === 'chase') {
          result.orderPrice = '-';
          if (order.chaseVal) {
            result.chaseOffset = order.chaseVal;
          }
        } else {
          addIfExist('orderPrice', order.ordPx || order.px);
        }
      }
      addIfExist('tpPrice', order.tpOrdPx || order.attachAlgoOrds?.[0]?.tpOrdPx);
      addIfExist('slPrice', order.slOrdPx || order.attachAlgoOrds?.[0]?.slOrdPx);
      const algo0 = order.attachAlgoOrds?.[0];
      if (algo0) {
        addIfExist('callbackRatio', algo0.callbackRatio);
        addIfExist('callbackSpread', algo0.callbackSpread);
        addIfExist('activePx', algo0.activePx);
      }
    } else {
      addIfExist('orderPrice', order.px || order.ordPx);
      addIfExist('tpPrice', order.tpOrdPx || order.attachAlgoOrds?.[0]?.tpOrdPx);
      addIfExist('slPrice', order.slOrdPx || order.attachAlgoOrds?.[0]?.slOrdPx);
      const algo0 = order.attachAlgoOrds?.[0];
      if (algo0) {
        addIfExist('callbackRatio', algo0.callbackRatio);
        addIfExist('callbackSpread', algo0.callbackSpread);
        addIfExist('activePx', algo0.activePx);
      }
    }

      const tpTrig = order.tpTriggerPx || order.tpTriggerPrice;
      const slTrig = order.slTriggerPx || order.slTriggerPrice;
    const trigPx = order.triggerPx || order.triggerPrice || order.activePx || order.activatePrice || order.activationPrice;
    const isOcoSubOrder = !!order.orderListId && String(order.orderListId) !== '-1' && !isAlgo;

    if (order.ordType === 'oco' || baseOrdType === 'stop_market' || baseOrdType === 'take_profit_market'
      || orderTypeDisplay === '单向止盈止损' || isOcoSubOrder) {
      const hasOnlyTp = !!tpTrig && !slTrig;
      const hasOnlySl = !!slTrig && !tpTrig;
      
      if ((tpTrig && slTrig) && !isOcoSubOrder) {
        result.triggerPrice = `${tpTrig || '-'}/${slTrig || '-'}`;
      } else if (hasOnlyTp && !isOcoSubOrder) {
        result.triggerPrice = tpTrig;
      } else if (hasOnlySl && !isOcoSubOrder) {
        result.triggerPrice = slTrig;
      } else {
        let effectiveTrig: string | number | undefined;
        
        const hasTpFields = !!order.tpTriggerPx || !!order.tpOrdPx;
        const hasSlFields = !!order.slTriggerPx || !!order.slOrdPx;
        const isTpOrderByType = baseOrdType.includes('take_profit') 
          || String(order.type || '').toUpperCase().includes('TAKE_PROFIT');
        const isSlOrderByType = (baseOrdType.includes('stop') && !baseOrdType.includes('take'))
          || String(order.type || '').toUpperCase() === 'STOP';
        
        if (hasTpFields && !hasSlFields) {
          effectiveTrig = tpTrig;
        } else if (hasSlFields && !hasTpFields) {
          effectiveTrig = slTrig;
        } else if (isTpOrderByType && tpTrig) {
          effectiveTrig = tpTrig;
        } else if (isSlOrderByType && slTrig) {
          effectiveTrig = slTrig;
        } else {
          effectiveTrig = isOcoSubOrder && (!trigPx || String(trigPx) === '0' || trigPx === '0.00000000')
            ? undefined : trigPx;
        }
        addIfExist('triggerPrice', effectiveTrig);
      }
      const isOcoConditionSub = isOcoSubOrder && ['stop_loss_limit','take_profit_limit','stop_loss','take_profit','stop_market','take_profit_market'].includes(baseOrdType);
      if (!isOcoSubOrder || isOcoConditionSub) {
        result.orderPrice = '-';
      }

      if (!isAlgo && (orderTypeDisplay === '单向止盈止损' || orderTypeDisplay === '双向止盈止损'
        || ['stop_loss_limit','take_profit_limit','stop_loss','take_profit','stop_market','take_profit_market'].includes(baseOrdType))) {
        if (baseOrdType.includes('take_profit') || String(order.type || '').toUpperCase().includes('TAKE_PROFIT')) {
          addIfExist('tpPrice', order.px || order.price);
        }
        if (baseOrdType.includes('stop') && !baseOrdType.includes('take')
          || String(order.type || '').toUpperCase() === 'STOP') {
          addIfExist('slPrice', order.px || order.price);
        }
      }
    } else if (baseOrdType === 'trigger' || order.ordType === 'trigger' || orderTypeDisplay === '计划委托') {
      addIfExist('triggerPrice', order.triggerPx || order.triggerPrice);
      addIfExist('orderPrice', order.ordPx || order.px || order.price);
    } else if (baseOrdType === 'move_order_stop' || baseOrdType === 'trailing_stop_market' || orderTypeDisplay === '移动止盈止损' || order.ordType === 'move_order_stop') {
      const isBinance = order.exchange === 'BINANCE';
      if (isBinance) {
        const trailingDelta = Number(order.trailingDelta || 0);
        const callbackRate = Number(order.callbackRate || 0);
        
        if (trailingDelta > 0) {
          result.callbackRatio = (trailingDelta / 10000).toFixed(4);
        } else if (callbackRate > 0) {
          result.callbackRatio = (callbackRate / 100).toFixed(4);
        }
        
        const ap = order.activationPrice || order.activatePrice || order.activatePx || order.triggerPx;
        result.triggerPrice = ap || '-';
        result.activePx = ap || '-';
        result.orderPrice = order.triggerPx || order.triggerPrice || '-';
        result.slPrice = '-';
      } else {
        const trailingActivePx = order.activePx || order.activatePrice || order.activationPrice;
        const trailingTriggerPx = order.moveTriggerPx || order.triggerPx || order.triggerPrice;
        addIfExist('triggerPrice', trailingActivePx);
        addIfExist('activePx', trailingActivePx);
        result.orderPrice = trailingTriggerPx && String(trailingTriggerPx) !== '0' ? String(trailingTriggerPx) : '-';
      }
    }

    return result;
  }

  public static mergeBinanceOtoOrders<T extends AccountOrder>(orders: T[]): T[] {
    const orderListGroups = new Map<string, T[]>();
    const timeGroups = new Map<string, T[]>();

    orders.forEach((order) => {
      if (order.exchange !== 'BINANCE') return;

      const orderListId = String(order.orderListId || '');
      if (orderListId && orderListId !== '0' && orderListId !== '-1') {
        if (!orderListGroups.has(orderListId)) orderListGroups.set(orderListId, []);
        orderListGroups.get(orderListId)!.push(order);
        return;
      }

      const timeKey = String(order.cTime || '');
      if (!timeKey || timeKey === '0') return;
      if (!timeGroups.has(timeKey)) timeGroups.set(timeKey, []);
      timeGroups.get(timeKey)!.push(order);
    });

    if (orderListGroups.size === 0 && timeGroups.size === 0) {
      return orders;
    }

    const childOrderIds = new Set<string>();

    orderListGroups.forEach((group) => {
      if (group.length < 2) return;

      const mainLeg = group.find((order) =>
        String(order.ordType || '').toLowerCase() === 'limit'
      );
      if (!mainLeg) return;

      const pendingLegs = group.filter((order) => {
        if (order.ordId === mainLeg.ordId) return false;
        const type = String(order.ordType || '').toLowerCase();
        return ['limit_maker', 'stop_loss_limit', 'take_profit_limit', 'take_profit', 'stop_loss'].includes(type);
      });

      if (pendingLegs.length === 0) return;

      const tpLeg = pendingLegs.find((order) => {
        const type = String(order.ordType || '').toLowerCase();
        return ['limit_maker', 'take_profit_limit', 'take_profit'].includes(type);
      });
      const slLeg = pendingLegs.find((order) => {
        const type = String(order.ordType || '').toLowerCase();
        return ['stop_loss_limit', 'stop_loss'].includes(type);
      });

      if (!tpLeg && !slLeg) return;

      (mainLeg as Record<string, unknown>).otoGroupType = (tpLeg && slLeg) ? 'OTOCO' : 'OTO';
      (mainLeg as Record<string, unknown>).otoTpPrice = tpLeg ? (tpLeg.px || tpLeg.orderPrice || tpLeg.tpPrice) : null;
      (mainLeg as Record<string, unknown>).otoSlPrice = slLeg ? (slLeg.px || slLeg.orderPrice || slLeg.slPrice) : null;
      mainLeg.orderTypeDisplay = '限价委托';
      pendingLegs.forEach((child) => {
        if (child.ordId) childOrderIds.add(String(child.ordId));
      });
    });

    timeGroups.forEach((group) => {
      if (group.length < 2) return;

      const mainLeg = group.find((order) =>
        String(order.ordType || '').toLowerCase() === 'limit'
      );
      if (!mainLeg) return;

      const pendingLegs = group.filter((order) => {
        if (order.ordId === mainLeg.ordId) return false;
        const type = String(order.ordType || '').toLowerCase();
        return ['limit_maker', 'stop_loss_limit', 'take_profit_limit', 'take_profit', 'stop_loss'].includes(type);
      });

      if (pendingLegs.length === 0) return;

      const tpLeg = pendingLegs.find((order) => {
        const type = String(order.ordType || '').toLowerCase();
        return ['limit_maker', 'take_profit_limit', 'take_profit'].includes(type);
      });
      const slLeg = pendingLegs.find((order) => {
        const type = String(order.ordType || '').toLowerCase();
        return ['stop_loss_limit', 'stop_loss'].includes(type);
      });

      if (!tpLeg && !slLeg) return;

      (mainLeg as Record<string, unknown>).otoGroupType = (tpLeg && slLeg) ? 'OTOCO' : 'OTO';
      (mainLeg as Record<string, unknown>).otoTpPrice = tpLeg ? (tpLeg.px || tpLeg.orderPrice || tpLeg.tpPrice) : null;
      (mainLeg as Record<string, unknown>).otoSlPrice = slLeg ? (slLeg.px || slLeg.orderPrice || slLeg.slPrice) : null;
      mainLeg.orderTypeDisplay = '限价委托';
      pendingLegs.forEach((child) => {
        if (child.ordId) childOrderIds.add(String(child.ordId));
      });
    });

    if (childOrderIds.size === 0) {
      return orders;
    }

    return orders.filter((order) => !childOrderIds.has(String(order.ordId || '')));
  }

  getAccountData(accountIdx: number): AccountData | null {
    return this.accounts[accountIdx] || null;
  }

  updatePositionsFromWs(accountIdx: number, positions: OKXPosition[]) {
    const data = this.accounts[accountIdx];
    if (!data) return;

    this.wsPositionsTimestamp[accountIdx] = Date.now();

    data.positions = positions;
    data.lastUpdate = Date.now();

    const wsManager = globalThis.OKX_WS_MANAGER;
    if (wsManager && typeof wsManager.broadcast === 'function') {
      wsManager.broadcast({
        type: 'positions_update',
        account: accountIdx,
        data: positions.map(p => ({ 
          ...p, 
          _account: accountIdx,
          ...(data.accountId ? { _accountId: data.accountId } : {})
        }))
      });
    }

    this.emit('positions_updated', { accountIdx, positions });
  }

  updateOrdersFromWs(accountIdx: number, orders: AccountOrder[]) {
    const data = this.accounts[accountIdx];
    if (!data) return;

    for (const newOrder of orders) {
      const ordId = newOrder.algoId || newOrder.ordId;
      if (!ordId) continue;

      const state = (newOrder.state || '').toLowerCase();
      const isLive = ['live', 'partially_filled', 'effective', 'partially_effective'].includes(state);

      const isTriggerEffective = isLive
        && String(newOrder.ordType || '').toLowerCase() === 'trigger'
        && state === 'effective';

      if (isTriggerEffective) {
        data.orders = data.orders.filter(o => (o.algoId || o.ordId) !== ordId);
      } else if (isLive) {
        const existingIdx = data.orders.findIndex(o => (o.algoId || o.ordId) === ordId);
        if (existingIdx >= 0) {
          data.orders[existingIdx] = { ...data.orders[existingIdx], ...newOrder };
        } else {
          data.orders.push(newOrder);
        }
      } else {
        data.orders = data.orders.filter(o => (o.algoId || o.ordId) !== ordId);
      }
    }

    data.lastUpdate = Date.now();
    this.emit('orders_updated', { accountIdx, orders });
  }

  updateBalancesFromWs(accountIdx: number, accountData: Array<{ details?: unknown[] }>) {
    const data = this.accounts[accountIdx];
    if (!data || !accountData || accountData.length === 0) return;

    const balanceInfo = accountData[0];
    if (balanceInfo && balanceInfo.details) {
      data.balances = balanceInfo as unknown as AccountBalances;
      data.lastUpdate = Date.now();

      const wsManager = globalThis.OKX_WS_MANAGER;
      if (wsManager && typeof wsManager.broadcast === 'function') {
        wsManager.broadcast({
          type: 'account_update',
          account: accountIdx,
          balances: {
            ...data.balances,
            ...(data.accountId ? { _accountId: data.accountId } : {})
          }
        });
      }
    }
  }

  getPosition(accountIdx: number, instId: string) {
    const data = this.getAccountData(accountIdx);
    if (!data) return null;
    return data.positions.find(p => SymbolUtils.isSameSymbol(p.instId, instId)) || null;
  }

  getAllOrders(accountIdx: number) {
    const data = this.getAccountData(accountIdx);
    if (!data) return [];
    return data.orders;
  }

  getOrders(accountIdx: number, instId: string) {
    const data = this.getAccountData(accountIdx);
    if (!data) return [];
    return data.orders.filter(o => SymbolUtils.isSameSymbol(o.instId, instId));
  }
}
