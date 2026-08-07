
import { Request, Response, NextFunction } from 'express';
import { ErrorMonitor } from '../services/errorMonitor.ts';

const REGEX = {
  STRICT_NUMBER: /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/,
  MARGIN_VALUE: /^-?(?:\d+\.?\d*|\.\d+)%?$/,
  NON_NEGATIVE_INTEGER: /^\d+$/,
  API_KEY: /^[a-zA-Z0-9-]+$/,
  INSTRUMENT_ID: /^[A-Z0-9]+-[A-Z0-9]+(-[A-Z0-9]+)?$/i,
  HEX_COLOR: /^#[0-9A-Fa-f]{6}$/,
  WHITESPACE: /\s/,
} as const;

const FLOAT_TOLERANCE = 1e-6;

const SENSITIVE_FIELDS = new Set([
  'apiKey',
  'secretKey',
  'passphrase',
  'key',
  'api_key',
  'secret_key',
  'apiSecret',
  'api_secret',
]);

export class ValidationError extends Error {
  constructor(public field: string, public message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function normalizeUnknownError(error: unknown, fallbackMessage: string = 'Unknown error'): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string' && error.trim()) return new Error(error);
  return new Error(fallbackMessage);
}

function sanitizeRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_FIELDS.has(key) && typeof value === 'string' && value.length > 0) {
      sanitized[key] = value.length > 6
        ? `${value.slice(0, 4)}***${value.slice(-2)}`
        : '••••••';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

function parseStrictNumber(value: unknown, fieldName: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError(fieldName, `${fieldName} 必须是有限数字`);
    }
    if (!Number.isSafeInteger(value) && Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new ValidationError(fieldName, `${fieldName} 数值超出安全范围`);
    }
    return value;
  }

  if (value === null || value === undefined) {
    throw new ValidationError(fieldName, `${fieldName} 不能为空`);
  }

  const raw = String(value).trim();
  if (!REGEX.STRICT_NUMBER.test(raw)) {
    throw new ValidationError(fieldName, `${fieldName} 必须是有效的数字`);
  }

  const num = Number(raw);
  if (!Number.isFinite(num)) {
    throw new ValidationError(fieldName, `${fieldName} 必须是有限数字`);
  }

  if (!Number.isSafeInteger(num) && Math.abs(num) > Number.MAX_SAFE_INTEGER) {
    throw new ValidationError(fieldName, `${fieldName} 数值超出安全范围`);
  }

  return num;
}

export function validateNumberRange(value: unknown, fieldName: string, min?: number, max?: number, required: boolean = false): void {
  if (value === null || value === undefined || value === '') {
    if (required) {
      throw new ValidationError(fieldName, `${fieldName} 不能为空`);
    }
    return;
  }

  const num = parseStrictNumber(value, fieldName);

  if (Math.abs(num - (-1)) < FLOAT_TOLERANCE) {
    return;
  }

  if (min !== undefined && num < min - FLOAT_TOLERANCE) {
    throw new ValidationError(fieldName, `${fieldName} 不能小于 ${min}`);
  }

  if (max !== undefined && num > max + FLOAT_TOLERANCE) {
    throw new ValidationError(fieldName, `${fieldName} 不能大于 ${max}`);
  }
}

export function validateMarginValue(value: unknown, fieldName: string): void {
  if (value === null || value === undefined || value === '') return;

  const raw = String(value).trim();
  if (raw === '-1') return;
  if (!REGEX.MARGIN_VALUE.test(raw)) {
    throw new ValidationError(fieldName, `${fieldName} 必须是有效数值或百分比（如 10 或 10%）`);
  }
  const isPct = raw.endsWith('%');
  const num = parseFloat(isPct ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(num) || (num < -FLOAT_TOLERANCE && !isPct)) {
    throw new ValidationError(fieldName, `${fieldName} 必须是非负数`);
  }
}

