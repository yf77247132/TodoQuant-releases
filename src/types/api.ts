
import type { PartialAppConfig } from './core.ts';
import type { Exchange } from './core.ts';
import type { Account, Position, Order } from './trading.ts';

export interface ApiResponse<T = unknown> {
  ok?: boolean;
  error?: string;
  data?: T;
}

export interface ConfigResponse extends PartialAppConfig {
  ok?: boolean;
  error?: string;
}

export interface AccountsResponse {
  ok: boolean;
  data: AccountInfo[];
}

export interface AccountInfo {
  id: string;
  _account: number;
  name: string;
  exchange: Exchange;
  color: string;
}

export interface SnapshotResponse {
  ok: boolean;
  accounts: Account[];
  positions: Position[];
  accountNames?: Record<number, string>;
  accountColors?: Record<number, string>;
}

export interface OrdersResponse {
  ok: boolean;
  data: Order[];
}

export interface EnvStatusResponse {
  keys?: Record<string, boolean>;
}

export interface ModuleStatusResponse {
  running?: boolean;
  enabled?: boolean;
  lastRun?: string;
  nextRun?: string;
}
