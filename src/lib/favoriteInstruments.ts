import { safeStorageGet, safeStorageSet } from './safeStorage.ts';

export interface FavoriteInstrument {
  instId: string;
  instType: 'SPOT' | 'SWAP';
}

const DEFAULT_FAVORITES: Record<string, FavoriteInstrument[]> = {
  OKX: [
    { instId: 'BTC-USDT-SWAP', instType: 'SWAP' },
    { instId: 'ETH-USDT-SWAP', instType: 'SWAP' },
    { instId: 'SOL-USDT-SWAP', instType: 'SWAP' },
    { instId: 'BTC-USDT', instType: 'SPOT' },
    { instId: 'ETH-USDT', instType: 'SPOT' },
  ],
  BINANCE: [
    { instId: 'BTC-USDT', instType: 'SPOT' },
    { instId: 'ETH-USDT', instType: 'SPOT' },
    { instId: 'BTC-USDT-SWAP', instType: 'SWAP' },
    { instId: 'ETH-USDT-SWAP', instType: 'SWAP' },
  ],
};

const STORAGE_KEY_PREFIX = 'favoriteInstruments_';

function key(exchange: string | null | undefined): string {
  return STORAGE_KEY_PREFIX + String(exchange || 'OKX').toUpperCase();
}

export function parseTvWatchlist(tvSymbols: string[]): FavoriteInstrument[] {
  const result: FavoriteInstrument[] = [];
  for (const s of tvSymbols) {
    const colonIdx = s.indexOf(':');
    if (colonIdx === -1) continue;

    const symbol = s.slice(colonIdx + 1);

    const isPerp = symbol.endsWith('.P') || symbol.includes('-SWAP') || symbol.includes('swap');
    const clean = isPerp ? symbol.replace(/\.P$/i, '') : symbol;
    const alreadySwap = /-SWAP$/i.test(clean);

    let instId: string;
    if (clean.includes('-')) {
      instId = clean;
    } else {
      const match = clean.match(/^(.+?)(USDT|USDC|BTC|ETH|BUSD|USD)$/i);
      if (match) {
        instId = `${match[1]}-${match[2]}`;
      } else {
        instId = clean;
      }
    }
    if (isPerp && !alreadySwap) instId += '-SWAP';

    const instType = isPerp ? 'SWAP' : 'SPOT';

    if (!result.find(r => r.instId === instId)) {
      result.push({ instId, instType });
    }
  }
  return result;
}

export function setWatchlistToFavorites(tvSymbols: string[]): void {
  const parsed = parseTvWatchlist(tvSymbols);
  if (parsed.length === 0) return;

  const byExchange: Record<string, FavoriteInstrument[]> = {};
  for (const instrument of parsed) {
    const ex = tvSymbols.find(ts => {
      const idx = ts.indexOf(':');
      return idx > 0 && ts.slice(0, idx).toUpperCase();
    }) || 'OKX';

    const exKey = 'OKX';
    if (!byExchange[exKey]) byExchange[exKey] = [];
    if (!byExchange[exKey].find(f => f.instId === instrument.instId)) {
      byExchange[exKey].push(instrument);
    }
  }

  for (const [ex, list] of Object.entries(byExchange)) {
    safeStorageSet(key(ex), list);
  }
}

export function getFavoriteInstruments(exchange?: string | null): FavoriteInstrument[] {
  const ex = String(exchange || 'OKX').toUpperCase();
  const stored = safeStorageGet<FavoriteInstrument[]>(key(ex), []);
  if (Array.isArray(stored) && stored.length > 0) {
    return stored;
  }
  return DEFAULT_FAVORITES[ex] || DEFAULT_FAVORITES.OKX;
}

export function addFavoriteInstrument(instId: string, instType: 'SPOT' | 'SWAP', exchange?: string): void {
  const list = getFavoriteInstruments(exchange).filter(f => f.instId !== instId);
  list.unshift({ instId, instType });
  safeStorageSet(key(exchange), list);
}

export function removeFavoriteInstrument(instId: string, exchange?: string): void {
  const list = getFavoriteInstruments(exchange).filter(f => f.instId !== instId);
  safeStorageSet(key(exchange), list);
}

export function setFavoriteInstruments(list: FavoriteInstrument[], exchange?: string): void {
  safeStorageSet(key(exchange), list);
}