export function validateStringLength(value: unknown, fieldName: string, min?: number, max?: number, required: boolean = false): void {
  if (value === null || value === undefined || value === '') {
    if (required) {
      throw new ValidationError(fieldName, `${fieldName} 不能为空`);
    }
    return;
  }

  const str = String(value);
  if (min !== undefined && str.length < min) {
    throw new ValidationError(fieldName, `${fieldName} 长度不能少于 ${min} 个字符（当前 ${str.length} 位）`);
  }

  if (max !== undefined && str.length > max) {
    throw new ValidationError(fieldName, `${fieldName} 长度不能超过 ${max} 个字符（当前 ${str.length} 位）`);
  }
}

export function validateEnum(value: unknown, fieldName: string, allowedValues: readonly string[], required: boolean = false): void {
  if (value === null || value === undefined || value === '') {
    if (required) {
      throw new ValidationError(fieldName, `${fieldName} 不能为空`);
    }
    return;
  }

  if (!allowedValues.includes(String(value))) {
    throw new ValidationError(fieldName, `${fieldName} 必须是以下值之一: ${allowedValues.join(', ')}`);
  }
}

export function validateRegex(value: unknown, fieldName: string, pattern: RegExp, errorMessage: string, required: boolean = false): void {
  if (value === null || value === undefined || value === '') {
    if (required) {
      throw new ValidationError(fieldName, `${fieldName} 不能为空`);
    }
    return;
  }

  if (!pattern.test(String(value))) {
    throw new ValidationError(fieldName, `${fieldName} ${errorMessage}`);
  }
}

export function validateApiKey(value: unknown, fieldName: string): void {
  validateStringLength(value, fieldName, 16, 64, true);
  validateRegex(value, fieldName, REGEX.API_KEY, '只能包含字母、数字和连字符', true);
}

export function validateInstrumentId(value: unknown, fieldName: string): void {
  if (!value) return;
  validateRegex(
    value,
    fieldName,
    REGEX.INSTRUMENT_ID,
    '格式应为 COIN-CURRENCY 或 COIN-CURRENCY-TYPE（如 BTC-USDT 或 BTC-USDT-SWAP）',
    false
  );
}

export function validateColor(value: unknown, fieldName: string): void {
  if (!value) return;
  validateRegex(value, fieldName, REGEX.HEX_COLOR, '必须是有效的 HEX 颜色（如 #F0B90B）', false);
}

export function validateAccountIndex(value: unknown, fieldName: string): number {
  if (value === null || value === undefined) {
    throw new ValidationError(fieldName, `${fieldName} 不能为空`);
  }

  const raw = String(value).trim();
  if (!REGEX.NON_NEGATIVE_INTEGER.test(raw)) {
    throw new ValidationError(fieldName, `${fieldName} 必须是有效的非负整数`);
  }

  const index = Number(raw);
  if (!Number.isSafeInteger(index)) {
    throw new ValidationError(fieldName, `${fieldName} 超出安全整数范围`);
  }

  return index;
}

export function validateMasterKey(value: unknown): void {
  if (value === null || value === undefined || value === '') {
    throw new ValidationError('key', 'Master Key 不能为空');
  }

  validateStringLength(value, 'key', 6, 128, true);

  if (REGEX.WHITESPACE.test(String(value))) {
    throw new ValidationError('key', 'Master Key 不能包含空格或换行');
  }
}

