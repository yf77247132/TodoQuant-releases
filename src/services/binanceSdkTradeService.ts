import { Spot } from "@binance/spot";
import { DerivativesTradingUsdsFutures } from "@binance/derivatives-trading-usds-futures";
import { MarginTrading } from "@binance/margin-trading";
import { SimpleEarn } from "@binance/simple-earn";
import { Wallet } from "@binance/wallet";
import https from "node:https";
import { URL } from "node:url";
import { LogService } from "./logService.ts";
import { BinanceOrderService } from "./binanceOrderService.ts";

const _sharedHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 15,
  keepAliveMsecs: 30000,
  scheduling: 'lifo',
});

export interface BinanceSdkConfig {
  apiKey: string;
  secretKey: string;
  accountIdx: number;
  accountName?: string;
  useTestnet?: boolean;
}

export interface BinanceClosePositionParams {
  symbol: string;
  quantity: string;
  positionSide?: "LONG" | "SHORT" | "BOTH";
  side?: "BUY" | "SELL";
}

const _binanceErrorDedupe = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  const cutoff = now - 30000;
  for (const [k, v] of _binanceErrorDedupe) {
    if (v < cutoff) _binanceErrorDedupe.delete(k);
  }
}, 5 * 60 * 1000);
export function _shouldLogBinanceError(key: string, ttlMs = 10000): boolean {
  const last = _binanceErrorDedupe.get(key);
  const now = Date.now();
  if (last && now - last < ttlMs) return false;
  _binanceErrorDedupe.set(key, now);
  if (_binanceErrorDedupe.size > 200) {
    const cutoff = now - ttlMs * 3;
    for (const [k, v] of _binanceErrorDedupe) {
      if (v < cutoff) _binanceErrorDedupe.delete(k);
    }
  }
  return true;
}

const _timeOffsetStack: number[] = [];

export type BinanceSdkInfra = Pick<BinanceSdkTradeService,
  'toBinanceSymbol' | 'fromBinanceSymbol' | 'isFutures' |
  'getSpotSymbolInfo' | 'getFuturesSymbolInfo' |
  'ok' | 'fail' | 'roundStep' | 'extractData' | 'accountLabel' |
  'applyTiming' | 'patchDateNowForSdk' | 'restoreDateNow' |
  'syncServerTime' | 'syncTime' | 'clearTradeCaches' |
  'fetchFuturesAccountCached' | 'fetchPositionRiskCached' |
  'formatNetworkError' | 'shouldSkipNetworkLog' |
  'normalizeBinanceFuturesOrdType' | 'inferConditionalExecutionType' |
  'isTimestampError' | 'resolveTimeEndpoint' |
  'calculateMarginLeverage' | 'parsePercentIncrement' | 'calculateTpSlPrice' |
  'spotClient' | 'usdsFuturesClient' | 'marginClient' |
  'simpleEarnClient' | 'walletClient' |
  'spotSymbolInfoCache' | 'futuresSymbolInfoCache' |
  'baseRecvWindowMs' | 'timingProbeCooldownMs' | 'lastTimingProbeAt' |
  'withTimestampRetry' | 'sharedOrderListMap' | 'sharedLastOcoFetch' |
  'exchangeType' | 'useTestnet' |
  'probeHttpsPhases' | 'maybeProbeNetworkPhases' | 'getNetworkErrorType'
>;

export class BinanceSdkTradeService {
  public readonly exchangeType = "BINANCE";
  readonly spotClient: Spot;
  readonly usdsFuturesClient: DerivativesTradingUsdsFutures;
  readonly marginClient: MarginTrading;
  readonly simpleEarnClient: SimpleEarn;
  readonly walletClient: Wallet;
  readonly useTestnet: boolean;
  readonly _accountIdx: number;
  readonly _accountName: string | undefined;
  readonly spotSymbolInfoCache = new Map<string, { pricePrecision: number; quantityPrecision: number; minNotional: number }>();
  readonly futuresSymbolInfoCache = new Map<string, { pricePrecision: number; quantityPrecision: number; minNotional: number }>();
  readonly baseRecvWindowMs = 60000;
  readonly timingProbeCooldownMs = 60000;
  lastTimingProbeAt = 0;

