
import crypto from "crypto";
import https from "https";
import { LogService } from "./logService.ts";
import { ErrorMonitor } from "./errorMonitor.ts";

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 15000,
  scheduling: 'fifo'
});

const errorDedupe = new Map<string, number>();
function shouldLogError(key: string, ttlMs = 10000): boolean {
  const last = errorDedupe.get(key);
  const now = Date.now();
  if (last && now - last < ttlMs) return false;
  errorDedupe.set(key, now);
  if (errorDedupe.size > 200) {
    const cutoff = now - ttlMs * 3;
    for (const [k, v] of errorDedupe) {
      if (v < cutoff) errorDedupe.delete(k);
    }
  }
  return true;
}

const dnsCooldownMap = new Map<string, number>();
const DNS_COOLDOWN_MS = 20000;
function shouldSuppressDnsError(errMsg: string, accountLabel: string): boolean {
  if (!errMsg.includes('ENOENT')) return false;
  const now = Date.now();
  const last = dnsCooldownMap.get(accountLabel) || 0;
  if (now - last < DNS_COOLDOWN_MS) return true;
  dnsCooldownMap.set(accountLabel, now);
  return false;
}

function isTransientNetworkError(errMsg: string): boolean {
  return errMsg.includes('Client network socket disconnected') ||
    errMsg.includes('ECONNRESET') ||
    errMsg.includes('ETIMEDOUT') ||
    errMsg.includes('Request timeout');
}

import {
  OKXRequestOptions,
  OKXApiResponse,
  OKXTimeResponse,
  OKXTickerResponse,
  OKXOrder,
  OKXAlgoOrder,
  OKXPositionsResponse,
  OKXPositionHistory,
  OKXPositionsHistoryResponse,
  OKXSavingsBalanceResponse,
  OKXAssetValuationResponse,
  CancelOrderParams,
  PlaceAlgoOrderParams,
  PlaceOrderParams,
  AmendOrderParams,
  TransferAssetParams
} from "../types/okx.ts";

export interface OKXConfig {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  accountIdx: number;
  accountId?: string;
  accountName?: string;
}

export class OKXTradeService {
  public readonly exchangeType = "OKX";
  private config: OKXConfig;
  private baseUrl = "https://www.okx.com";
  private timeOffset = 0;
  private lastSyncTime = 0;
  private syncFailedCount = 0;

  private static readonly SL_AS_MARKET_ORDER_TYPES = ['market', 'limit', 'post_only', 'fok', 'ioc', 'conditional', 'trigger'];

  private translateError(msg: string): string {
    const map: Record<string, string> = {
      'System error. Try again later.': '系统错误，请稍后重试',
      'Timestamp request expired': '请求时间戳已过期',
      'Timestamp for this request is outside of the recvWindow': '请求时间戳超出接收窗口',
      'Invalid API key': 'API Key 无效',
      'Invalid sign': '签名验证失败',
      'PASSPHRASE incorrect': 'Passphrase 不正确',
      'Login is expired': '登录已过期',
      'Rate limit reached': '请求频率超限',
      'System error': '系统错误',
      'Parameter error': '参数错误',
      'Order does not exist': '订单不存在',
      'Insufficient balance': '余额不足',
      'Request timeout after 10s': '请求超时 (10秒)',
    };
    for (const [en, zh] of Object.entries(map)) {
      if (msg.includes(en)) return msg.replace(en, zh);
    }
    return msg;
  }

  get accountIdx(): number {
    return this.config.accountIdx;
  }

  get accountId(): string {
    return this.config.accountId || '';
  }

  private accountLabel(): string {
    return this.config.accountName || ('#' + this.config.accountIdx);
  }

  constructor(config: OKXConfig) {
    this.config = config;
    const wsManager = globalThis.OKX_WS_MANAGER;
    if (wsManager && typeof wsManager.getGlobalTimeOffset === 'function') {
      const offset = wsManager.getGlobalTimeOffset();
      if (offset !== 0) {
        this.timeOffset = offset;
        this.lastSyncTime = Date.now();
      }
    }
  }