export function validateModuleConfig(config: Record<string, unknown>): void {
  if (config === null || config === undefined) {
    throw new ValidationError('config', '配置对象不能为空');
  }

  if (typeof config !== 'object') {
    throw new ValidationError('config', '配置必须是有效的对象');
  }

  if (config.account_id !== undefined) {
    validateStringLength(config.account_id, 'account_id', 1, undefined, true);
  }

  if (config.check_interval !== undefined) {
    validateNumberRange(config.check_interval, 'check_interval', 1, 3600, true);
  }

  if (config.inst_id !== undefined) {
    validateInstrumentId(config.inst_id, 'inst_id');
  }

  if (config.order_interval !== undefined) {
    validateNumberRange(config.order_interval, 'order_interval', 0, 1000000);
  }

  if (config.first_order_price !== undefined) {
    validateNumberRange(config.first_order_price, 'first_order_price', 0, 1000000000);
  }

  if (config.order_count !== undefined) {
    validateNumberRange(config.order_count, 'order_count', 1, 1000);
    if (!Number.isInteger(Number(config.order_count))) {
      throw new ValidationError('order_count', '必须是整数');
    }
  }

  if (config.contract_size !== undefined) {
    validateNumberRange(config.contract_size, 'contract_size', 0.00000001, 1000000000);
  }

  if (config.leverage !== undefined) {
    validateNumberRange(config.leverage, 'leverage', 1, 125);
    if (!Number.isInteger(Number(config.leverage))) {
      throw new ValidationError('leverage', '必须是整数');
    }
  }

  const isTrigger = config.order_type === 'trigger';
  const isConditional = config.order_type === 'conditional';
  const isOCO = config.order_type === 'oco';

  const tpSlNotApplicable = ['market', 'conditional', 'move_order_stop'];
  if (isTrigger || !tpSlNotApplicable.includes(config.order_type || '')) {
    if (config.tp_sl_type === 'move_stop') {
      if (config.callback_ratio !== undefined && config.callback_ratio !== '-1') {
        validateNumberRange(config.callback_ratio, 'callback_ratio', 0.0001, 1);
      }
      if (config.callback_spread !== undefined && config.callback_spread !== '-1') {
        validateNumberRange(config.callback_spread, 'callback_spread', 0.00000001, 1000000000);
      }
      if (config.active_px !== undefined && config.active_px !== '-1') {
        validateNumberRange(config.active_px, 'active_px', 0.00000001, 1000000000);
      }
    }
    if (config.stop_loss_margin !== undefined) {
      validateMarginValue(config.stop_loss_margin, 'stop_loss_margin');
    }
    if (config.tp_sl_type !== 'move_stop' && config.take_profit_margin !== undefined) {
      validateMarginValue(config.take_profit_margin, 'take_profit_margin');
    }
  }

  if (isConditional || isOCO) {
    if (config.first_tp_price !== undefined) {
      validateNumberRange(config.first_tp_price, 'first_tp_price', -1, 1000000000);
    }
    if (config.first_sl_price !== undefined) {
      validateNumberRange(config.first_sl_price, 'first_sl_price', -1, 1000000000);
    }
  }

  if (config.td_mode !== undefined) {
    validateEnum(config.td_mode, 'td_mode', ['cross', 'isolated', 'cash']);
  }

  if (config.order_direction !== undefined) {
    validateEnum(config.order_direction, 'order_direction', ['up', 'down']);
  }

  if (config.amend_inst_id !== undefined) {
    validateInstrumentId(config.amend_inst_id, 'amend_inst_id');
  }

  if (config.tp_ord_px_increment !== undefined) {
    validateNumberRange(config.tp_ord_px_increment, 'tp_ord_px_increment', 0.00000001, 1000000000);
  }

  if (config.sl_ord_px_increment !== undefined) {
    validateNumberRange(config.sl_ord_px_increment, 'sl_ord_px_increment', 0.00000001, 1000000000);
  }

  if (config.trigger_px_increment !== undefined) {
    validateNumberRange(config.trigger_px_increment, 'trigger_px_increment', -1000000000, 1000000000);
  }

  if (config.px_increment !== undefined) {
    validateNumberRange(config.px_increment, 'px_increment', -1000000000, 1000000000);
  }

  if (config.tp_px_increment !== undefined) {
    validateNumberRange(config.tp_px_increment, 'tp_px_increment', -1000000000, 1000000000);
  }

  if (config.sl_px_increment !== undefined) {
    validateNumberRange(config.sl_px_increment, 'sl_px_increment', -1000000000, 1000000000);
  }

  if (config.new_contract_size !== undefined) {
    validateNumberRange(config.new_contract_size, 'new_contract_size', 0.00000001, 1000000000);
  }

  if (config.margin_guard_redeem_amt !== undefined) {
    validateNumberRange(config.margin_guard_redeem_amt, 'margin_guard_redeem_amt', 0.01, 100000);
  }

  if (config.price_gap_threshold !== undefined) {
    validateNumberRange(config.price_gap_threshold, 'price_gap_threshold', 0, 10000);
  }

  if (config.margin_ratio_threshold !== undefined) {
    validateNumberRange(config.margin_ratio_threshold, 'margin_ratio_threshold', 0, 1);
  }
}

