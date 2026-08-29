
import type { OKXPosition } from './okx.ts';
import type { TradeOrder } from './trade.ts';

export type { OKXPosition, TradeOrder };

export type AccountOrder = TradeOrder;

export interface AccountData {
  accountIdx: number;
  positions: OKXPosition[];
  orders: AccountOrder[];
  balances: AccountBalances | null;
  lastUpdate: number;
}

export interface AccountBalances {
  totalEq?: string;
  adjEq?: string;
  isoEq?: string;
  mgnRatio?: string;
  details?: Array<{
    ccy: string;
    availBal?: string;
    cashBal?: string;
    eq?: string;
    eqUsd?: string;
    frozenBal?: string;
    upl?: string;
  }>;
  [key: string]: unknown;
}

export interface MonitorConfig {
  accountIdx: number;
  checkInterval: number;
}
