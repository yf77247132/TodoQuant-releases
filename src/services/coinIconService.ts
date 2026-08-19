
import { LogService } from './logService.ts';

interface CoinMarketItem {
  id: string;
  symbol: string;
  image: string;
}

interface CoinSearchItem {
  symbol?: string;
  large?: string;
}

interface CoinSearchResponse {
  coins?: CoinSearchItem[];
}

interface LookupCacheEntry {
  url: string | null;
  expireAt: number;
  notFound: boolean;
}

interface LookupResult {
  url: string | null;
  notFound: boolean;
}

export class CoinIconService {
  private static symbolToImage: Map<string, string> = new Map();

  private static lookedUpCache: Map<string, LookupCacheEntry> = new Map();

  private static inFlight: Map<string, Promise<{ url: string | null; notFound: boolean }>> = new Map();

  private static initialized = false;

  private static initPromise: Promise<void> | null = null;

  private static searchQueue: Array<() => void> = [];
  private static searchRunningCount = 0;

  private static rateLimitedUntil = 0;

  private static consecutiveRateLimitCount = 0;

  private static readonly RATE_LIMIT_COOLDOWN_BASE_MS = 30 * 1000;

  private static readonly RATE_LIMIT_BACKOFF_MAX_POWER = 4;

  private static readonly MIN_REQUEST_INTERVAL_MS = 300;

  private static readonly SEARCH_CONCURRENCY = 3;

  private static readonly NULL_CACHE_TTL_MS = 30 * 1000;

  private static readonly NOT_FOUND_CACHE_TTL_MS = 30 * 60 * 1000;

  private static readonly URL_CACHE_TTL_MS = 3600 * 1000;

  private static readonly API_BASE = 'https://api.coingecko.com/api/v3';

  private static lastRequestFinishedAt = 0;

  private static getRateLimitCooldownMs(): number {
    const power = Math.min(this.consecutiveRateLimitCount - 1, this.RATE_LIMIT_BACKOFF_MAX_POWER);
    if (power < 0) return this.RATE_LIMIT_COOLDOWN_BASE_MS;
    return this.RATE_LIMIT_COOLDOWN_BASE_MS * Math.pow(2, power);
  }

  private static readonly API_KEY = typeof process !== 'undefined' ? (process.env?.COINGECKO_API_KEY || '') : '';