  async syncTime(force = false) {
    const now = Date.now();
    const cooldown = this.syncFailedCount > 2 ? 5000 : 30000;
    
    const wsManager = globalThis.OKX_WS_MANAGER;
    const globalOffset = wsManager && typeof wsManager.getGlobalTimeOffset === 'function' ? wsManager.getGlobalTimeOffset() : 0;
    
    if (!force && this.timeOffset !== 0 && now - this.lastSyncTime < cooldown) {
      return;
    }
    
    if (globalOffset !== 0) {
      this.timeOffset = globalOffset;
      this.lastSyncTime = Date.now();
      return;
    }
    try {
      const res = await Promise.race([
        new Promise<OKXTimeResponse>((resolve, reject) => {
          https.get(`${this.baseUrl}/api/v5/public/time`, { agent: httpsAgent }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(e);
              }
            });
          }).on("error", reject);
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Time sync timeout")), 2000)
        )
      ]);
      if (res.code === "0" && res.data?.[0]?.ts) {
        const serverTime = parseInt(res.data[0].ts);
        const localTime = Date.now();
        this.timeOffset = serverTime - localTime;
        this.lastSyncTime = Date.now();
        if (this.syncFailedCount > 0) {
          LogService.logKey("system", 'system.time.syncRecovered', { count: this.syncFailedCount }, 'info');
          this.syncFailedCount = 0;
        }
      }
    } catch (e: unknown) {
      const error = e as Error;
      this.syncFailedCount++;
      if (this.syncFailedCount === 1 || this.syncFailedCount % 5 === 0) {
        LogService.logKey("system", 'system.time.syncFailed', { count: this.syncFailedCount, msg: error.message || String(e), retryAfter: this.syncFailedCount > 2 ? 5 : 30 }, 'warn');
      }
    }
  }

  private getTimestamp(): string {
    let safetyMargin = 200;
    if (this.syncFailedCount > 2) {
      safetyMargin = Math.min(200 + this.syncFailedCount * 500, 5000);
    }
    const now = new Date(Date.now() + this.timeOffset - safetyMargin);
    return now.toISOString();
  }

  private sign(timestamp: string, method: string, requestPath: string, body = "") {
    const message = timestamp + method + requestPath + body;
    return crypto
      .createHmac("sha256", this.config.secretKey)
      .update(message)
      .digest("base64");
  }

  private async request<T = OKXApiResponse>(options: OKXRequestOptions): Promise<T> {
    try {
      return await this.requestOnce<T>(options);
    } catch (e) {
      const err = e as Error & { okxCode?: string };
      if (err?.okxCode !== '50113') throw e;

      const maxRetries = 3;
      let lastErr: Error | null = null;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          await this.syncTime(true);
          const delay = Math.min(200 * (attempt + 1) + attempt * 300, 1500);
          await new Promise(resolve => setTimeout(resolve, delay));
          const retried = await this.requestOnce<T>(options);
          if (attempt > 0) {
            LogService.info("system", `[OKX] 账户 ${this.accountLabel()} 时间戳过期，第 ${attempt + 1} 次重试成功`);
          }
          return retried;
        } catch (retryErr) {
          lastErr = retryErr as Error;
        }
      }
      const retryMsg = lastErr?.message || String(lastErr);
      LogService.warn("system", `[OKX] 账户 ${this.accountLabel()} 时间戳过期，重试 ${maxRetries} 次均失败: ${this.translateError(retryMsg)}（可能网络不稳定或VPN切换中）`);
      throw lastErr;
    }
  }

  private async requestOnce<T = OKXApiResponse>(options: OKXRequestOptions): Promise<T> {
    return new Promise((resolve, reject) => {
      const timestamp = this.getTimestamp();
      const bodyStr = options.body ? JSON.stringify(options.body) : "";

      const requestOptions: https.RequestOptions = {
        hostname: "www.okx.com",
        port: 443,
        path: options.path,
        method: options.method,
        agent: httpsAgent,
        headers: {
          "OK-ACCESS-KEY": this.config.apiKey,
          "OK-ACCESS-SIGN": this.sign(timestamp, options.method, options.path, bodyStr),
          "OK-ACCESS-TIMESTAMP": timestamp,
          "OK-ACCESS-PASSPHRASE": this.config.passphrase,
          "Content-Type": "application/json",
        },
      };

      const req = https.request(requestOptions, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", async () => {
          try {
            const parsedData = JSON.parse(data);
            
            if (parsedData.code === "50111" || (parsedData.msg && parsedData.msg.includes("PASSPHRASE incorrect"))) {
              const dedupKey = `auth_failed:${this.config.accountIdx}`;
              const _globalDedup = (globalThis as unknown as Record<string, unknown>).__AUTH_FAILED_DEDUP__ as Map<string, number> | undefined
                || ((globalThis as unknown as Record<string, unknown>).__AUTH_FAILED_DEDUP__ = new Map<string, number>()) as Map<string, number>;
              const now = Date.now();
              const last = _globalDedup.get(dedupKey);
              if (!last || (now - last) > 60000) {
                _globalDedup.set(dedupKey, now);
                const pass = this.config.passphrase || "";
                const isProd = process.env.NODE_ENV === "production";
                const passInfo = pass.length > 0 
                  ? (isProd ? `${pass.length}位` : `${pass.length}位 (${pass[0]}...${pass[pass.length-1]})`)
                  : "为空";
                LogService.logKey("system", 'account.auth.failed', { exchange: 'OKX', label: this.accountLabel(), passInfo }, 'error');
              }
            }

            if (parsedData.code === "50113") {
              try {
                const serverDate = res.headers['date'];
                if (serverDate) {
                  const serverTimeMs = new Date(serverDate).getTime();
                  if (!isNaN(serverTimeMs)) {
                    const estimatedOffset = serverTimeMs - Date.now();
                    this.timeOffset = estimatedOffset;
                    this.lastSyncTime = Date.now();
                    LogService.info("system", `[OKX] 账户 ${this.accountLabel()} 从响应 Header 校准时间偏移: ${estimatedOffset}ms`);
                  }
                }
              } catch {
              }

              const tsErr = new Error(`OKX 50113: Timestamp request expired (${this.accountLabel()})`) as Error & { okxCode?: string };
              tsErr.okxCode = '50113';
              reject(tsErr);
              return;
            }

            resolve(parsedData);
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.setTimeout(10000, () => {
        req.destroy(new Error('Request timeout after 10s'));
      });

      req.on("error", (e) => {
        const errMsg = (e as Error).message || String(e);
        if (
          errMsg.includes('Client network socket disconnected') ||
          errMsg.includes('ECONNRESET') ||
          errMsg.includes('ETIMEDOUT') ||
          errMsg.includes('Request timeout after 10s') ||
          errMsg.includes('ENOENT')
        ) {
          reject(e);
          return;
        }
        const errKey = `${this.accountLabel()}:${options.path}:${errMsg}`;
        if (shouldLogError(errKey)) {
          ErrorMonitor.captureNetworkError(
            e as Error,
            {
              accountIdx: this.config.accountIdx,
              path: options.path,
              method: options.method
            },
            'okxTradeService'
          );
        }
        reject(e);
      });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  async getMarketPrice(instId: string): Promise<number | null> {
    try {
      const data = await this.request<OKXTickerResponse>({ method: "GET", path: `/api/v5/market/ticker?instId=${instId}` });
      if (data.code === "0" && data.data?.[0]?.last) {
        return parseFloat(data.data[0].last);
      }
    } catch (e: unknown) {
      const error = e as Error;
      if (!(error.message || String(e)).includes('Client network socket disconnected')) {
        LogService.logKey("system", 'account.market.failed', { exchange: 'OKX', instId, msg: error.message || String(e) }, 'error');
      }
    }
    return null;
  }

  private getInstType(instId?: string): string {
    if (!instId) return "SWAP";
    if (instId.endsWith("-SWAP")) return "SWAP";
    const parts = instId.split("-");
    if (parts.length === 3 && /^\d{6}$/.test(parts[2])) return "FUTURES";
    if (parts.length === 2) return "SPOT";
    return "SWAP";
  }

  async getPendingAlgoOrders(instId?: string, ordType: string = "trigger", instType?: string, after?: string): Promise<OKXAlgoOrder[]> {
    try {
      let path = `/api/v5/trade/orders-algo-pending?state=live,effective,partially_effective&ordType=${ordType}`;
      if (instType) {
        path += `&instType=${instType}`;
      }
      if (instId && !["SPOT", "SWAP", "FUTURES", "MARGIN"].includes(instId)) {
        path += `&instId=${instId}`;
      }
      if (after) {
        path += `&after=${after}`;
      }
      const data = await this.request<OKXApiResponse<OKXAlgoOrder>>({ method: "GET", path });
      if (data.code === "0" && Array.isArray(data.data)) {
        return data.data;
      }
    } catch (e: unknown) {
      const error = e as Error;
      const errMsg = error.message || String(e);
      if (isTransientNetworkError(errMsg)) {
        return [];
      }
      const errKey = `getPendingAlgoOrders:${this.accountLabel()}:${errMsg}`;
      if (!shouldSuppressDnsError(errMsg, this.accountLabel()) && shouldLogError(errKey)) {
        LogService.logKey("system", 'account.tpsl.failed', { exchange: 'OKX', label: this.accountLabel(), msg: this.translateError(errMsg) }, 'error');
      }
    }
    return [];
  }

  async fetchAllPagesForAlgoType(algoType: string, instType?: string): Promise<OKXAlgoOrder[]> {
    let allOrders: OKXAlgoOrder[] = [];
    let after: string | undefined = undefined;

    while (true) {
      const orders = await this.getPendingAlgoOrders(undefined, algoType, instType, after);
      if (!orders || orders.length === 0) break;

      allOrders.push(...orders);

      if (orders.length < 100) break;

      after = orders[orders.length - 1].algoId;
    }

    return allOrders;
  }

  async getPendingOrders(instId?: string, instType?: string, after?: string): Promise<OKXOrder[]> {
    try {
      const actualInstType = instType || this.getInstType(instId);
      let path = `/api/v5/trade/orders-pending?instType=${actualInstType}`;
      if (instId && instId !== "SPOT" && instId !== "SWAP" && instId !== "FUTURES") path += `&instId=${instId}`;
      if (after) {
        path += `&after=${after}`;
      }
      const data = await this.request<OKXApiResponse<OKXOrder>>({ method: "GET", path });
      if (data.code === "0" && Array.isArray(data.data)) {
        return data.data;
      } else {
        const msg = data.msg || '';
        if (msg.includes('Parameter instType error') && actualInstType === 'OPTION') {
          return [];
        }
        if (shouldLogError(`getPendingOrders:${this.accountLabel()}:${data.msg}`)) {
          LogService.logKey("system", 'account.orders.failed', { exchange: 'OKX', label: this.accountLabel(), msg: this.translateError(data.msg || JSON.stringify(data)) }, 'error');
        }
      }
    } catch (e: unknown) {
      const error = e as Error;
      const errMsg = error.message || String(e);
      if (isTransientNetworkError(errMsg)) {
        return [];
      }
      const errKey = `getPendingOrders:${this.accountLabel()}:${errMsg}`;
      if (!shouldSuppressDnsError(errMsg, this.accountLabel()) && shouldLogError(errKey)) {
        LogService.logKey("system", 'account.orders.failed', { exchange: 'OKX', label: this.accountLabel(), msg: `网络: ${this.translateError(errMsg)}` }, 'error');
      }
    }
    return [];
  }

  async getOpenOrders(instId?: string): Promise<OKXOrder[]> {
    return this.getPendingOrders(instId);
  }

  async getHistoryOrders(instType?: string, instId?: string, after?: string, limit?: number): Promise<OKXOrder[]> {
    const allOrders: OKXOrder[] = [];
    let afterCursor: string | undefined = after;
    const pageSize = limit || 100;
    const MAX_PAGES = 1;
    for (let page = 0; page < MAX_PAGES; page++) {
      try {
        const actualInstType = instType || 'SWAP';
        let path = `/api/v5/trade/orders-history-archive?instType=${actualInstType}&limit=${pageSize}`;
        if (instId) path += `&instId=${encodeURIComponent(instId)}`;
        if (afterCursor) path += `&after=${encodeURIComponent(afterCursor)}`;

        const data = await this.request<OKXApiResponse<OKXOrder>>({ method: 'GET', path });
        if (data.code === '0' && Array.isArray(data.data)) {
          if (data.data.length > 0) {
            allOrders.push(...data.data);
            if (data.data.length < pageSize) break;
            afterCursor = data.data[data.data.length - 1].ordId;
          } else {
            break;
          }
        } else {
          const rawMsg = data.msg || '';
          if (rawMsg.includes('Rate limit reached') || rawMsg.includes('Too Many Requests')) {
            break;
          }
          if (shouldLogError(`getHistoryOrders:${this.accountLabel()}:${rawMsg}`)) {
            LogService.logKey('system', 'account.orders.failed', {
              exchange: 'OKX',
              label: this.accountLabel(),
              msg: this.translateError(rawMsg || JSON.stringify(data)),
            }, 'error');
          }
          break;
        }
      } catch (e: unknown) {
        const error = e as Error;
        const errMsg = error.message || String(e);
        if (isTransientNetworkError(errMsg)) {
          break;
        }
        const errKey = `getHistoryOrders:${this.accountLabel()}:${errMsg}`;
        if (!shouldSuppressDnsError(errMsg, this.accountLabel()) && shouldLogError(errKey)) {
          LogService.logKey('system', 'account.orders.failed', {
            exchange: 'OKX',
            label: this.accountLabel(),
            msg: `网络: ${this.translateError(errMsg)}`,
          }, 'error');
        }
        break;
      }
    }
    return allOrders;
  }

  async getHistoryAlgoOrders(instType?: string, instId?: string, after?: string, limit?: number): Promise<OKXAlgoOrder[]> {
    const actualInstType = instType || 'SWAP';
    const algoTypes = ['conditional', 'oco', 'trigger', 'move_order_stop', 'chase'];
    const states = 'effective,canceled,order_failed';
    const pageSize = limit || 100;

    const results = await Promise.all(
      algoTypes.map(async (ordType): Promise<OKXAlgoOrder[]> => {
        let path = `/api/v5/trade/orders-algo-history?instType=${actualInstType}&ordType=${ordType}&state=${states}&limit=${pageSize}`;
        if (instId) path += `&instId=${instId}`;
        if (after) path += `&after=${encodeURIComponent(after)}`;
        try {
          const data = await this.request<OKXApiResponse<OKXAlgoOrder>>({ method: 'GET', path });
          const rawMsg = data?.msg || '';
          if (data.code !== '0' && (rawMsg.includes('Rate limit reached') || rawMsg.includes('Too Many Requests'))) {
            return [];
          }
          if (data.code === '0' && Array.isArray(data.data)) {
            return data.data;
          }
          if (data.code !== '0') {
            LogService.info('system', `算法历史订单查询(${ordType})返回非0: code=${data.code} msg=${data.msg}`);
          }
          return [];
        } catch (e: unknown) {
          const error = e as Error;
          const errMsg = error.message || String(e);
          if (!isTransientNetworkError(errMsg)) {
            const errKey = `getHistoryAlgoOrders:${ordType}:${this.accountLabel()}:${errMsg}`;
            if (!shouldSuppressDnsError(errMsg, this.accountLabel()) && shouldLogError(errKey)) {
              LogService.logKey('system', 'account.orders.failed', {
                exchange: 'OKX',
                label: this.accountLabel(),
                msg: `网络(${ordType}): ${this.translateError(errMsg)}`,
              }, 'error');
            }
          }
          return [];
        }
      })
    );

    const allResults: OKXAlgoOrder[] = [];
    for (const arr of results) {
      allResults.push(...arr);
    }
    return allResults;
  }

  async fetchAllPagesForOrders(instType?: string): Promise<OKXOrder[]> {
    let allOrders: OKXOrder[] = [];
    let after: string | undefined = undefined;
    
    while (true) {
      const orders = await this.getPendingOrders(undefined, instType, after);
      if (!orders || orders.length === 0) break;
      
      allOrders.push(...orders);
      
      if (orders.length < 100) break;
      
      after = orders[orders.length - 1].ordId;
    }
    
    return allOrders;
  }

  async getAccountBalance(ccy: string = "USDT"): Promise<OKXApiResponse['data'] | null> {
    try {
      const data = await this.request<OKXApiResponse>({ method: "GET", path: `/api/v5/account/balance?ccy=${ccy}` });
      if (data.code === "0" && data.data?.[0]) {
        return data.data[0];
      } else {
        const translated = this.translateError(data.msg || '');
        LogService.logKey("system", 'account.balance.failed', { exchange: 'OKX', label: this.accountLabel(), msg: translated }, 'error');
      }
    } catch (e: unknown) {
      const error = e as Error;
      const errMsg = error.message || String(e);
      if (!isTransientNetworkError(errMsg)) {
        const errKey = `getAccountBalance:${this.accountLabel()}:${errMsg}`;
        const translated = this.translateError(errMsg);
        if (!shouldSuppressDnsError(errMsg, this.accountLabel()) && shouldLogError(errKey)) {
          LogService.logKey("system", 'account.balance.failed', { exchange: 'OKX', label: this.accountLabel(), msg: `网络: ${translated}` }, 'error');
        }
      }
    }
    return null;
  }

  async getSavingsBalance(ccy: string = "USDT"): Promise<string | null> {
    try {
      const data = await this.request<OKXSavingsBalanceResponse>({ method: "GET", path: `/api/v5/finance/savings/balance?ccy=${ccy}` });
      if (data.code === "0" && data.data?.[0]) {
        return data.data[0].amt || "0";
      }
    } catch (e: unknown) {
      const error = e as Error;
      const errMsg = error.message || String(e);
      if (!isTransientNetworkError(errMsg) && !shouldSuppressDnsError(errMsg, this.accountLabel())) {
        LogService.logKey("system", 'account.savings.failed', { exchange: 'OKX', label: this.accountLabel(), msg: `网络: ${errMsg}` }, 'error');
      }
    }
    return null;
  }

  async getAssetValuation(ccy: string = "USDT"): Promise<OKXAssetValuationResponse['data'] extends (infer U)[] ? U : never | null> {
    try {
      const data = await this.request<OKXAssetValuationResponse>({ method: "GET", path: `/api/v5/asset/asset-valuation?ccy=${ccy}` });
      if (data.code === "0" && data.data?.[0]) {
        return data.data[0];
      }
    } catch (e: unknown) {
      const error = e as Error;
      const errMsg = error.message || String(e);
      if (!isTransientNetworkError(errMsg) && !shouldSuppressDnsError(errMsg, this.accountLabel())) {
        LogService.logKey("system", 'account.valuation.failed', { exchange: 'OKX', label: this.accountLabel(), msg: `网络: ${errMsg}` }, 'error');
      }
    }
    return null;
  }

  async cancelBatchAlgoOrders(params: { instId: string, algoId: string }[]): Promise<OKXApiResponse> {
    return this.request({ method: "POST", path: "/api/v5/trade/cancel-algos", body: params });
  }

  async cancelOrder(params: CancelOrderParams): Promise<OKXApiResponse> {
    return this.request({ method: "POST", path: "/api/v5/trade/cancel-order", body: params });
  }

  async placeAlgoOrder(params: PlaceAlgoOrderParams): Promise<OKXApiResponse> {
    const payload = { ...params } as Record<string, unknown>;
    if (payload.tdMode !== 'cash' && 'tgtCcy' in payload) {
      delete payload.tgtCcy;
    }
    return this.request({ method: "POST", path: "/api/v5/trade/order-algo", body: payload });
  }

  async placeBatchOrders(params: PlaceOrderParams[]): Promise<OKXApiResponse> {
    const payload = params.map(p => {
      const cloned = { ...p } as Record<string, unknown>;
      if (cloned.tdMode !== 'cash' && 'tgtCcy' in cloned) {
        delete cloned.tgtCcy;
      }
      return cloned;
    });
    return this.request({ method: "POST", path: "/api/v5/trade/batch-orders", body: payload });
  }

  async amendAlgoOrder(params: AmendOrderParams): Promise<OKXApiResponse> {
    const res = await this.request({ method: "POST", path: "/api/v5/trade/amend-algos", body: params });
    return res;
  }

  async amendBatchAlgoOrders(params: AmendOrderParams[]): Promise<OKXApiResponse> {
    return this.request({ method: "POST", path: "/api/v5/trade/amend-batch-algos", body: params });
  }

  async amendOrder(params: AmendOrderParams): Promise<OKXApiResponse> {
    return this.request({ method: "POST", path: "/api/v5/trade/amend-order", body: params });
  }

  async amendBatchOrders(params: AmendOrderParams[]): Promise<OKXApiResponse> {
    const res = await this.request({ method: "POST", path: "/api/v5/trade/amend-batch-orders", body: params });
    return res;
  }

  async cancelBatchOrders(params: { instId: string, ordId?: string, clOrdId?: string }[]): Promise<OKXApiResponse> {
    return this.request({ method: "POST", path: "/api/v5/trade/cancel-batch-orders", body: params });
  }

  async closePosition(params: { instId: string, mgnMode: string, posSide?: string, ccy?: string, autoCxl?: boolean }): Promise<OKXApiResponse> {
    return this.request({ method: "POST", path: "/api/v5/trade/close-position", body: params });
  }

  async setLeverage(params: { instId: string; lever: string; mgnMode: 'cross' | 'isolated'; posSide?: 'long' | 'short' }): Promise<OKXApiResponse> {
    return this.request({ method: "POST", path: "/api/v5/account/set-leverage", body: params });
  }

  async getPositions(instId?: string): Promise<OKXPositionsResponse['data'] | null> {
    try {
      const path = instId ? `/api/v5/account/positions?instId=${instId}` : "/api/v5/account/positions";
      const data = await this.request<OKXPositionsResponse>({ method: "GET", path });
      if (data.code === "0" && Array.isArray(data.data)) {
        return data.data;
      } else {
        LogService.logKey("system", 'account.positions.failed', { exchange: 'OKX', label: this.accountLabel(), msg: data.msg || JSON.stringify(data) }, 'error');
      }
    } catch (e: unknown) {
      const error = e as Error;
      const errMsg = error.message || String(e);
      if (!isTransientNetworkError(errMsg)) {
        const errKey = `getPositions:${this.accountLabel()}:${errMsg}`;
        if (!shouldSuppressDnsError(errMsg, this.accountLabel()) && shouldLogError(errKey)) {
          LogService.logKey("system", 'account.positions.failed', { exchange: 'OKX', label: this.accountLabel(), msg: `网络: ${this.translateError(errMsg)}` }, 'error');
        }
      }
    }
    return null;
  }

  async redeemSavings(ccy: string, amt: string): Promise<boolean> {
    try {
      const body = { ccy, amt, side: "redempt" };
      const data = await this.request({ method: "POST", path: "/api/v5/finance/savings/purchase-redempt", body });
      return data.code === "0";
    } catch (e: unknown) {
      const error = e as Error;
      if (!(error.message || String(e)).includes('Client network socket disconnected')) {
        LogService.logKey("system", 'account.redeem.failed', { exchange: 'OKX', label: this.accountLabel(), msg: error.message || String(e) }, 'error');
      }
      return false;
    }
  }

  async getHistoryPositions(instType?: string, instId?: string, limit?: number): Promise<OKXPositionHistory[]> {
    const allPositions: OKXPositionHistory[] = [];
    let after: string | undefined;
    const pageSize = limit || 100;
    const MAX_PAGES = 1;
    for (let page = 0; page < MAX_PAGES; page++) {
      try {
        const actualInstType = instType || 'SWAP';
        let path = `/api/v5/account/positions-history?instType=${actualInstType}&limit=${pageSize}`;
        if (instId) path += `&instId=${encodeURIComponent(instId)}`;
        if (after) path += `&after=${encodeURIComponent(after)}`;
        const data = await this.request<OKXPositionsHistoryResponse>({ method: 'GET', path });
        if (data.code === '0' && Array.isArray(data.data)) {
          if (data.data.length > 0) {
            allPositions.push(...data.data);
            if (data.data.length < pageSize) break;
            after = data.data[data.data.length - 1].uTime;
          } else {
            break;
          }
        } else {
          const rawMsg = data.msg || `code=${data.code}`;
          const msg = this.translateError(rawMsg);
          if (rawMsg.includes('Rate limit reached') || rawMsg.includes('Too Many Requests')) {
            break;
          }
          if (shouldLogError(`getHistoryPositions:${this.accountLabel()}:${msg}`)) {
            LogService.logKey('system', 'account.positionsHistory.failed', { exchange: 'OKX', label: this.accountLabel(), msg }, 'error');
          }
          break;
        }
      } catch (e: unknown) {
        const error = e as Error;
        const errMsg = error.message || String(e);
        if (!isTransientNetworkError(errMsg)) {
          const errKey = `getHistoryPositions:${this.accountLabel()}:${errMsg}`;
          if (!shouldSuppressDnsError(errMsg, this.accountLabel()) && shouldLogError(errKey)) {
            LogService.logKey('system', 'account.positionsHistory.failed', { exchange: 'OKX', label: this.accountLabel(), msg: this.translateError(errMsg) }, 'error');
          }
        }
        break;
      }
    }
    return allPositions;
  }

  async transferAsset(ccy: string, amt: string, from: string, to: string): Promise<boolean> {
    try {
      const body: TransferAssetParams = { ccy, amt, from, to };
      const data = await this.request<OKXApiResponse>({ method: "POST", path: "/api/v5/asset/transfer", body });
      return data.code === "0";
    } catch (e: unknown) {
      const error = e as Error;
      if (!(error.message || String(e)).includes('Client network socket disconnected')) {
        LogService.logKey("system", 'account.transfer.failed', { exchange: 'OKX', label: this.accountLabel(), msg: error.message || String(e) }, 'error');
      }
      return false;
    }
  }

  private mapToOKXPayload(request: ActionPlaceOrderParams): Record<string, unknown> {
    const isAlgo = ["trigger", "conditional", "oco", "chase", "move_order_stop"].includes(request.ordType);
    const instId = request.instId;
    const isSpot = !instId.endsWith("-SWAP") && !instId.endsWith("-FUTURES") && instId.split("-").length === 2;
    const quoteCurrency = isSpot ? instId.split("-")[1] : undefined;

    const payload: Record<string, unknown> = {
      instId: request.instId,
      tdMode: request.tdMode,
      side: request.side,
      ordType: request.ordType,
      sz: request.sz,
      mgnMode: request.tdMode !== 'cash' ? request.tdMode : undefined
    };

    if (!isSpot && request.posSide) {
      payload.posSide = request.posSide;
    }

    if (isAlgo) {
      payload.algoClOrdId = request.clOrdId;
    } else {
      payload.clOrdId = request.clOrdId;
    }

    if (isSpot) {
      const meta = request.meta as { tgt_ccy?: string } | undefined;
      if (meta?.tgt_ccy) {
        payload.tgtCcy = meta.tgt_ccy;
      }
      
      if (request.tdMode === 'cross' || request.tdMode === 'isolated') {
        payload.ccy = quoteCurrency;
      }
    }

    if (payload.tdMode !== 'cash' && 'tgtCcy' in payload) {
      delete payload.tgtCcy;
    }

    if (request.px) payload.px = request.px;
    if (request.triggerPx) {
      payload.triggerPx = request.triggerPx;
      payload.orderPx = request.triggerPx;
      payload.triggerPxType = 'last';
    }
    if (request.tpTriggerPx) {
      payload.tpTriggerPx = request.tpTriggerPx;
      payload.tpOrdPx = request.tpTriggerPx;
      payload.tpTriggerPxType = 'last';
    }
    if (request.slTriggerPx) {
      payload.slTriggerPx = request.slTriggerPx;
      payload.slOrdPx = OKXTradeService.SL_AS_MARKET_ORDER_TYPES.includes(request.ordType) ? '-1' : request.slTriggerPx;
      payload.slTriggerPxType = 'last';
    }
    if (request.chaseVal) {
      payload.chaseType = 'distance';
      payload.chaseVal = request.chaseVal;
    }
    if (request.activePx && Number(request.activePx) > 0) payload.activePx = request.activePx;
    if (request.callbackRatio && Number(request.callbackRatio) > 0) payload.callbackRatio = request.callbackRatio;
    if (request.callbackSpread && Number(request.callbackSpread) > 0) payload.callbackSpread = request.callbackSpread;

    if (request.attachAlgoOrds && request.attachAlgoOrds.length > 0) {
      payload.attachAlgoOrds = request.attachAlgoOrds.map((a) => {
        const mapped: Record<string, unknown> = { attachAlgoClOrdId: a.clOrdId };
        if (a.tpTriggerPx) {
          mapped.tpTriggerPx = a.tpTriggerPx;
          mapped.tpOrdPx = a.tpOrdPx || a.tpTriggerPx;
          mapped.tpTriggerPxType = 'last';
        }
        if (a.slTriggerPx) {
          mapped.slTriggerPx = a.slTriggerPx;
          if (a.slOrdPx !== undefined) {
            mapped.slOrdPx = a.slOrdPx;
          } else {
            mapped.slOrdPx = OKXTradeService.SL_AS_MARKET_ORDER_TYPES.includes(request.ordType) ? '-1' : a.slTriggerPx;
          }
          mapped.slTriggerPxType = 'last';
        }
        if (a.callbackRatio) mapped.callbackRatio = a.callbackRatio;
        if (a.callbackSpread) mapped.callbackSpread = a.callbackSpread;
        if (a.activePx) mapped.activePx = a.activePx;
        return mapped;
      });
    }

    return payload;
  }

  async placeOrder(request: ActionPlaceOrderParams): Promise<OKXApiResponse> {
    const payload = this.mapToOKXPayload(request);
    const isAlgo = ["trigger", "conditional", "oco", "chase", "move_order_stop"].includes(request.ordType);
    try {
      if (isAlgo) {
        return await this.placeAlgoOrder(payload as unknown as PlaceAlgoOrderParams);
      } else {
        return await this.placeBatchOrders([payload as unknown as PlaceOrderParams]);
      }
    } catch (e: unknown) {
      if (isAlgo) {
        LogService.info('trader', `[OKX] Algo Order Payload (账户 ${this.accountLabel()}): ${JSON.stringify(payload)}`);
      } else {
        LogService.info('trader', `[OKX] Regular Order Payload (账户 ${this.accountLabel()}): ${JSON.stringify(payload)}`);
      }
      throw e;
    }
  }

  async placeOrders(requests: ActionPlaceOrderParams[]): Promise<OKXApiResponse> {
    const payloads = requests.map(r => this.mapToOKXPayload(r));
    try {
      return await this.placeBatchOrders(payloads as unknown as PlaceOrderParams[]);
    } catch (e: unknown) {
      LogService.info('trader', `[OKX] Batch Orders Payload (账户 ${this.accountLabel()}): ${JSON.stringify(payloads)}`);
      throw e;
    }
  }
}

export async function setLeverageStatic(
  apiKey: string,
  secretKey: string,
  passphrase: string,
  body: Record<string, string>,
): Promise<{ code: string; msg: string; data?: unknown }> {
  const okxPath = '/api/v5/account/set-leverage';
  const bodyStr = JSON.stringify(body);
  const timestamp = (Date.now() / 1000).toFixed(3);
  const signStr = timestamp + 'POST' + okxPath + bodyStr;
  const sign = crypto.createHmac('sha256', secretKey).update(signStr).digest('base64');

  return new Promise<{ code: string; msg: string; data?: unknown }>((resolve, reject) => {
    const req = https.request({
      hostname: 'www.okx.com',
      port: 443,
      path: okxPath,
      method: 'POST',
      headers: {
        'OK-ACCESS-KEY': apiKey,
        'OK-ACCESS-SIGN': sign,
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': passphrase,
        'Content-Type': 'application/json',
      },
    }, (resp) => {
      let data = '';
      resp.on('data', (chunk) => data += chunk);
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`OKX 响应解析失败: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}
