
import React, { memo, useEffect, useReducer } from 'react';

interface CoinIconProps {
  symbol?: string;
  size?: number;
  className?: string;
}

function FallbackIcon({ symbol, size }: { symbol?: string; size: number }) {
  const letter = symbol ? symbol.charAt(0).toUpperCase() : '?';
  return (
    <div
      className="rounded-full bg-surface-3 flex items-center justify-center text-text-tertiary font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {letter}
    </div>
  );
}

interface CacheEntry {
  url: string | null;
  expireAt: number;
  reason: 'url' | 'not_found' | 'rate_limited';
}
const cdnUrlCache = new Map<string, CacheEntry>();

const inflightRequests = new Map<string, Promise<string | null>>();

const localSvgCache = new Map<string, { uri: string; lum: number } | null>();
const localSvgInflight = new Map<string, Promise<{ uri: string; lum: number } | null>>();

function analyzeSvgLuminance(svgText: string): number {
  const colors = svgText.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || [];
  if (colors.length === 0) return -1;
  let total = 0;
  for (const c of colors) {
    let hex = c.slice(1);
    if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    total += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return total / colors.length;
}

async function fetchLocalSvg(symbol: string): Promise<{ uri: string; lum: number } | null> {
  const cached = localSvgCache.get(symbol);
  if (cached !== undefined) {
    if (cached && !cached.uri.startsWith('data:image/svg+xml;base64,')) {
      localSvgCache.set(symbol, null);
      return null;
    }
    return cached;
  }

  const inflight = localSvgInflight.get(symbol);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const resp = await fetch(`/crypto-icons/${symbol}.svg`);
      if (!resp.ok) {
        localSvgCache.set(symbol, null);
        return null;
      }
      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('svg') && !ct.includes('image')) {
        localSvgCache.set(symbol, null);
        return null;
      }
      const svgText = await resp.text();
      const dataUri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgText)))}`;
      const entry = { uri: dataUri, lum: analyzeSvgLuminance(svgText) };
      localSvgCache.set(symbol, entry);
      return entry;
    } catch {
      return null;
    }
  })().finally(() => {
    localSvgInflight.delete(symbol);
  });

  localSvgInflight.set(symbol, promise);
  return promise;
}

async function fetchCdnUrl(symbol: string): Promise<string | null> {
  const cached = cdnUrlCache.get(symbol);
  if (cached) {
    if (cached.expireAt === 0 || cached.expireAt > Date.now()) {
      return cached.url;
    }
  }

  const inflight = inflightRequests.get(symbol);
  if (inflight) return inflight;

  const promise = doFetchCdnUrl(symbol).finally(() => {
    inflightRequests.delete(symbol);
  });
  inflightRequests.set(symbol, promise);
  return promise;
}

async function doFetchCdnUrl(symbol: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`/api/coin-icon/${encodeURIComponent(symbol)}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (resp.ok) {
      const data = await resp.json();
      if (data.ok && data.url) {
        cdnUrlCache.set(symbol, { url: data.url, expireAt: 0, reason: 'url' });
        return data.url;
      }
    } else if (resp.status === 404) {
      cdnUrlCache.set(symbol, { url: null, expireAt: 0, reason: 'not_found' });
      return null;
    } else if (resp.status === 429) {
      let retryAfterSec = 60;
      try {
        const data = await resp.json();
        if (data?.retryAfter && Number.isFinite(data.retryAfter)) {
          retryAfterSec = Math.max(1, Number(data.retryAfter));
        }
      } catch {
        const headerVal = resp.headers.get('retry-after');
        if (headerVal) {
          const parsed = parseInt(headerVal, 10);
          if (Number.isFinite(parsed) && parsed > 0) retryAfterSec = parsed;
        }
      }
      cdnUrlCache.set(symbol, { url: null, expireAt: Date.now() + (retryAfterSec + 5) * 1000, reason: 'rate_limited' });
      return null;
    }
  } catch {
  }
  return null;
}