  private static buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.API_KEY) {
      headers['x-cg-demo-api-key'] = this.API_KEY;
    }
    return headers;
  }

  static async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private static async doInit(): Promise<void> {
    try {
      const totalPages = 3;
      const allItems: CoinMarketItem[] = [];

      for (let page = 1; page <= totalPages; page++) {
        const url = `${this.API_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`;
        const resp = await fetch(url, { headers: this.buildHeaders() });

        if (!resp.ok) {
          if (resp.status === 429) {
            this.consecutiveRateLimitCount++;
            this.rateLimitedUntil = Date.now() + this.getRateLimitCooldownMs();
            const cooldownSec = Math.round(this.getRateLimitCooldownMs() / 1000);
            LogService.warn('coinIcon', `CoinGecko markets 限流(429)，进入 ${cooldownSec} 秒冷却（连续第 ${this.consecutiveRateLimitCount} 次）page=${page}`);
          } else {
            LogService.warn('coinIcon', `CoinGecko markets 请求失败 page=${page} status=${resp.status}`);
          }
          break;
        }

        const data = (await resp.json()) as CoinMarketItem[];
        if (!Array.isArray(data) || data.length === 0) break;
        allItems.push(...data);

        if (page < totalPages) {
          await new Promise<void>(resolve => setTimeout(resolve, this.MIN_REQUEST_INTERVAL_MS));
        }
      }

      for (const item of allItems) {
        const sym = item.symbol?.trim().toUpperCase();
        if (sym && item.image && !this.symbolToImage.has(sym)) {
          this.symbolToImage.set(sym, item.image);
        }
      }

      this.initialized = true;
      const keyStatus = this.API_KEY ? '（Demo Key 已启用，100 calls/min）' : '（无 API Key，公开模式 ≈15 calls/min）';
      LogService.info('coinIcon', `CoinGecko 图标映射初始化完成，缓存 ${this.symbolToImage.size} 个币种${keyStatus}`);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      LogService.warn('coinIcon', `CoinGecko 图标映射初始化失败: ${err.message}`);
    }
  }

  static getImageUrl(symbol: string): string | null {
    const sym = symbol?.trim().toUpperCase();
    if (!sym) return null;
    return this.symbolToImage.get(sym) ?? null;
  }

  static async getImageUrlAsync(symbol: string): Promise<{ url: string | null; notFound: boolean }> {
    const sym = symbol?.trim().toUpperCase();
    if (!sym) return { url: null, notFound: true };

    if (this.initPromise) {
      const timeout = new Promise<void>(resolve => setTimeout(resolve, 3000));
      await Promise.race([this.initPromise, timeout]);
    }

    const cached = this.symbolToImage.get(sym);
    if (cached) return { url: cached, notFound: false };

    const lookupEntry = this.lookedUpCache.get(sym);
    if (lookupEntry && lookupEntry.expireAt > Date.now()) {
      return { url: lookupEntry.url, notFound: lookupEntry.notFound };
    }

    const inflight = this.inFlight.get(sym);
    if (inflight) {
      const r = await inflight;
      return { url: r.url, notFound: r.notFound };
    }

    const promise = this.doSearchLookup(sym);
    this.inFlight.set(sym, promise);
    try {
      const result = await promise;
      let ttl: number;
      if (result.url) {
        ttl = this.URL_CACHE_TTL_MS;
      } else if (result.notFound) {
        ttl = this.NOT_FOUND_CACHE_TTL_MS;
      } else {
        const remainingCooldown = this.rateLimitedUntil - Date.now();
        if (remainingCooldown > 0) {
          ttl = remainingCooldown + 30000 + Math.floor(Math.random() * 60000);
        } else {
          ttl = this.NULL_CACHE_TTL_MS;
        }
      }
      this.lookedUpCache.set(sym, { url: result.url, expireAt: Date.now() + ttl, notFound: result.notFound });
      return { url: result.url, notFound: result.notFound };
    } finally {
      this.inFlight.delete(sym);
    }
  }

  private static async doSearchLookup(symbol: string): Promise<LookupResult> {
    if (Date.now() < this.rateLimitedUntil) {
      return { url: null, notFound: false };
    }

    await this.acquireSearchSlot();
    try {
      if (Date.now() < this.rateLimitedUntil) {
        return { url: null, notFound: false };
      }

      const url = `${this.API_BASE}/search?query=${encodeURIComponent(symbol)}`;
      const resp = await fetch(url, { headers: this.buildHeaders() });
      if (!resp.ok) {
        if (resp.status === 429) {
          this.consecutiveRateLimitCount++;
          this.rateLimitedUntil = Date.now() + this.getRateLimitCooldownMs();
          const cooldownSec = Math.round(this.getRateLimitCooldownMs() / 1000);
          LogService.warn('coinIcon', `CoinGecko 限流(429)，进入 ${cooldownSec} 秒冷却（连续第 ${this.consecutiveRateLimitCount} 次）symbol=${symbol}`);
          return { url: null, notFound: false };
        }
        LogService.warn('coinIcon', `CoinGecko search 请求失败 symbol=${symbol} status=${resp.status}`);
        return { url: null, notFound: false };
      }

      this.consecutiveRateLimitCount = 0;

      const data = (await resp.json()) as CoinSearchResponse;
      const coins = data?.coins;
      if (!Array.isArray(coins)) {
        return { url: null, notFound: true };
      }

      for (const coin of coins) {
        const sym = coin.symbol?.trim().toUpperCase();
        if (sym === symbol && coin.large) {
          return { url: coin.large, notFound: false };
        }
      }
      return { url: null, notFound: true };
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      LogService.warn('coinIcon', `CoinGecko search 网络错误 symbol=${symbol}: ${err.message}`);
      return { url: null, notFound: false };
    } finally {
      this.releaseSearchSlot();
    }
  }

  private static async acquireSearchSlot(): Promise<void> {
    while (this.searchRunningCount >= this.SEARCH_CONCURRENCY) {
      await new Promise<void>(resolve => this.searchQueue.push(resolve));
    }
    this.searchRunningCount++;

    const elapsed = Date.now() - this.lastRequestFinishedAt;
    const wait = this.MIN_REQUEST_INTERVAL_MS - elapsed;
    if (wait > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, wait));
    }
  }

  private static releaseSearchSlot(): void {
    this.lastRequestFinishedAt = Date.now();
    this.searchRunningCount--;
    const next = this.searchQueue.shift();
    if (next) {
      next();
    }
  }

  static isReady(): boolean {
    return this.initialized;
  }

  static getRateLimitRemainingMs(): number {
    return Math.max(0, this.rateLimitedUntil - Date.now());
  }
}
