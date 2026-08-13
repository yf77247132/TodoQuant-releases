
export const PENDING_NEW = 'PENDING_NEW' as const;

export interface OrderStateLike {
  state?: string | null;
  status?: string | null;
  [key: string]: unknown;
}

export function isPendingNewState(order: OrderStateLike): boolean {
  return order?.state === PENDING_NEW || order?.status === PENDING_NEW;
}

export function filterOutPendingNew<T extends OrderStateLike>(orders: T[]): T[] {
  return orders.filter((o) => !isPendingNewState(o));
}

export function filterDisplayableOrders<T extends OrderStateLike>(orders: T[]): T[] {
  return filterOutPendingNew(orders);
}

export function filterOperableOrders<T extends OrderStateLike>(orders: T[]): T[] {
  return filterOutPendingNew(orders);
}

export const ALGO_ORD_TYPES = new Set([
  'trigger',
  'conditional',
  'oco',
  'chase',
  'move_order_stop',
  'iceberg',
  'twap',
  'trailing_stop',
]);

export interface OrderTypeLike {
  ordType?: string | null;
  algoOrdType?: string | null;
  type?: string | null;
  orderType?: string | null;
  algoId?: string | null;
  [key: string]: unknown;
}

export function isAlgoOrderType(order: OrderTypeLike): boolean {
  const ordType = String(order.ordType || '').toLowerCase();
  const algoOrdType = String(order.algoOrdType || '').toLowerCase();
  return ALGO_ORD_TYPES.has(algoOrdType) || ALGO_ORD_TYPES.has(ordType);
}
