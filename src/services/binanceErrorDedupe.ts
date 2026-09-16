
const _binanceErrorDedupe = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  const cutoff = now - 30000;
  for (const [k, v] of _binanceErrorDedupe) {
    if (v < cutoff) _binanceErrorDedupe.delete(k);
  }
}, 5 * 60 * 1000).unref();

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
