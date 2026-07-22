
import { OKXTradeService } from "./okxTradeService.ts";
import type { BinanceSdkTradeService } from "./binanceSdkTradeService.ts";
import { AccountMonitor } from "./AccountMonitor.ts";
import { OKXWebSocketManager } from "./wsManager.ts";
import { loadSavedConfig } from "./configService.ts";
import { LogService } from "./logService.ts";
import { ErrorMonitor, ErrorLevel, ErrorCategory } from "./errorMonitor.ts";
import { Exchange, type ExchangeAccount } from "../types/core.ts";
import { WebSocketServer } from 'ws';
import type { AccountOrder } from "../types/monitorTypes.ts";

const LIVE_STATES = new Set([
  'live',
  'partially_filled',
  'effective',
  'partially_effective',
  'new',
  'pending_new',
]);

interface OrdersCache {
  data: AccountOrder[];
  timestamp: number;
}

interface OrdersCacheConfig {
  wss: WebSocketServer;
}

export class OrdersCacheManager {
  private cache: Record<number, OrdersCache> = {};
  private services: Record<number, OKXTradeService | BinanceSdkTradeService> = {};
  private cacheReady = false;
  private refreshInterval: NodeJS.Timeout | null = null;
  private refreshing = false;
  private recentlyRemovedOrderIds: Record<number, Record<string, number>> = {};
  private readonly REMOVE_TOMBSTONE_TTL_MS = 30000;
  private accountIdxToIdMap: Record<number, string> = {};
  private skipMergeOnce = false;

  constructor(_config: OrdersCacheConfig) {}

  private async getService(acc: ExchangeAccount, idx: number): Promise<OKXTradeService | BinanceSdkTradeService> {
    if (!this.services[idx]) {
      const exchange = String(acc.exchange || "").toUpperCase();
      if (exchange === Exchange.BINANCE) {
        const { BinanceSdkTradeService } = await import("./binanceSdkTradeService.ts");
        this.services[idx] = new BinanceSdkTradeService({
          apiKey: acc.apiKey,
          secretKey: acc.secretKey,
          accountIdx: idx,
          accountName: acc.name,
        });
      } else {
        this.services[idx] = new OKXTradeService({
          apiKey: acc.apiKey,
          secretKey: acc.secretKey,
          passphrase: acc.passphrase,
          accountIdx: idx,
          accountId: acc.id,
          accountName: acc.name,
        });
      }
    }
    return this.services[idx];
  }

  get(accountIdx: number): OrdersCache {
    return this.cache[accountIdx] || { data: [], timestamp: 0 };
  }

  getAll(): AccountOrder[] {
    const serviceKeys = Object.keys(this.services || {}).map(Number);
    const allOrders: AccountOrder[] = [];

    if (Object.keys(this.accountIdxToIdMap).length === 0) {
      try {
        const configData = loadSavedConfig();
        const accounts = configData.accounts || [];
        accounts.forEach((acc, idx) => {
          if (acc?.id) {
            this.accountIdxToIdMap[idx] = acc.id;
          }
        });
      } catch (e) {
        console.error('Failed to pre-populate accountIdxToIdMap in getAll():', e);
      }
    }

    const indices = serviceKeys.length > 0 ? serviceKeys : Object.keys(this.cache).map(Number);
    for (const idx of indices) {
      const cache = this.cache[idx];
      if (!cache) continue;
      const accountId = this.accountIdxToIdMap[idx];
      for (const order of cache.data) {
        if (accountId && !(order as AccountOrder & { _accountId?: string })._accountId) {
          (order as AccountOrder & { _accountId?: string })._accountId = accountId;
        }
        allOrders.push(order);
      }
    }

    return allOrders;
  }

  private markRemovedOrder(accountIdx: number, orderId: string): void {
    if (!orderId) return;
    if (!this.recentlyRemovedOrderIds[accountIdx]) {
      this.recentlyRemovedOrderIds[accountIdx] = {};
    }
    this.recentlyRemovedOrderIds[accountIdx][orderId] = Date.now() + this.REMOVE_TOMBSTONE_TTL_MS;
  }

