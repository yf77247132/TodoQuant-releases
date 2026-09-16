declare module 'fast-formula-parser' {
  interface ParsePosition {
    row: number;
    col: number;
    sheet: string;
  }

  class FormulaParser {
    constructor(options?: { onCell?: (ref: unknown) => unknown; onRange?: (ref: unknown) => unknown });
    parse(formula: string, position: ParsePosition): unknown;
  }

  export default FormulaParser;
}
