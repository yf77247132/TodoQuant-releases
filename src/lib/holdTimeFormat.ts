const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

export function fmtHoldTimeThreshold(value: unknown, unit?: string): string {
  const n = parseFloat(String(value ?? ''));
  if (!Number.isFinite(n) || n < 0) return '0m';
  const ms = n * (UNIT_MS[unit ?? 'hour'] ?? 3_600_000);
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}
