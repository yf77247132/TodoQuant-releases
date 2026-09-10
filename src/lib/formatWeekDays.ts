export function formatWeekDays(
  days: unknown,
  t: (key: string) => string
): string {
  if (!Array.isArray(days) || days.length === 0) return '';
  if (days.length === 7) return t('strategy.everyDay');
  const dayNames = t('strategy.dayNames').split(',').map(s => s.trim());
  return `${t('strategy.weekPrefix')}${[...(days as number[])]
    .sort((a, b) => a - b)
    .map((d: number) => dayNames[d] || '?')
    .join('')}`;
}
