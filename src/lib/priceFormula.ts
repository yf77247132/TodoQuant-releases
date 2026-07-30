
import FormulaParser from 'fast-formula-parser';
import { fetchMarketPrice } from './marketPrice.ts';

export interface FormulaResult {
  result: number | null;
  error?: string;
  errorCode?: string;
}

export interface FormulaVariablesParams {
  instId?: string;
  firstOrderPrice?: number;
  n?: number;
  positionSize?: number;
  originalSize?: number;
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

export async function buildFormulaVariables(
  formula: string,
  params: FormulaVariablesParams,
  cachedVars?: Record<string, number>
): Promise<{ variables: Record<string, number>; error?: string; errorCode?: string }> {
  const variables: Record<string, number> = { ...cachedVars };
  const fml = formula.startsWith('=') ? formula.slice(1) : formula;

  if (formulaNeedsVar(fml, 'M') && !variables.M) {
    if (!params.instId) {
      return { variables, errorCode: 'MISSING_INST_ID' };
    }
    const marketPrice = await fetchMarketPrice(params.instId);
    if (marketPrice === null) {
      return { variables, errorCode: 'MARKET_PRICE_UNAVAILABLE' };
    }
    variables.M = marketPrice;
  }

  if (formulaNeedsVar(fml, 'O') && !variables.O) {
    if (params.firstOrderPrice === undefined || params.firstOrderPrice === null) {
      return { variables, errorCode: 'MISSING_ORDER_PRICE' };
    }
    if (!Number.isFinite(params.firstOrderPrice)) {
      return { variables, errorCode: 'INVALID_ORDER_PRICE' };
    }
    variables.O = params.firstOrderPrice;
  }

  if (formulaNeedsVar(fml, 'N')) {
    if (params.n === undefined || params.n === null) {
    } else if (!Number.isFinite(params.n)) {
      return { variables, errorCode: 'INVALID_N' };
    } else {
      variables.N = params.n;
    }
  }

  if (formulaNeedsVar(fml, 'S')) {
    if (params.positionSize === undefined || params.positionSize === null) {
      return { variables, errorCode: 'MISSING_POSITION' };
    }
    if (!Number.isFinite(params.positionSize)) {
      return { variables, errorCode: 'INVALID_POSITION' };
    }
    variables.S = params.positionSize;
  }

  if (formulaNeedsVar(fml, 'SZ')) {
    if (params.originalSize === undefined || params.originalSize === null) {
      return { variables, errorCode: 'MISSING_ORIGINAL_SIZE' };
    }
    if (!Number.isFinite(params.originalSize)) {
      return { variables, errorCode: 'INVALID_ORIGINAL_SIZE' };
    }
    variables.SZ = params.originalSize;
  }

  return { variables };
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