const CoinIcon: React.FC<CoinIconProps> = memo(({ symbol, size = 18, className }) => {
  const upperSymbol = symbol?.trim().toUpperCase() || '';

  const getInitialState = (): { localUri: string | null; localLum: number; localDone: boolean; cdnUrl: string | null; cdnDone: boolean; retryCount: number } => {
    if (!upperSymbol) return { localUri: null, localLum: -1, localDone: false, cdnUrl: null, cdnDone: false, retryCount: 0 };
    const localCached = localSvgCache.get(upperSymbol);
    if (localCached !== undefined) {
      if (localCached && localCached.uri.startsWith('data:image')) return { localUri: localCached.uri, localLum: localCached.lum, localDone: true, cdnUrl: null, cdnDone: false, retryCount: 0 };
      if (localCached) { localSvgCache.set(upperSymbol, null); }
      const cdnCached = cdnUrlCache.get(upperSymbol);
      if (cdnCached && (cdnCached.expireAt === 0 || cdnCached.expireAt > Date.now())) {
        return { localUri: null, localLum: -1, localDone: true, cdnUrl: cdnCached.url, cdnDone: true, retryCount: 0 };
      }
      return { localUri: null, localLum: -1, localDone: true, cdnUrl: null, cdnDone: false, retryCount: 0 };
    }
    return { localUri: null, localLum: -1, localDone: false, cdnUrl: null, cdnDone: false, retryCount: 0 };
  };

  type State = { localUri: string | null; localLum: number; localDone: boolean; cdnUrl: string | null; cdnDone: boolean; retryCount: number };
  const [state, dispatch] = useReducer(
    (prev: State, action: Partial<State>): State => ({ ...prev, ...action }),
    undefined as unknown as State,
    getInitialState
  );

  useEffect(() => {
    if (!upperSymbol || state.localDone) return;
    let cancelled = false;
    fetchLocalSvg(upperSymbol).then(entry => {
      if (!cancelled) {
        dispatch({ localUri: entry?.uri ?? null, localLum: entry?.lum ?? -1, localDone: true });
      }
    });
    return () => { cancelled = true; };
  }, [upperSymbol, state.localDone]);

  useEffect(() => {
    if (!upperSymbol || !state.localDone || state.cdnDone) return;
    if (state.localUri) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    fetchCdnUrl(upperSymbol).then(url => {
      if (cancelled) return;
      if (url) {
        dispatch({ cdnUrl: url, cdnDone: true });
        return;
      }
      const cached = cdnUrlCache.get(upperSymbol);
      if (cached && cached.reason === 'not_found') {
        dispatch({ cdnUrl: null, cdnDone: true });
        return;
      }
      const delay = cached ? Math.max(cached.expireAt - Date.now() + 100, 1000) : 5000;
      retryTimer = setTimeout(() => {
        if (!cancelled) dispatch({ retryCount: state.retryCount + 1 });
      }, delay);
    });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [upperSymbol, state.localDone, state.localUri, state.cdnDone, state.retryCount]);

  if (!upperSymbol) {
    return <FallbackIcon symbol={symbol} size={size} />;
  }

  if (state.localUri) {
    const backdropStyle: React.CSSProperties | undefined =
      state.localLum >= 0 && state.localLum < 0.35
        ? { backgroundColor: 'rgba(255, 255, 255, 0.22)' }
        : state.localLum > 0.7
          ? { backgroundColor: 'rgba(0, 0, 0, 0.25)' }
          : undefined;
    if (backdropStyle) {
      return (
        <span
          className={`inline-flex items-center justify-center rounded-full shrink-0 ${className || ''}`}
          style={{ width: size, height: size, ...backdropStyle }}
        >
          <img src={state.localUri} alt={upperSymbol} width={size} height={size} className="rounded-full" />
        </span>
      );
    }
    return (
      <img
        src={state.localUri}
        alt={upperSymbol}
        width={size}
        height={size}
        className={`rounded-full shrink-0 ${className || ''}`}
      />
    );
  }

  if (state.localDone && state.cdnUrl) {
    return (
      <img
        src={state.cdnUrl}
        alt={upperSymbol}
        width={size}
        height={size}
        className={`rounded-full shrink-0 ${className || ''}`}
      />
    );
  }

  if (state.localDone && state.cdnDone) {
    return <FallbackIcon symbol={symbol} size={size} />;
  }

  return <FallbackIcon symbol={symbol} size={size} />;
});

CoinIcon.displayName = 'CoinIcon';

export default CoinIcon;
