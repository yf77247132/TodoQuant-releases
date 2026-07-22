
export type OrderTypeValue =
  | 'limit'
  | 'market'
  | 'post_only'
  | 'fok'
  | 'ioc'
  | 'trigger'
  | 'conditional'
  | 'oco'
  | 'chase'
  | 'limit_maker'
  | 'stop_loss_limit'
  | 'take_profit_limit'
  | 'stop_market'
  | 'take_profit_market'
  | 'stop_loss'
  | 'take_profit'
  | 'trailing_stop_market'
  | 'move_order_stop';

export const ORDER_TYPE_LABEL_MAP: Record<OrderTypeValue, string> = {
  limit: 'order.typeLimit',
  market: 'order.typeMarket',
  post_only: 'order.typePostOnly',
  fok: 'order.typeFok',
  ioc: 'order.typeIoc',
  trigger: 'order.typeConditional',
  conditional: 'order.typeSingleTPSL',
  oco: 'order.typeOco',
  chase: 'order.typeChase',
  move_order_stop: 'order.typeTrailingStop',
  limit_maker: 'order.typeLimitMaker',
  stop_loss_limit: 'order.typeStopLimit',
  take_profit_limit: 'order.typeTakeProfitLimit',
  stop_market: 'order.typeStopMarket',
  take_profit_market: 'order.typeTakeProfitMarket',
  stop_loss: 'order.typeStopLoss',
  take_profit: 'order.typeTakeProfit',
  trailing_stop_market: 'order.typeTrailingStopMarket',
};

export const PLACE_ORDER_TYPE_VALUES: readonly OrderTypeValue[] = [
  'limit',
  'market',
  'post_only',
  'fok',
  'ioc',
  'trigger',
  'conditional',
  'oco',
  'chase',
  'move_order_stop',
];

export const AMEND_ORDER_TYPE_VALUES: readonly OrderTypeValue[] = [
  'trigger',
  'conditional',
  'oco',
  'limit',
  'move_order_stop',
];

export const CANCEL_ORDER_TYPE_VALUES: readonly OrderTypeValue[] = [
  'limit',
  'post_only',
  'conditional',
  'oco',
  'chase',
  'trigger',
  'move_order_stop',
];

function buildOptions(values: readonly OrderTypeValue[]): Array<{ label: string; value: OrderTypeValue }> {
  return values.map((value) => ({ value, label: ORDER_TYPE_LABEL_MAP[value] }));
}

export const PLACE_ORDER_TYPE_OPTIONS = buildOptions(PLACE_ORDER_TYPE_VALUES);
export const AMEND_ORDER_TYPE_OPTIONS = buildOptions(AMEND_ORDER_TYPE_VALUES);
export const CANCEL_ORDER_TYPE_OPTIONS = buildOptions(CANCEL_ORDER_TYPE_VALUES);

export function filterOrderTypesByContext(
  exchange: string | null | undefined,
  isSpot: boolean,
  tdMode: 'cash' | 'cross' | 'isolated' | null | undefined
): Array<{ value: OrderTypeValue; label: string }> {
  const ex = String(exchange || '').toUpperCase();
  return PLACE_ORDER_TYPE_OPTIONS.filter((opt) => {
    const val = opt.value;
    if (ex === 'OKX') {
      if (isSpot) {
        if (tdMode === 'cross' || tdMode === 'isolated') {
          if (val === 'chase' || val === 'trigger') return false;
        } else {
          if (val === 'chase') return false;
        }
      }
    } else if (ex === 'BINANCE') {
      if (isSpot) {
        if (tdMode === 'cross' || tdMode === 'isolated') {
          if (['post_only', 'fok', 'ioc', 'chase', 'trigger', 'move_order_stop'].includes(val)) return false;
        } else {
          if (['post_only', 'fok', 'ioc', 'chase', 'trigger'].includes(val)) return false;
        }
      } else {
        if (val === 'chase' || val === 'trigger' || val === 'oco') return false;
      }
    }
    return true;
  });
}

const ORDER_TYPE_ALIAS_TO_VALUE: Record<string, OrderTypeValue> = {
  '限价委托': 'limit',
  '市价委托': 'market',
  '限价-Post only': 'post_only',
  '限价-FOK': 'fok',
  '限价-IOC': 'ioc',
  '计划委托': 'trigger',
  '单向止盈止损': 'conditional',
  '双向止盈止损': 'oco',
  '追逐限价': 'chase',
  '移动止盈止损': 'move_order_stop',
  '止损限价': 'stop_loss_limit',
  '止盈限价': 'take_profit_limit',
  '止损市价': 'stop_market',
  '止盈市价': 'take_profit_market',
  '止损委托': 'stop_loss',
  '止盈委托': 'take_profit',
  '跟踪止损市价': 'trailing_stop_market',
  '限价委托（带止盈止损）': 'limit',
};

export function isOrderTypeValue(value: string): value is OrderTypeValue {
  return value in ORDER_TYPE_LABEL_MAP;
}

export function normalizeOrderType(input: string): OrderTypeValue | undefined {
  const raw = String(input || '').trim();
  if (isOrderTypeValue(raw)) return raw;
  return ORDER_TYPE_ALIAS_TO_VALUE[raw];
}

export function getOrderTypeLabel(input: string): string {
  const normalized = normalizeOrderType(input);
  return normalized ? ORDER_TYPE_LABEL_MAP[normalized] : input || 'order.typeUnknown';
}

export const OKX_ORDER_TYPE_DISPLAY: Record<string, string> = {
  market: '市价委托',
  limit: '限价委托',
  post_only: '限价-Post only',
  fok: '限价-FOK',
  ioc: '限价-IOC',
  trigger: '计划委托',
  conditional: '单向止盈止损',
  oco: '双向止盈止损',
  trailing_stop: '移动止盈止损',
  move_order_stop: '移动止盈止损',
  twap: '时间加权委托',
  stop_limit: '止损限价',
  take_profit_limit: '止盈限价',
  stop_market: '止损市价',
  take_profit_market: '止盈市价',
  stop_loss: '止损委托',
  take_profit: '止盈委托',
  trailing_stop_market: '跟踪止损市价',
};
