
const normalizeSymbol = (s: string): string => s.toUpperCase().replace(/[-]/g, '');

export class SymbolUtils {
  static isSameSymbol(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return a === b;
    return normalizeSymbol(a) === normalizeSymbol(b);
  }

  static isSpotInstId(instId: string | null | undefined): boolean {
    if (!instId) return false;
    return !instId.endsWith('-SWAP') && !instId.endsWith('-FUTURES') && instId.split('-').length === 2;
  }
}