  private isRecentlyRemoved(accountIdx: number, orderId: string): boolean {
    if (!orderId) return false;
    const expiresAt = this.recentlyRemovedOrderIds[accountIdx]?.[orderId];
    if (!expiresAt) return false;
    if (expiresAt < Date.now()) {
      delete this.recentlyRemovedOrderIds[accountIdx][orderId];
      return false;
    }
    return true;
  }

  private cleanupRemovedOrderTombstones(accountIdx: number): void {
    const bucket = this.recentlyRemovedOrderIds[accountIdx];
    if (!bucket) return;
    const now = Date.now();
    Object.keys(bucket).forEach((id) => {
      if (bucket[id] < now) {
        delete bucket[id];
      }
    });
  }

  updateOrder(accountIdx: number, order: AccountOrder): void {
    if (!this.cache[accountIdx]) {
      this.cache[accountIdx] = { data: [], timestamp: Date.now() };
    }
    
    const orders = this.cache[accountIdx].data;
    const ordId = order.algoId || order.ordId;
    if (!ordId) return;
    this.cleanupRemovedOrderTombstones(accountIdx);
    if (this.isRecentlyRemoved(accountIdx, ordId)) {
      return;
    }
    const index = orders.findIndex(o => (o.algoId || o.ordId) === ordId);
    
    if (index > -1) {
      orders[index] = { ...orders[index], ...order } as AccountOrder;
    } else {
      orders.push(order);
    }
    this.cache[accountIdx].timestamp = Date.now();
  }

  removeOrder(accountIdx: number, ordId: string): void {
    if (!ordId) return;
    this.markRemovedOrder(accountIdx, ordId);
    if (!this.cache[accountIdx]) return;

    const orders = this.cache[accountIdx].data;
    const initialLen = orders.length;
    this.cache[accountIdx].data = orders.filter(o => {
      const algoId = o.algoId;
      const rawOrdId = o.ordId;
      return algoId !== ordId && rawOrdId !== ordId;
    });

    if (initialLen !== this.cache[accountIdx].data.length) {
      this.cache[accountIdx].timestamp = Date.now();
    }
  }

  setAccountOrders(accountIdx: number, orders: AccountOrder[], timestamp?: number): void {
    if (!this.cache[accountIdx]) this.cache[accountIdx] = { data: [], timestamp: 0 };
    this.cache[accountIdx].data = orders;
    this.cache[accountIdx].timestamp = timestamp ?? Date.now();
  }

  broadcastSyncSignal(): void {
    const wsManager = OKXWebSocketManager.instance;
    if (!wsManager) return;

    const counts: Record<number, number> = {};
    Object.keys(this.cache).forEach(idx => {
      counts[Number(idx)] = this.cache[Number(idx)].data.length;
    });

    wsManager.broadcast({
      type: 'order_sync',
      counts,
      timestamp: Date.now()
    });
  }

  isReady(): boolean {
    return this.cacheReady;
  }

