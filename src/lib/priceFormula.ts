
import FormulaParser from 'fast-formula-parser';

export interface FormulaResult {
  result: number | null;
  error?: string;
  errorCode?: string;
}

let _parser: FormulaParser | null = null;

function getParser(): FormulaParser {
  if (!_parser) {
    _parser = new FormulaParser();
  }
  return _parser;
}

export function isFormula(input: string): boolean {
  return typeof input === 'string' && input.startsWith('=') && input.length > 1;
}

export function formulaNeedsVar(formula: string, varName: string): boolean {
  const fml = formula.startsWith('=') ? formula.slice(1) : formula;
  return new RegExp(`\\b${varName}\\b`, 'gi').test(fml);
}

export function evaluateFormula(
  formula: string,
  variables: Record<string, number>
): FormulaResult {
  let expr = formula.replace(/^=/, '').trim();

  if (!expr) {
    return { result: null, errorCode: 'EMPTY_FORMULA' };
  }

  expr = expr.toUpperCase();
  for (const [varName, value] of Object.entries(variables)) {
    if (!Number.isFinite(value)) {
      return { result: null, errorCode: 'INVALID_VAR_VALUE', error: varName.toUpperCase() };
    }
    const regex = new RegExp(`\\b${varName}\\b`, 'gi');
    expr = expr.replace(regex, String(value));
  }

  try {
    const parser = getParser();
    const position = { row: 1, col: 1, sheet: 'formula' };
    const parsed = parser.parse(expr, position);

    if (parsed === undefined || parsed === null) {
      return { result: null, errorCode: 'NULL_RESULT' };
    }

    const num = Number(parsed);
    if (!Number.isFinite(num)) {
      return { result: null, errorCode: 'NOT_FINITE' };
    }

    return { result: num };
  } catch (e: unknown) {
    const err = e as Error;
    const msg = err.message || String(e);
    if (msg.includes('#DIV/0!')) {
      return { result: null, errorCode: 'DIV_ZERO' };
    }
    if (msg.includes('#NAME?') || msg.includes('is not implemented')) {
      return { result: null, errorCode: 'UNKNOWN_FUNCTION' };
    }
    if (msg.includes('#VALUE!')) {
      return { result: null, errorCode: 'VALUE_ERROR' };
    }
    if (msg.includes('#NUM!')) {
      return { result: null, errorCode: 'NUM_ERROR' };
    }
    return { result: null, errorCode: 'SYNTAX_ERROR', error: msg };
  }
}

export function formatPreview(formulaResult: FormulaResult, variables: Record<string, number>): string {
  if (formulaResult.error) {
    return formulaResult.error;
  }
  if (formulaResult.result !== null && Number.isFinite(formulaResult.result)) {
    const seen = new Set<string>();
    const varParts: string[] = [];
    for (const [k, v] of Object.entries(variables)) {
      const upper = k.toUpperCase();
      if (seen.has(upper)) continue;
      seen.add(upper);
      let rounded: number;
      if (Math.abs(v) >= 100) {
        rounded = Math.round(v * 100) / 100;
      } else if (Math.abs(v) >= 1) {
        rounded = Math.round(v * 1000) / 1000;
      } else if (Math.abs(v) >= 0.01) {
        rounded = Math.round(v * 1e6) / 1e6;
      } else {
        rounded = Math.round(v * 1e8) / 1e8;
      }
      varParts.push(`${upper}=${rounded}`);
    }
    const resultRounded = Math.round(formulaResult.result * 1e8) / 1e8;
    return `≈ ${resultRounded} (${varParts.join(', ')})`;
  }
  return '';
}

export function roundToTickSize(price: number, tickSz: number | null): number {
  if (tickSz === null || tickSz <= 0 || !Number.isFinite(price) || !Number.isFinite(tickSz)) {
    return price;
  }
  const ticks = Math.round(price / tickSz);
  const raw = ticks * tickSz;
  const decimalPlaces = getDecimalPlaces(tickSz);
  return parseFloat(raw.toFixed(decimalPlaces));
}

function getDecimalPlaces(n: number): number {
  const str = n.toString();
  if (str.includes('e') || str.includes('E')) {
    try {
      const fixed = n.toFixed(20);
      const dotIdx = fixed.indexOf('.');
      if (dotIdx < 0) return 0;
      const trimmed = fixed.replace(/0+$/, '');
      return trimmed.length - dotIdx - 1;
    } catch {
      return 8;
    }
  }
  const dotIdx = str.indexOf('.');
  if (dotIdx < 0) return 0;
  return str.length - dotIdx - 1;
}
