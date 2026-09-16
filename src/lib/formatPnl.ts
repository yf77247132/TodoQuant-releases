export const fmtPnl = (v: string | number | undefined | null): string => {
  if (v === undefined || v === null) return '-';
  const n = parseFloat(String(v));
  if (!Number.isFinite(n)) return '-';
  if (Math.abs(n) < 0.005) return '0';
  const truncated = Math.trunc(n * 100) / 100;
  if (truncated === 0) return '0';
  const s = truncated.toString();
  return n > 0 ? '+' + s : s;
};
