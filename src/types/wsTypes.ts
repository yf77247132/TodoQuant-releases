
import type { OKXOrder, OKXAlgoOrder, OKXPosition } from './okx.ts';
import type { Position } from './trading.ts';

export interface WSMessage {
  event?: string;
  code?: string;
  msg?: string;
  arg?: WSMessageArg;
  data?: WSDataItem[];
}

export interface WSMessageArg {
  channel: string;
  instId?: string;
}

export type WSDataItem = OKXOrder | OKXAlgoOrder | Partial<OKXPosition> | WSOrderAccount;

export interface WSOrderAccount {
  _account?: number;
  [key: string]: unknown;
}

export interface WSStatusPayload {
  type: 'ws_status';
  account: number;
  connected: boolean;
  status?: string;
}

export interface WSLoginMessage extends WSMessage {
  event: 'login';
  code: string;
}

export interface WSErrorMessage extends WSMessage {
  event: 'error';
  code: string;
  msg: string;
}

export type WsAppMessageType =
  | 'ws_status'
  | 'log'
  | 'savings'
  | 'asset_valuation'
  | 'script_status'
  | 'batch'
  | 'accounts_changed'
  | 'system_info'
  | 'order_sync'
  | 'positions_update'
  | 'account_update'
  | 'market_tickers';

export interface WsLogPayload {
  type: 'log';
  timestamp: number;
  level?: string;
  message: string;
  source?: string;
  account?: number;
  details?: Record<string, unknown>;
}

export interface WsSavingsPayload {
  type: 'savings';
  ok: boolean;
  account: number;
  balances: { USDT?: string; USDC?: string };
}

export interface WsAssetValuationPayload {
  type: 'asset_valuation';
  ok: boolean;
  account: number;
  valuation: { totalBal: string; funding: string; trading: string; earn: string };
}

export interface WsScriptStatusPayload {
  type: 'script_status';
  scriptType: string;
  configId?: string;
  running: boolean;
  timestamp?: number;
}

export interface WsBatchPayload {
  type: 'batch';
  messages: WebSocketMessage[];
}

export interface WsAccountsChangedPayload {
  type: 'accounts_changed';
}

export interface WsSystemInfoPayload {
  type: 'system_info';
  timezone?: string;
}

export interface WsOrderSyncPayload {
  type: 'order_sync';
  counts?: Record<string, number>;
  timestamp?: number;
}

export interface WsPositionsUpdatePayload {
  type: 'positions_update';
  account: number;
  data: Array<Partial<Position> & { _account?: number; _accountId?: string }>;
}

export interface WsAccountUpdatePayload {
  type: 'account_update';
  account: number;
  balances: Record<string, unknown> & { _accountId?: string };
}

export interface WsMarketTickersPayload {
  type: 'market_tickers';
  data: {
    exchange: string;
    tickers: Array<{
      instId: string;
      last: number;
      open24h: number;
      sodUtc8: number;
      change24h: number;
      changeToday: number;
    }>;
    total: number;
    fetchedAt: number;
  };
}

export type WebSocketMessage =
  | WSStatusPayload
  | WsLogPayload
  | WsSavingsPayload
  | WsAssetValuationPayload
  | WsScriptStatusPayload
  | WsBatchPayload
  | WsAccountsChangedPayload
  | WsSystemInfoPayload
  | WsOrderSyncPayload
  | WsPositionsUpdatePayload
  | WsAccountUpdatePayload
  | WsMarketTickersPayload
  | ({ type: string } & Record<string, unknown>);