export function validateAccountCreate(data: Record<string, unknown>): void {
  if (data === null || data === undefined) {
    throw new ValidationError('data', '请求数据不能为空');
  }

  validateStringLength(data.name, 'name', 1, 50, true);
  validateStringLength(data.apiKey, 'apiKey', 16, 64, true);
  validateStringLength(data.secretKey, 'secretKey', 16, 64, true);

  validateEnum(data.exchange, 'exchange', ['OKX', 'BINANCE'], true);

  if (data.passphrase !== undefined && data.passphrase !== null && data.passphrase !== '') {
    validateStringLength(data.passphrase, 'passphrase', 1, 64, false);
  }

  if (data.color !== undefined) {
    validateColor(data.color, 'color');
  }
}

export function validateOrderCancelPayload(data: Record<string, unknown> | undefined): void {
  if (data === null || data === undefined) {
    throw new ValidationError('data', '请求数据不能为空');
  }

  validateAccountIndex(data.accountIdx, 'accountIdx');
  validateStringLength(data.instId, 'instId', 3, 64, true);

  const hasOrdId = !!(data.ordId && String(data.ordId).trim());
  const hasAlgoId = !!(data.algoId && String(data.algoId).trim());

  if (!hasOrdId && !hasAlgoId) {
    throw new ValidationError('ordId/algoId', 'ordId 和 algoId 至少提供一个');
  }
}

export function validatePositionClosePayload(data: Record<string, unknown> | undefined): void {
  if (data === null || data === undefined) {
    throw new ValidationError('data', '请求数据不能为空');
  }

  validateAccountIndex(data.accountIdx, 'accountIdx');
  validateStringLength(data.instId, 'instId', 3, 64, true);

  if (data.mgnMode !== undefined && data.mgnMode !== '') {
    validateEnum(data.mgnMode, 'mgnMode', ['cross', 'isolated', 'cash']);
  }

  if (data.posSide !== undefined && data.posSide !== '') {
    validateEnum(data.posSide, 'posSide', ['long', 'short', 'net']);
  }
}

function createValidationMiddleware<T extends Record<string, unknown>>(
  validator: (body: T) => void,
  errorMonitorMethod: 'captureValidationError' | 'captureAuthError' = 'captureValidationError'
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      validator(req.body as T);
      next();
    } catch (error: unknown) {
      const normalizedError = normalizeUnknownError(error, '参数验证失败');

      if (error instanceof ValidationError) {
        const sanitizedBody = sanitizeRequestBody(req.body as Record<string, unknown>);

        try {
          ErrorMonitor[errorMonitorMethod](
            error,
            {
              field: error.field,
              requestBody: sanitizedBody,
              path: req.path
            },
            'inputValidation'
          );
        } catch (monitorErr) {
          console.error('[inputValidation] ErrorMonitor 记录失败:', (monitorErr as Error).message);
        }

        res.status(400).json({
          ok: false,
          error: `[USER] ${error.message}`,
          category: 'USER',
          details: { field: error.field, message: error.message }
        });
        return;
      }

      const sanitizedBody = sanitizeRequestBody(req.body as Record<string, unknown>);

      try {
        ErrorMonitor[errorMonitorMethod](
          normalizedError,
          {
            requestBody: sanitizedBody,
            path: req.path
          },
          'inputValidation'
        );
      } catch (monitorErr) {
        console.error('[inputValidation] ErrorMonitor 记录失败:', (monitorErr as Error).message);
      }

      res.status(400).json({
        ok: false,
        error: '参数验证失败',
        details: normalizedError.message
      });
    }
  };
}

export const validateOrderCancelMiddleware = createValidationMiddleware(validateOrderCancelPayload);

export const validatePositionCloseMiddleware = createValidationMiddleware(validatePositionClosePayload);

export const validateModuleConfigMiddleware = createValidationMiddleware(validateModuleConfig);

export const validateAccountCreateMiddleware = createValidationMiddleware(validateAccountCreate);

export const validateMasterKeyMiddleware = createValidationMiddleware(
  (body: { key?: unknown }) => validateMasterKey(body.key),
  'captureAuthError'
);