  async waitForReady(): Promise<void> {
    if (this.cacheReady) return;

    const waitStart = Date.now();
    while (!this.cacheReady && Date.now() - waitStart < 10000) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  async preload(): Promise<void> {
    const PRELOAD_TIMEOUT_MS = 60000;
    
    const MAX_RETRIES = 3;
    let retryCount = 0;
    let lastError: Error | null = null;
    const refresh = async () => {
      await this.refreshSingleRound({
        newCache: {},
        logKey: 'ordersCache.refreshFailed',
        filterRecentlyRemoved: true,
        applyRaceProtection: true,
      });
      this.cacheReady = true;
    };

    while (retryCount <= MAX_RETRIES) {
      try {
        await Promise.race([
          refresh(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`订单缓存预热总超时 (${PRELOAD_TIMEOUT_MS}ms)`)), PRELOAD_TIMEOUT_MS)
          ),
        ]);
        break;
      } catch (e) {
        lastError = e as Error;
        retryCount++;
        
        if (retryCount <= MAX_RETRIES) {
          const delayMs = Math.pow(2, retryCount - 1) * 1000;
          LogService.logKey("system", 'system.bootstrap.cachePreloadRetry', { retryCount, delayMs, msg: lastError.message }, 'warn');
          await new Promise(r => setTimeout(r, delayMs));
        } else {
          LogService.logKey("system", 'system.bootstrap.cachePreloadExhausted', { max: MAX_RETRIES, msg: lastError.message }, 'error');
          this.cacheReady = true;
        }
      }
    }
    
    this.refreshInterval = setInterval(refresh, 10000);
  }

  private async refreshSingleRound(options: {
    newCache: Record<number, OrdersCache>;
    logKey: string;
    filterRecentlyRemoved: boolean;
    applyRaceProtection: boolean;
  }): Promise<void> {
    const config = loadSavedConfig();
    const accounts = config.accounts || [];
    const now = Date.now();
    const newCache = options.newCache;

    const MAX_CONCURRENT_ACCOUNTS = 2;
    const accountPromises: Promise<void>[] = [];
    let currentBatch: Promise<void>[] = [];

    for (let idx = 0; idx < accounts.length; idx++) {
      const acc = accounts[idx];
      const exchange = String(acc.exchange || "").toUpperCase();
      const isBinance = exchange === Exchange.BINANCE;
      const isPermanentlyStopped = OKXWebSocketManager.instance?.isPermanentlyStopped(idx);
      const isMonitorStopped = AccountMonitor.getInstance().isAccountStopped(idx);

      const hasCredentials = isBinance
        ? (acc && acc.apiKey && acc.secretKey && !isPermanentlyStopped && !isMonitorStopped)
        : (acc && acc.apiKey && acc.secretKey && acc.passphrase && !isPermanentlyStopped && !isMonitorStopped);

      if (hasCredentials) {
        const ACCOUNT_TIMEOUT_MS = 30000;
        const accountTask = (async () => {
          try {
            const orders = await Promise.race([
              this.getPendingOrders(idx, acc),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`账户 ${idx} 订单查询超时 (${ACCOUNT_TIMEOUT_MS}ms)`)), ACCOUNT_TIMEOUT_MS)
              ),
            ]);
            newCache[idx] = { data: orders, timestamp: now };
          } catch (e: unknown) {
            const error = e instanceof Error ? e : new Error(String(e));
            LogService.logKey("SYSTEM", options.logKey, { accountIdx: idx, msg: error.message }, 'error');
            ErrorMonitor.captureError(error, ErrorLevel.MEDIUM, ErrorCategory.SYSTEM);
            if (this.cache[idx]) {
              newCache[idx] = this.cache[idx];
            } else {
              newCache[idx] = { data: [], timestamp: now };
            }
          }
        })();

        currentBatch.push(accountTask);

        if (currentBatch.length >= MAX_CONCURRENT_ACCOUNTS) {
          accountPromises.push(Promise.all(currentBatch).then(() => {}));
          currentBatch = [];
        }
      }
    }

    if (currentBatch.length > 0) {
      accountPromises.push(Promise.all(currentBatch).then(() => {}));
    }

    for (const batchPromise of accountPromises) {
      await batchPromise;
    }

    if (this.skipMergeOnce) {
      this.skipMergeOnce = false;
    } else {
    Object.keys(newCache).forEach(idx => {
      const numIdx = Number(idx);
      this.cleanupRemovedOrderTombstones(numIdx);
      const existingData = this.cache[numIdx]?.data || [];
      const apiOrders = newCache[numIdx].data;

      const liveApiOrders = options.filterRecentlyRemoved
        ? apiOrders.filter(o => {
            const stateOk = LIVE_STATES.has(String(o.state || '').toLowerCase());
            if (!stateOk) return false;
            const id = o.algoId || o.ordId;
            if (id && this.isRecentlyRemoved(numIdx, id)) {
              return false;
            }
            return true;
          })
        : apiOrders.filter(o => LIVE_STATES.has(String(o.state || '').toLowerCase()));

      const apiIds = new Set(liveApiOrders.map(o => o.algoId || o.ordId));

      existingData.forEach(o => {
        const id = o.algoId || o.ordId;
        if (id &&
            (o as AccountOrder & { exchange?: string }).exchange === 'BINANCE' &&
            !apiIds.has(id) &&
            !this.isRecentlyRemoved(numIdx, id) &&
            LIVE_STATES.has(String(o.state || '').toLowerCase())) {
          this.markRemovedOrder(numIdx, id);
        }
      });

      const extraFromWs = existingData.filter(o => {
        const id = o.algoId || o.ordId;
        return id &&
          !apiIds.has(id) &&
          !this.isRecentlyRemoved(numIdx, id) &&
          LIVE_STATES.has(String(o.state || '').toLowerCase());
      });

      newCache[numIdx].data = [...liveApiOrders, ...extraFromWs];
    });
    }

    if (options.applyRaceProtection) {
      Object.keys(newCache).forEach(idx => {
        const numIdx = Number(idx);
        const existing = this.cache[numIdx];
        if (existing && existing.timestamp > now) {
          newCache[numIdx] = existing;
        }
      });
    }

    this.cache = newCache;

    this.broadcastSyncSignal();
  }

  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.services = {};
  }

  reset(): void {
    this.stop();
    this.cache = {};
    this.cacheReady = false;
    this.accountIdxToIdMap = {};
    this.recentlyRemovedOrderIds = {};
    this.skipMergeOnce = true;
    void this.preload();
  }

  private async getPendingOrders(accountIdx: number, acc: ExchangeAccount): Promise<AccountOrder[]> {
    const service = await this.getService(acc, accountIdx);
    const exchange = String(acc.exchange || "").toUpperCase();
    const isBinance = exchange === Exchange.BINANCE;

    let results: AccountOrder[] = [];

    try {
      if (isBinance) {
        const binanceService = service as BinanceSdkTradeService;
        const [spotFuturesOrders, marginOrders] = await Promise.all([
          binanceService.getOpenOrders(),
          binanceService.getMarginOpenOrders()
        ]);

        if (spotFuturesOrders && spotFuturesOrders.length > 0) {
          spotFuturesOrders.forEach((o) => {
            (o as AccountOrder & { _account: number })._account = accountIdx;
            o.state = o.state || 'live';
            results.push(AccountMonitor.transformOrder(o) as AccountOrder);
          });
        }

        if (marginOrders && marginOrders.length > 0) {
          marginOrders.forEach((o) => {
            (o as AccountOrder & { _account: number })._account = accountIdx;
            o.state = o.state || 'live';
            results.push(AccountMonitor.transformOrder(o) as AccountOrder);
          });
        }

        results = AccountMonitor.mergeBinanceOtoOrders(results);

        const seen = new Set<string>();
        results = results.filter((o) => {
          const id = o.algoId || o.ordId || '';
          if (!id) return true;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });

      } else {
        const regular: AccountOrder[] = [];
        const instTypes = ['SWAP', 'SPOT', 'MARGIN', 'FUTURES', 'OPTION'];
        
        const regularPromises = instTypes.map(async (type) => {
          const typeOrders = await service.fetchAllPagesForOrders(type === 'SWAP' ? undefined : type);
          return typeOrders || [];
        });

        const regularOrderBatches = await Promise.all(regularPromises);
        regularOrderBatches.forEach(typeOrders => {
          if (typeOrders && typeOrders.length > 0) {
            typeOrders.forEach((o) => {
              (o as AccountOrder & { _account: number })._account = accountIdx;
              o.state = o.state || 'live';
              regular.push(o as AccountOrder);
            });
          }
        });

        results.push(...regular.map(o => AccountMonitor.transformOrder(o) as AccountOrder));

        const algoTypes = ['conditional', 'oco', 'chase', 'trigger', 'move_order_stop', 'iceberg', 'twap', 'trailing_stop'];
        const algoPromises = algoTypes.map(type => service.fetchAllPagesForAlgoType(type));
        const algoOrderBatches = await Promise.all(algoPromises);
        
        algoOrderBatches.forEach((orders) => {
          if (orders && orders.length > 0) {
            orders.forEach((o) => {
              (o as AccountOrder & { _account: number })._account = accountIdx;
              o.state = o.state || 'effective';
              if (!o.ordId && o.algoId) o.ordId = o.algoId;
              results.push(AccountMonitor.transformOrder(o) as AccountOrder);
            });
          }
        });
      }
    } catch (e) {
      const err = e as Error;
      const label = acc.name || ('#' + accountIdx);
      LogService.logKey("system", 'account.orders.failed', { exchange, label, msg: err.message }, 'error');
    }

    return results;
  }

  async refreshNow(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await this.refreshSingleRound({
        newCache: { ...this.cache },
        logKey: 'ordersCache.refreshNowFailed',
        filterRecentlyRemoved: false,
        applyRaceProtection: false,
      });
    } finally {
      this.refreshing = false;
    }
  }
}
