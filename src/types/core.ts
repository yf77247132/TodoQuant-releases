
export enum Exchange {
  OKX = "OKX",
  BINANCE = "BINANCE",
  BYBIT = "BYBIT",
}

export interface ExchangeAccount {
  id: string;
  name: string;
  exchange: Exchange;
  color?: string;
  apiKey: string;
  secretKey: string;
  passphrase?: string;
  isEncrypted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AppConfig {
  accounts: ExchangeAccount[];
  masterKey?: string;

  accountNames?: Record<number, string>;
  accountColors?: Record<number, string>;
  accountExchanges?: Record<number, string>;

  accountOrder?: string[];

  triggerId?: string;
  actionId?: string;
  check_interval?: string;
  inst_id?: string;

  margin_guard_threshold?: string;
  margin_guard_check_interval?: string;
  margin_guard_max_rounds?: string;

  chart_settings?: string | TradingViewSettings;
  chart_watchlist?: string | string[];

  timezone?: string;
  default_email?: string;
  resend_api_key?: string;
  isSidebarCollapsed?: boolean;
  privacyMode?: boolean;
  autoOpenLog?: boolean;
  tab_shortcuts?: Record<string, string>;

  diy_strategies?: unknown[];
  diy_conditions?: unknown[];

  [key: string]: unknown;
}

export interface TradingViewSettings {
  symbol: string;
  interval: string;
}

export type PartialAppConfig = Partial<AppConfig>;
