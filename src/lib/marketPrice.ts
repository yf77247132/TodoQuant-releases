
const MARKET_TIMEOUT_MS = 5000;

const priceCache = new Map<string, { price: number; time: number }>();
const CACHE_TTL = 5000;

const fundingRateCache = new Map<string, { rate: string; nextTime: string; time: number }>();
const FUNDING_CACHE_TTL = 60000;

interface OKXTickerRaw {
  code: string;
  data: Array<{ last: string }>;
}

interface BinanceTickerRaw {
  price: string;
}

interface OKXTickerSodRaw {
  code: string;
  data: Array<{ sodUtc8?: string }>;
}

const sodUtc8Cache = new Map<string, { value: number; time: number }>();
const SOD_CACHE_TTL = 5 * 60 * 1000;

function detectExchange(instId: string): 'OKX' | 'BINANCE' {
  return instId.includes('-') ? 'OKX' : 'BINANCE';
}

export async function fetchMarketPrice(instId: string): Promise<number | null> {
  const exchange = detectExchange(instId);
  const cacheKey = `${exchange}:${instId}`;
  const cached = priceCache.get(cacheKey);
  if (cached && (Date.now() - cached.time < CACHE_TTL)) {
    return cached.price;
  }

  try {
    let price: number | null = null;

    if (exchange === 'OKX') {
      const url = `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`;
      const data = await fetchWithTimeout(url) as OKXTickerRaw;
      if (data?.code === '0' && data?.data?.[0]?.last) {
        price = parseFloat(data.data[0].last);
      }
    } else {
      const url = `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(instId)}`;
      const data = await fetchWithTimeout(url) as BinanceTickerRaw;
      if (data?.price) {
        price = parseFloat(data.price);
      }
    }

    if (price !== null && Number.isFinite(price)) {
      priceCache.set(cacheKey, { price, time: Date.now() });
      return price;
    }
    return null;
  } catch (_e: unknown) {
    return null;
  }
}

export async function fetchSodUtc8(instId: string): Promise<number | null> {
  const exchange = detectExchange(instId);
  if (exchange !== 'OKX') return null;

  const cached = sodUtc8Cache.get(instId);
  if (cached && (Date.now() - cached.time < SOD_CACHE_TTL)) {
    return cached.value;
  }

  try {
    const url = `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`;
    const data = await fetchWithTimeout(url) as OKXTickerSodRaw;
    const sod = data?.data?.[0]?.sodUtc8;
    const value = sod ? parseFloat(sod) : NaN;
    if (Number.isFinite(value) && value > 0) {
      sodUtc8Cache.set(instId, { value, time: Date.now() });
      return value;
    }
    return null;
  } catch (_e: unknown) {
    return null;
  }
}

async function fetchWithTimeout(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MARKET_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

interface OKXFundingRateRaw {
  code: string;
  data: Array<{
    instId: string;
    fundingRate: string;
    nextFundingTime?: string;
    settFundingRate?: string;
  }>;
}

interface BinanceFundingRateRaw {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
  markPrice?: string;
}

export interface FundingRateResult {
  instId: string;
  rate: string;
  nextFundingTime?: string;
  displayText: string;
}

export async function fetchFundingRate(instId: string): Promise<FundingRateResult | null> {
  const exchange = detectExchange(instId);
  const cached = fundingRateCache.get(instId);
  if (cached && (Date.now() - cached.time < FUNDING_CACHE_TTL)) {
    return formatFundingResult(instId, cached.rate, cached.nextTime);
  }

  try {
    if (exchange === 'OKX') {
      const url = `https://www.okx.com/api/v5/public/funding-rate?instId=${encodeURIComponent(instId)}`;
      const data = await fetchWithTimeout(url) as OKXFundingRateRaw;
      if (data?.code === '0' && data?.data?.[0]) {
        const item = data.data[0];
        fundingRateCache.set(instId, { rate: item.fundingRate || '0', nextTime: item.nextFundingTime || '', time: Date.now() });
        return formatFundingResult(instId, item.fundingRate || '0', item.nextFundingTime);
      }
      return null;
    } else {
      const binanceSymbol = okxInstIdToBinanceSymbol(instId);
      const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${encodeURIComponent(binanceSymbol)}&limit=1`;
      const data = await fetchWithTimeout(url) as BinanceFundingRateRaw[];
      if (Array.isArray(data) && data[0]?.fundingRate !== undefined) {
        const item = data[0];
        fundingRateCache.set(instId, { rate: item.fundingRate || '0', nextTime: String(item.fundingTime), time: Date.now() });
        return formatFundingResult(instId, item.fundingRate || '0', String(item.fundingTime));
      }
      return null;
    }
  } catch (_e: unknown) {
    return null;
  }
}

export async function fetchFundingRates(instIds: string[]): Promise<Map<string, FundingRateResult>> {
  const results = new Map<string, FundingRateResult>();
  const BATCH_SIZE = 3;
  const BATCH_INTERVAL_MS = 200;
  for (let i = 0; i < instIds.length; i += BATCH_SIZE) {
    const batch = instIds.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map(async (instId) => {
      const result = await fetchFundingRate(instId);
      if (result) results.set(instId, result);
    }));
    if (i + BATCH_SIZE < instIds.length) {
      await new Promise(r => setTimeout(r, BATCH_INTERVAL_MS));
    }
  }
  return results;
}

function formatFundingResult(instId: string, rate: string, nextTime?: string): FundingRateResult {
  const num = parseFloat(rate) || 0;
  const pct = num * 100;
  const sign = num < 0 ? '-' : '';
  const ceilAbs = Math.ceil(Math.abs(pct) * 1000) / 1000;
  const displayText = `${sign}${ceilAbs.toFixed(3)}%`;
  return { instId, rate, nextFundingTime: nextTime, displayText };
}

function okxInstIdToBinanceSymbol(instId: string): string {
  const base = instId.replace(/-(SWAP|PERP|-\d{6})$/, '');
  return base.replace(/-/g, '');
}
