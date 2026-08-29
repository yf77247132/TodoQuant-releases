
export function instIdToTvSymbol(instId: string): string {
  const upper = instId.toUpperCase();
  if (upper.endsWith('-SWAP')) {
    const base = upper.replace(/-SWAP$/, '').replace(/-/g, '');
    return `OKX:${base}.P`;
  }
  if (upper.includes('-')) {
    const base = upper.replace(/-/g, '');
    return `OKX:${base}`;
  }
  return `BINANCE:${upper}.P`;
}

let pendingSymbol: string | null = null;

export function consumePendingTvSymbol(): string | null {
  const s = pendingSymbol;
  pendingSymbol = null;
  return s;
}

export function requestTvSymbol(tvSymbol: string): void {
  pendingSymbol = tvSymbol;
  window.dispatchEvent(new CustomEvent('tv-set-symbol', { detail: tvSymbol }));
}

export function jumpToTvChart(instId: string): void {
  const tvSymbol = instIdToTvSymbol(instId);
  requestTvSymbol(tvSymbol);
  window.dispatchEvent(new CustomEvent('navigate-module', { detail: 'market' }));
}
