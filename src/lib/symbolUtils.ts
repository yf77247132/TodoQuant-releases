
const normalizeSymbol = (s: string): string => s.toUpperCase().replace(/[-]/g, '');

export class SymbolUtils {
  static isSameSymbol(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return a === b;
    return normalizeSymbol(a) === normalizeSymbol(b);
  }
}
