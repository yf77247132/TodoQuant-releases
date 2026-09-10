import { ftPairToOkxPair } from '../freqtrade/strategyGenerator.ts';

export function signalPairToInstId(raw: string): string {
  const p = raw.trim();
  if (!p || !/[-\/]/.test(p)) return '';
  try {
    return ftPairToOkxPair(p);
  } catch {
    return '';
  }
}
