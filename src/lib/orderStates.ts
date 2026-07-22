
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