    const str = String(rawValue ?? 0);
    const value = parseFloat(str.replace('%', '')) / (str.includes('%') ? 100 : 1);
    const isPercent = str.includes('%') || (value > 0 && value < 1);
    return { value, isPercent };
  }

    workingPrice: number,
    incrementValue: number,
    isPercent: boolean,
    side: string,
    isTp: boolean,
    precision: number = 8
  ): number {
    if (isPercent && incrementValue !== 0) {
      const multiplier = isTp
        ? (side.toUpperCase() === 'BUY' ? (1 + incrementValue) : (1 - incrementValue))
        : (side.toUpperCase() === 'BUY' ? (1 - incrementValue) : (1 + incrementValue));
      return Number((workingPrice * multiplier).toFixed(precision));
    } else {
      return workingPrice;
    }
  }

  constructor(config: BinanceSdkConfig) {
    this.useTestnet = Boolean(config.useTestnet);
    this._accountIdx = config.accountIdx;
    this._accountName = config.accountName;

    const restConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
      timeout: 15000,
      keepAlive: true,
      httpsAgent: _sharedHttpsAgent,
      basePath: this.useTestnet ? "https://testnet.binance.vision" : undefined,
    };

    const futuresRestConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
      timeout: 15000,
      keepAlive: true,
      httpsAgent: _sharedHttpsAgent,
      basePath: this.useTestnet ? "https://testnet.binancefuture.com" : undefined,
    };

    this.spotClient = new Spot({
      configurationRestAPI: restConfig as never,
    });

    this.usdsFuturesClient = new DerivativesTradingUsdsFutures({
      configurationRestAPI: futuresRestConfig as never,
    });

    this.marginClient = new MarginTrading({
      configurationRestAPI: restConfig as never,
    });

    this.simpleEarnClient = new SimpleEarn({
      configurationRestAPI: restConfig as never,
    });

    this.walletClient = new Wallet({
      configurationRestAPI: restConfig as never,
    });
  }

  get accountIdx(): number {
    return this._accountIdx;
  }

    return this._accountName || ('#' + this._accountIdx);
  }

  get spot() {
    return this.spotClient;
  }

  get usdsFutures() {
    return this.usdsFuturesClient;
  }

    const raw = err as { message?: string; response?: { data?: { code?: number | string; msg?: string } } };
    const msg = String(raw?.message || raw?.response?.data?.msg || "");
    const code = String(raw?.response?.data?.code ?? "");
    return (
      code === "-1021" ||
      msg.includes("recvWindow") ||
      msg.includes("INVALID_TIMESTAMP") ||
      msg.includes("Timestamp for this request is outside of the recvWindow") ||
      msg.includes("ahead of the server's time") ||
      msg.includes("behind the server's time")
    );
  }

    const msg = String((err as Error)?.message || '');
    return (
      msg.includes('Invalid API-key') ||
      msg.includes('PASSPHRASE incorrect') ||
      msg.includes('50111')
    );
  }

  private lastNetworkErrorTime = 0;
  private lastNetworkErrorType = '';
  private static readonly NETWORK_ERROR_DEBOUNCE_MS = 60000;

    const msg = String((err as Error)?.message || '');
    if (msg.includes('socket disconnected')) return 'socket_disconnected';
    if (msg.includes('ECONNRESET')) return 'connection_reset';
    if (msg.includes('ETIMEDOUT')) return 'timeout';
    if (msg.includes('ENOTFOUND')) return 'dns_error';
    if (msg.includes('request_error')) return 'request_error';
    if (msg.includes('Request failed after')) return 'request_retry_exhausted';
    return 'unknown_network';
  }

    const msg = String((err as Error)?.message || '');
    if (msg.includes('Client network socket disconnected')) {
      return '网络连接已断开 (socket disconnected)';
    }
    if (msg.includes('Request failed after') && msg.includes('retries')) {
      const retryMatch = msg.match(/after (\d+) retries/);
      const retryCount = retryMatch ? retryMatch[1] : '?';
      return `请求失败，已重试 ${retryCount} 次`;
    }
    if (msg.includes('ECONNRESET')) return '连接被远端重置 (ECONNRESET)';
    if (msg.includes('ETIMEDOUT')) return '请求超时 (ETIMEDOUT)';
    if (msg.includes('ENOTFOUND')) return 'DNS 解析失败 (ENOTFOUND)';
    return msg;
  }

    const errorType = this.getNetworkErrorType(err);
    const now = Date.now();
    if (errorType === this.lastNetworkErrorType &&
        now - this.lastNetworkErrorTime < BinanceSdkTradeService.NETWORK_ERROR_DEBOUNCE_MS) {
      return true;
    }
    this.lastNetworkErrorTime = now;
    this.lastNetworkErrorType = errorType;
    return false;
  }

    if (isFutures) {
      return this.useTestnet
        ? "https://testnet.binancefuture.com/fapi/v1/time"
        : "https://fapi.binance.com/fapi/v1/time";
    }
    return this.useTestnet
      ? "https://testnet.binance.vision/api/v3/time"
      : "https://api.binance.com/api/v3/time";
  }

  private _spotTimeOffsetMs = 0;
  private _spotLastSyncAt = 0;
  private _futuresTimeOffsetMs = 0;
  private _futuresLastSyncAt = 0;
  private static syncPromises: Record<string, Promise<void> | null> = {};
  private static penaltyUntil = 0;
  private static _dateNowPatched = (() => {
    const realNow = Date.now;
    (Date as { now: () => number }).now = () => {
      const offset = _timeOffsetStack.length > 0 ? _timeOffsetStack[_timeOffsetStack.length - 1] : 0;
      return realNow() + offset;
    };
    return realNow;
  })();

    const now = BinanceSdkTradeService._dateNowPatched();
    const lane = isFutures ? 'futures' : 'spot';

    if (!force && now < BinanceSdkTradeService.penaltyUntil) return;

    const lastSyncAt = isFutures ? this._futuresLastSyncAt : this._spotLastSyncAt;
    if (!force && lastSyncAt > 0 && now - lastSyncAt < 300000) {
      return;
    }

    const promiseKey = `${this._accountIdx}_${lane}`;
    if (BinanceSdkTradeService.syncPromises[promiseKey]) return BinanceSdkTradeService.syncPromises[promiseKey]!;

    BinanceSdkTradeService.syncPromises[promiseKey] = (async () => {
      try {
        const endpoint = this.resolveTimeEndpoint(isFutures);
        const timeout = 5000;
        await new Promise<void>((resolvePromise) => {
          const url = new URL(endpoint);
          const req = https.get(
            {
              protocol: url.protocol,
              hostname: url.hostname,
              port: url.port ? Number(url.port) : 443,
              path: url.pathname + (url.search || ""),
              agent: _sharedHttpsAgent,
              timeout,
            },
            (res) => {
              if (res.statusCode === 429) {
                res.resume();
                BinanceSdkTradeService.penaltyUntil = BinanceSdkTradeService._dateNowPatched() + 600000;
                resolvePromise();
                return;
              }

              if (!res.statusCode || res.statusCode >= 400) {
                res.resume();
                resolvePromise();
                return;
              }

              let body = "";
              res.on("data", (chunk: Buffer) => {
                body += chunk.toString();
              });
              res.on("end", () => {
                try {
                  const data = JSON.parse(body) as { serverTime?: number };
                  const serverTime = Number(data?.serverTime);
                  if (Number.isFinite(serverTime) && serverTime > 0) {
                    const now = BinanceSdkTradeService._dateNowPatched();
                    const offset = serverTime - now;
                    if (Math.abs(serverTime - now) < 3600000) {
                      if (isFutures) {
                        this._futuresTimeOffsetMs = offset;
                        this._futuresLastSyncAt = now;
                      } else {
                        this._spotTimeOffsetMs = offset;
                        this._spotLastSyncAt = now;
                      }
                    } else {
                      console.warn(`[binance] syncServerTime 服务端时间偏差过大，丢弃偏移量: serverTime=${serverTime}, now=${now}, diff=${offset}ms`);
                    }
                  }
                } catch {
                }
                resolvePromise();
              });
            }
          );

          req.setTimeout(timeout, () => req.destroy());
          req.on("error", () => resolvePromise());
        });
      } catch (e: unknown) {
        console.debug(`[binance] syncServerTime failed for lane=${lane} account=${this._accountIdx}:`, e instanceof Error ? e.message : String(e));
      } finally {
        delete BinanceSdkTradeService.syncPromises[promiseKey];
      }
    })();

    return BinanceSdkTradeService.syncPromises[promiseKey];
  }

  async syncTime(force = false): Promise<void> {
    await Promise.all([
      this.syncServerTime(false, force),
      this.syncServerTime(true, force),
    ]);
  }

    const offset = isFutures
      ? this._futuresTimeOffsetMs
      : this._spotTimeOffsetMs;
    payload.timestamp = BinanceSdkTradeService._dateNowPatched() + offset;
    payload.recvWindow = this.baseRecvWindowMs;
  }

  private _cachedFuturesAccount: any = null;
  private _lastFuturesFetch = 0;
  private _cachedPositionRisk: any = null;
  private _lastRiskFetch = 0;

  public clearTradeCaches() {
    this._cachedFuturesAccount = null;
    this._lastFuturesFetch = 0;
    this._cachedPositionRisk = null;
    this._lastRiskFetch = 0;
  }

    const now = Date.now();
    if (this._cachedFuturesAccount && now - this._lastFuturesFetch < 5000) {
      return this._cachedFuturesAccount;
    }

    const res = await this.withTimestampRetry(true, async () => {
      const payload: any = {};
      this.applyTiming(payload, true);
      return this.usdsFuturesClient.restAPI.accountInformationV3(payload as never);
    });
    
    this._cachedFuturesAccount = await this.extractData(res);
    this._lastFuturesFetch = now;
    return this._cachedFuturesAccount;
  }

    const now = Date.now();
    if (this._cachedPositionRisk && now - this._lastRiskFetch < 30000) {
      return this._cachedPositionRisk;
    }

    const res = await this.withTimestampRetry(true, async () => {
      const payload: any = {};
      this.applyTiming(payload, true);
      return this.usdsFuturesClient.restAPI.positionInformationV2(payload as never);
    });
    
    this._cachedPositionRisk = await this.extractData(res);
    this._lastRiskFetch = now;
    return this._cachedPositionRisk;
  }

  async getAccountBalance(ccy: string = "USDT"): Promise<any | null> {
    try {
      const uAcct = await this.fetchFuturesAccountCached();
      
      let uAvail = 0;
      let uFrozen = 0;
      let uEq = 0;
      
      if (uAcct && Array.isArray(uAcct.assets)) {
        const bal = uAcct.assets.find((b: any) => b.asset === ccy);
        if (bal) {
          const avail = bal.availableBalance ?? bal.crossWalletBalance ?? bal.walletBalance;
          uAvail = Number(avail || '0');
          uFrozen = Number(bal.positionInitialMargin || '0');
          uEq = Number(bal.walletBalance || '0');
        }
      } else if (uAcct && uAcct.availableBalance) {
        uAvail = Number(uAcct.availableBalance || '0');
        uFrozen = Number(uAcct.totalPositionInitialMargin || '0');
        uEq = Number(uAcct.totalWalletBalance || '0');
      }
      
      return {
        totalEq: String(uEq),
        details: [
          {
            ccy,
            availBal: String(uAvail),
            frozenBal: String(uFrozen),
            eq: String(uEq)
          }
        ]
      };
    } catch(e: unknown) {
      LogService.logKey("system", 'account.futures.valuation.failed', { exchange: 'BINANCE', label: this.accountLabel(), msg: (e as Error).message || String(e) }, 'error');
      return null;
    }
  }

  async getSavingsBalance(ccy: string): Promise<string | null> {
    try {
      const res = await this.withTimestampRetry(false, () => this.simpleEarnClient.restAPI.getFlexibleProductPosition({ asset: ccy }));
      const data = await this.extractData(res);
      if (data && Array.isArray(data.rows)) {
        let total = 0;
        for (const row of data.rows) {
          total += parseFloat(row.totalAmount || "0");
        }
        return total.toString();
      }
    } catch(e: unknown) {
      if (typeof e === 'object' && e !== null && 'response' in e) {
        const errorData = (e as any).response?.data;
         if (typeof errorData === 'object' && errorData !== null && errorData.msg && String(errorData.msg).includes('Not Exists')) {
            return "0";
         }
      }
    }
    return "0";
  }

  async getAssetValuation(ccy: string = "USDT"): Promise<any | null> {
    try {
      const res = await this.withTimestampRetry(false, () => this.walletClient.restAPI.queryUserWalletBalance({ quoteAsset: ccy }));
      const wallets = await this.extractData(res);
      
      if (Array.isArray(wallets)) {
        let funding = 0;
        let earn = 0;
        let trading = 0;

        const tradingWallets = [
          "Spot", 
          "Cross Margin", 
          "Isolated Margin", 
          "USDⓈ-M Futures", 
          "COIN-M Futures", 
          "Options", 
          "Trading Bot", 
          "Copy Trading"
        ];

        let totalBal = 0;
        for (const wallet of wallets) {
          const bal = parseFloat(wallet.balance) || 0;
          totalBal += bal;

          if (wallet.walletName === "Funding") {
            funding += bal;
          } else if (wallet.walletName === "Earn") {
            earn += bal;
          } else if (wallet.walletName && tradingWallets.includes(wallet.walletName)) {
            trading += bal;
          }
        }

        return {
          totalBal: totalBal.toString(),
          details: {
            funding: funding.toString(),
            trading: trading.toString(),
            earn: earn.toString()
          }
        };
      }
    } catch(e: unknown) {
      const error = e as Error;
      if (!(error.message || String(e)).includes('Client network socket disconnected')) {
        LogService.logKey("system", 'account.valuation.failed', { exchange: 'BINANCE', label: this.accountLabel(), msg: error.message || String(e) }, 'error');
      }
    }
    return null;
  }

    let data;
    if (res && res.data) {
      if (typeof res.data === 'function') {
        data = await res.data();
      } else {
        data = res.data;
      }
    } else {
      data = res || {};
    }
    
    if (data) {
      const innerOrder = data.amendedOrder || data;
      const actualId = innerOrder.orderId || innerOrder.orderListId;
      if (actualId && !data.ordId) {
        data.ordId = String(actualId);
      }
    }
    return data;
  }

    const offset = isFutures
      ? this._futuresTimeOffsetMs
      : this._spotTimeOffsetMs;
    if (Math.abs(offset) <= 100) return false;
    _timeOffsetStack.push(offset);
    return true;
  }

    _timeOffsetStack.pop();
  }

    const begin = BinanceSdkTradeService._dateNowPatched();
    const lane = isFutures ? "futures" : "spot";
    await this.syncServerTime(isFutures, false);

    const wasPatched = useSdkTimestamp ? this.patchDateNowForSdk(isFutures) : false;

    try {
      const res = await runner();
      const elapsed = BinanceSdkTradeService._dateNowPatched() - begin;
      if (elapsed >= 3000) {
        await this.maybeProbeNetworkPhases(isFutures, `slow=${elapsed}ms`);
      }
      return res;
    } catch (e: unknown) {
      const elapsed = BinanceSdkTradeService._dateNowPatched() - begin;
      if (!this.shouldSkipNetworkLog(e)) {
        const friendlyMsg = this.formatNetworkError(e);
        if (e instanceof Error && friendlyMsg !== e.message) {
          e.message = friendlyMsg;
        }
      }
      if (!this.isAuthError(e)) {
        await this.maybeProbeNetworkPhases(isFutures, "request_error");
      }
      if (!this.isTimestampError(e)) throw e;
      await this.syncServerTime(isFutures, true);
      const retryPatched = useSdkTimestamp ? this.patchDateNowForSdk(isFutures) : false;
      try {
        return await runner();
      } finally {
        if (retryPatched) this.restoreDateNow();
      }
    } finally {
      if (wasPatched) this.restoreDateNow();
    }
  }

    if (process.env.TRACE_BINANCE_PROBE !== '1') return;

    const now = Date.now();
    if (now - this.lastTimingProbeAt < this.timingProbeCooldownMs) return;
    
    if (now < BinanceSdkTradeService.penaltyUntil) return;

    this.lastTimingProbeAt = now;

    const endpoint = this.resolveTimeEndpoint(isFutures);
    const probe = await this.probeHttpsPhases(endpoint);
    if (!probe.ok) {
      LogService.warn("network", `[BINANCE][${this.accountLabel()}][probe] ${reason} endpoint=${endpoint} error=${probe.error}`);
      return;
    }
    
    if (probe.statusCode !== 200 || (probe.totalMs && probe.totalMs > 1000)) {
      LogService.info(
        "network",
        `[BINANCE][${this.accountLabel()}][probe] ${reason} endpoint=${endpoint} status=${probe.statusCode} dns=${probe.dnsMs}ms tcp=${probe.tcpMs}ms tls=${probe.tlsMs}ms ttfb=${probe.ttfbMs}ms total=${probe.totalMs}ms`
      );
    }
  }

    ok: boolean;
    statusCode?: number;
    dnsMs?: number;
    tcpMs?: number;
    tlsMs?: number;
    ttfbMs?: number;
    totalMs?: number;
    error?: string;
  }> {
    return await new Promise((resolve) => {
      const startedAt = Date.now();
      const url = new URL(urlText);

      let dnsAt = startedAt;
      let tcpAt = startedAt;
      let tlsAt = startedAt;
      let firstByteAt = 0;

      const req = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port ? Number(url.port) : 443,
          path: url.pathname + (url.search || ""),
          method: "GET",
          timeout: 10000,
        },
        (res) => {
          res.once("data", () => {
            firstByteAt = Date.now();
          });
          res.on("end", () => {
            const doneAt = Date.now();
            const dnsMs = dnsAt && startedAt ? Math.max(dnsAt - startedAt, 0) : 0;
            const tcpMs = tcpAt && dnsAt ? Math.max(tcpAt - dnsAt, 0) : 0;
            const tlsMs = tlsAt && tcpAt ? Math.max(tlsAt - tcpAt, 0) : 0;
            const ttfbMs = firstByteAt && tlsAt ? Math.max(firstByteAt - tlsAt, 0) : 0;
            resolve({
              ok: true,
              statusCode: res.statusCode,
              dnsMs,
              tcpMs,
              tlsMs,
              ttfbMs,
              totalMs: Math.max(doneAt - startedAt, 0),
            });
          });
          res.resume();
        }
      );

      req.on("socket", (socket) => {
        socket.once("lookup", () => {
          dnsAt = Date.now();
        });
        socket.once("connect", () => {
          tcpAt = Date.now();
        });
        socket.once("secureConnect", () => {
          tlsAt = Date.now();
        });
      });

      req.on("timeout", () => {
        req.destroy(new Error("probe timeout"));
      });

      req.on("error", (err) => {
        resolve({
          ok: false,
          totalMs: Math.max(Date.now() - startedAt, 0),
          error: err.message || String(err),
        });
      });

      req.end();
    });
  }

    return String(instId || "")
      .replace(/-SWAP$/i, "")
      .replace(/-FUTURES$/i, "")
      .replace(/-/g, "")
      .toUpperCase();
  }

    const s = String(symbol || "").toUpperCase();
    const commonQuotes = ["USDT", "BUSD", "USDC", "BTC", "ETH", "BNB", "DAI", "TUSD", "FDUSD"];
    for (const quote of commonQuotes) {
      if (s.endsWith(quote)) {
        const base = s.slice(0, s.length - quote.length);
        if (base.length > 0) return `${base}-${quote}`;
      }
    }
    return s;
  }

    const text = String(instId || "").toUpperCase();
    if (text.endsWith("-SWAP") || text.endsWith("-FUTURES")) return true;
    return false;
  }

    const type = String(rawType || "LIMIT").toUpperCase();
    const tif = String(rawTif || "").toUpperCase();
    if (type === "LIMIT") {
      if (tif === "GTX") return "post_only";
      if (tif === "FOK") return "fok";
      if (tif === "IOC") return "ioc";
      return "limit";
    }
    return type.toLowerCase();
  }

    const upperSide = String(side || "").toUpperCase();
    if (upperSide === "BUY") {
      return triggerPrice > marketPrice ? "STOP" : "TAKE_PROFIT";
    }
    return triggerPrice < marketPrice ? "STOP" : "TAKE_PROFIT";
  }

    if (this.spotSymbolInfoCache.has(symbol)) {
      return this.spotSymbolInfoCache.get(symbol) ?? null;
    }
    try {
      const info = await this.spotClient.restAPI.exchangeInfo({ symbol } as never);
      const payload = await this.extractData(info) || {};
      const symbols = Array.isArray(payload.symbols) ? payload.symbols : [];
      const matched = symbols.find((s: any) => String(s.symbol || "").toUpperCase() === symbol.toUpperCase());
      
      if (!matched) return null;

      const filters = Array.isArray(matched?.filters) ? matched.filters : [];

      let minNotional = 0;
      for (const f of filters) {
        const filterType = String(f?.filterType || "").toUpperCase();
        if (filterType === "NOTIONAL" || filterType === "MIN_NOTIONAL") {
          minNotional = Number(f?.minNotional) || 0;
          break;
        }
      }

      let pricePrecision = matched.baseAssetPrecision || 8;
      let quantityPrecision = matched.quoteAssetPrecision || 8;

      const priceFilter = filters.find((f: any) => f.filterType === "PRICE_FILTER");
      if (priceFilter && priceFilter.tickSize) {
        const tickSize = priceFilter.tickSize;
        const decimals = tickSize.indexOf('.') >= 0 ? tickSize.split('.')[1].replace(/0+$/, '').length : 0;
        pricePrecision = decimals;
      }

      const lotSizeFilter = filters.find((f: any) => f.filterType === "LOT_SIZE");
      if (lotSizeFilter && lotSizeFilter.stepSize) {
        const stepSize = lotSizeFilter.stepSize;
        const decimals = stepSize.indexOf('.') >= 0 ? stepSize.split('.')[1].replace(/0+$/, '').length : 0;
        quantityPrecision = decimals;
      }

      const result = { pricePrecision, quantityPrecision, minNotional };
      this.spotSymbolInfoCache.set(symbol, result);
      return result;
    } catch {
      return null;
    }
  }

    if (this.futuresSymbolInfoCache.has(symbol)) {
      return this.futuresSymbolInfoCache.get(symbol) ?? null;
    }
    try {
      const info = await this.usdsFuturesClient.restAPI.exchangeInformation();
      const payload = await this.extractData(info) || {};
      const symbols = Array.isArray(payload.symbols) ? payload.symbols : [];
      const matched = symbols.find((s: any) => String(s.symbol || "").toUpperCase() === symbol.toUpperCase());
      if (!matched) return null;
      const filters = Array.isArray(matched?.filters) ? matched.filters : [];
      let minNotional = 0;
      const minNotionalFilter = filters.find((f: any) => f.filterType === "MIN_NOTIONAL");
      if (minNotionalFilter) minNotional = Number(minNotionalFilter.notional) || 0;
      let pricePrecision = matched.pricePrecision || 8;
      let quantityPrecision = matched.quantityPrecision || 8;
      const priceFilter = filters.find((f: any) => f.filterType === "PRICE_FILTER");
      if (priceFilter && priceFilter.tickSize) {
        const tickSize = priceFilter.tickSize;
        const decimals = tickSize.indexOf('.') >= 0 ? tickSize.split('.')[1].replace(/0+$/, '').length : 0;
        pricePrecision = decimals;
      }
      const lotSizeFilter = filters.find((f: any) => f.filterType === "LOT_SIZE");
      if (lotSizeFilter && lotSizeFilter.stepSize) {
        const stepSize = lotSizeFilter.stepSize;
        const decimals = stepSize.indexOf('.') >= 0 ? stepSize.split('.')[1].replace(/0+$/, '').length : 0;
        quantityPrecision = decimals;
      }
      const result = { pricePrecision, quantityPrecision, minNotional };
      this.futuresSymbolInfoCache.set(symbol, result);
      return result;
    } catch {
      return null;
    }
  }

    return {
      code: "0",
      msg: "",
      data: data || ([] as Array<Record<string, unknown>>),
    };
  }

    return {
      code: "-1",
      msg,
      data: [] as Array<Record<string, unknown>>,
    };
  }

    const factor = Math.pow(10, precision);
    return (Math.floor(value * factor + 0.0000001) / factor).toFixed(precision);
  }

  private _orderService?: BinanceOrderService;
  private get orderService(): BinanceOrderService {
    if (!this._orderService) this._orderService = new BinanceOrderService(this);
    return this._orderService;
  }

  async getMarketPrice(instId: string): Promise<number | null> { return this.orderService.getMarketPrice(instId); }
  private async marginNewOrder(payload: any): Promise<any> { return this.orderService.marginNewOrder(payload); }
  private async marginCancelOrder(payload: any): Promise<any> { return this.orderService.marginCancelOrder(payload); }
  private async marginCancelOco(payload: any): Promise<any> { return this.orderService.marginCancelOco(payload); }
  private async cancelOrderList(payload: any): Promise<any> { return this.orderService.cancelOrderList(payload); }
  private async marginOrderOco(payload: any): Promise<any> { return this.orderService.marginOrderOco(payload); }
  private async marginOrderListOto(payload: any): Promise<any> { return this.orderService.marginOrderListOto(payload); }
  private async marginOrderListOtoco(payload: any): Promise<any> { return this.orderService.marginOrderListOtoco(payload); }
  async placeBatchOrders(orders: Array<Record<string, unknown>>) { return this.orderService.placeBatchOrders(orders); }
  async placeAlgoOrder(params: Record<string, unknown>) { return this.orderService.placeAlgoOrder(params); }
  async amendBatchOrders(params: Array<Record<string, unknown>>) { return this.orderService.amendBatchOrders(params); }
  private async amendSpotOrderByRecreate(...args: any[]) { return (this.orderService as any).amendSpotOrderByRecreate(...args); }
  private findSpotOtoGroupBySnapshot(...args: any[]) { return (this.orderService as any).findSpotOtoGroupBySnapshot(...args); }
  private findSpotOtocoGroupBySnapshot(...args: any[]) { return (this.orderService as any).findSpotOtocoGroupBySnapshot(...args); }
  private async amendSpotOtoRecreateByGroup(...args: any[]) { return (this.orderService as any).amendSpotOtoRecreateByGroup(...args); }
  private async amendSpotOtocoRecreateByGroup(...args: any[]) { return (this.orderService as any).amendSpotOtocoRecreateByGroup(...args); }
  private async amendSpotOcoRecreateByPair(...args: any[]) { return (this.orderService as any).amendSpotOcoRecreateByPair(...args); }
  private async amendFuturesAlgoOrderByRecreate(...args: any[]) { return (this.orderService as any).amendFuturesAlgoOrderByRecreate(...args); }
  private async amendMarginOrderByRecreate(...args: any[]) { return (this.orderService as any).amendMarginOrderByRecreate(...args); }
  private findMarginOcoPairBySnapshot(...args: any[]) { return (this.orderService as any).findMarginOcoPairBySnapshot(...args); }
  private async amendMarginOcoRecreate(...args: any[]) { return (this.orderService as any).amendMarginOcoRecreate(...args); }
  private async amendMarginOcoRecreateByPair(...args: any[]) { return (this.orderService as any).amendMarginOcoRecreateByPair(...args); }
  private async amendMarginOtoRecreate(...args: any[]) { return (this.orderService as any).amendMarginOtoRecreate(...args); }
  async amendAlgoOrder(params: Record<string, unknown>) { return this.orderService.amendAlgoOrder(params); }
  async cancelOrder(params: { instId: string; ordId: string }) { return this.orderService.cancelOrder(params); }
  async cancelBatchOrders(params: Array<Record<string, unknown>>) { return this.orderService.cancelBatchOrders(params); }
  async cancelBatchAlgoOrders(params: Array<Record<string, unknown>>) { return this.orderService.cancelBatchAlgoOrders(params); }
  async getOpenOrders(instId?: string, reqInstType?: string): Promise<any[]> { return this.orderService.getOpenOrders(instId, reqInstType); }
  async getMarginOpenOrders(instId?: string): Promise<any[]> { return this.orderService.getMarginOpenOrders(instId); }
  async fetchAllPagesForOrders(instType?: string): Promise<any[]> { return this.orderService.fetchAllPagesForOrders(instType); }
  async fetchAllPagesForAlgoType(_algoType: string, _instType?: string): Promise<any[]> { return this.orderService.fetchAllPagesForAlgoType(_algoType, _instType); }
  async getPositions(instId?: string): Promise<any[]> { return this.orderService.getPositions(instId); }
  async getMarginPositions(instId?: string): Promise<any[]> { return this.orderService.getMarginPositions(instId); }
  async getMarginAccountInfo(): Promise<{ leverage?: number; [key: string]: any }> { return this.orderService.getMarginAccountInfo(); }
  async closePosition(params: { instId: string; positionSide?: "LONG" | "SHORT" | "BOTH"; quantity: string; side?: "BUY" | "SELL" }) { return this.orderService.closePosition(params); }
  async placeOrder(request: any): Promise<any> { return this.orderService.placeOrder(request); }
  async placeOrders(requests: any[]): Promise<any> { return this.orderService.placeOrders(requests); }
  async redeemSavings(ccy: string, amt: string): Promise<boolean> { return this.orderService.redeemSavings(ccy, amt); }
  async transferAsset(ccy: string, amt: string, from: string, to: string): Promise<boolean> { return this.orderService.transferAsset(ccy, amt, from, to); }
}
