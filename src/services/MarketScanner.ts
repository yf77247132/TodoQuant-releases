
import { LogService } from './logService.ts';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from './errorMonitor.ts';
import { OKXWebSocketManager } from './wsManager.ts';

const OKX_POLL_INTERVAL_MS = 5000;

const REQUEST_TIMEOUT_MS = 8000;

export interface TickerData {
  instId: string;
  last: number;
  open24h: number;
  sodUtc8: number;
  high24h: number;
  low24h: number;
  volCcy24h: number;
  change24h: number;
  changeToday: number;
  ts: number;
}

interface OKXTickersResponse {
  code: string;
  msg: string;
  data: Array<{
    instType: string;
    instId: string;
    last: string;
    open24h: string;
    sodUtc0: string;
    sodUtc8: string;
    high24h: string;
    low24h: string;
    volCcy24h: string;
    vol24h: string;
    ts: string;
    askPx?: string;
    bidPx?: string;
  }>;
}

class MarketScanner {
  private tickerCache: Map<string, Map<string, TickerData>> = new Map();

  private okxTimer: ReturnType<typeof setInterval> | null = null;

  private running = false;

  private lastOkxFetchAt = 0;

  private lastWsPushAt = 0;

  private wsPushIntervalMs = 5000;

  start(): void {
    if (this.running) return;
    this.running = true;
    LogService.logKey('market', 'market.scannerStarted', { exchange: 'okx' });

    this.tickerCache.set('okx', new Map());

    this.fetchOkxTickers();
    this.okxTimer = setInterval(() => this.fetchOkxTickers(), OKX_POLL_INTERVAL_MS);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.okxTimer) {
      clearInterval(this.okxTimer);
      this.okxTimer = null;
    }
    LogService.logKey('market', 'market.scannerStopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  private async fetchOkxTickers(): Promise<void> {
    try {
      const url = 'https://www.okx.com/api/v5/market/tickers?instType=SWAP';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        LogService.logKey('market', 'market.fetchFailed', { exchange: 'okx', status: res.status }, 'warn');
        return;
      }

      const body: OKXTickersResponse = await res.json() as OKXTickersResponse;
      if (body.code !== '0' || !Array.isArray(body.data)) {
        LogService.logKey('market', 'market.fetchError', { exchange: 'okx', code: body.code, msg: body.msg }, 'warn');
        return;
      }

      const cache = this.tickerCache.get('okx');
      if (!cache) return;
      let updatedCount = 0;

      for (const raw of body.data) {
        const last = parseFloat(raw.last);
        const open24h = parseFloat(raw.open24h);
        const sodUtc8 = parseFloat(raw.sodUtc8);

        if (!Number.isFinite(last) || !Number.isFinite(open24h) || last === 0) continue;

        const change24h = open24h !== 0 ? (last - open24h) / open24h * 100 : 0;
        const changeToday = sodUtc8 !== 0 ? (last - sodUtc8) / sodUtc8 * 100 : 0;

        const safeFloat = (raw: string | undefined, fallback: number): number => {
          const v = parseFloat(raw || '');
          return Number.isFinite(v) ? v : fallback;
        };
        const safeInt = (raw: string | undefined, fallback: number): number => {
          const v = parseInt(raw || '', 10);
          return Number.isFinite(v) ? v : fallback;
        };

        const ticker: TickerData = {
          instId: raw.instId,
          last,
          open24h,
          sodUtc8: Number.isFinite(sodUtc8) ? sodUtc8 : open24h,
          high24h: safeFloat(raw.high24h, last),
          low24h: safeFloat(raw.low24h, last),
          volCcy24h: safeFloat(raw.volCcy24h, 0),
          change24h,
          changeToday: Number.isFinite(changeToday) ? changeToday : change24h,
          ts: safeInt(raw.ts, Date.now()),
        };

        cache.set(raw.instId, ticker);
        updatedCount++;
      }

      this.lastOkxFetchAt = Date.now();

      this.pushToWs();
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (err.name !== 'AbortError') {
        LogService.logKey('market', 'market.fetchException', { exchange: 'okx', msg: err.message }, 'warn');
        ErrorMonitor.captureError(err, ErrorLevel.LOW, ErrorCategory.NETWORK);
      }
    }
  }

  private pushToWs(): void {
    const now = Date.now();
    if (now - this.lastWsPushAt < this.wsPushIntervalMs) return;
    this.lastWsPushAt = now;

    const okxCache = this.tickerCache.get('okx');
    if (!okxCache || okxCache.size === 0) return;

    const top50 = [...okxCache.values()]
      .sort((a, b) => b.change24h - a.change24h)
      .slice(0, 50);

    const ws = OKXWebSocketManager.instance;
    if (!ws) return;

    ws.broadcast({
      type: 'market_tickers',
      data: {
        exchange: 'okx',
        tickers: top50,
        total: okxCache.size,
        fetchedAt: this.lastOkxFetchAt,
      },
    });
  }

  getTicker(exchange: string, instId: string): TickerData | undefined {
    return this.tickerCache.get(exchange)?.get(instId);
  }

  getAllTickers(exchange: string): TickerData[] {
    const cache = this.tickerCache.get(exchange);
    if (!cache) return [];
    return Array.from(cache.values());
  }

  getTopTickers(exchange: string, sortBy: 'change24h' | 'changeToday' = 'change24h', order: 'desc' | 'asc' = 'desc', limit: number = 50): TickerData[] {
    const all = this.getAllTickers(exchange);
    const sorted = [...all].sort((a, b) => {
      const diff = a[sortBy] - b[sortBy];
      return order === 'desc' ? -diff : diff;
    });
    return sorted.slice(0, limit);
  }

  getLastFetchTime(exchange: string): number {
    if (exchange === 'okx') return this.lastOkxFetchAt;
    return 0;
  }

  getAvailableExchanges(): string[] {
    return Array.from(this.tickerCache.keys());
  }
}

export const marketScanner = new MarketScanner();
