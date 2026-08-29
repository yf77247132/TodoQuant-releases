
export type FreqtradeTimeframe =
  | '1m' | '3m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h' | '6h' | '8h' | '12h'
  | '1d' | '3d' | '1w' | '1M';

export interface FtProcessSpec {
  id: string;
  name: string;
  exchange: 'okx' | 'binance';
  pairWhitelist: string[];
  timeframe: FreqtradeTimeframe;
  stakeAmount: number;
  stakeCurrency: string;
  maxOpenTrades: number;
  dryRunWallet: number;
}

export interface FtProcessInfo {
  strategyId: string;
  // eslint-disable-next-line @typescript-eslint/no-restricted-imports -- ChildProcess 为 Node 内置类型
  process: import('child_process').ChildProcess;
  mode: 'live';
  configPath: string;
  startedAt: number;
  pid: number;
}

export interface FtDetectionResult {
  found: boolean;
  path?: string;
  version?: string;
}

export interface FtStartResult {
  ok: boolean;
  pid?: number;
  error?: string;
}

export interface FtLiveConfigOpts {
  strategyId: string;
  oktsPort: number;
  exchange: 'okx' | 'binance';
  pairWhitelist: string[];
  timeframe: FreqtradeTimeframe;
  stakeAmount: number;
  maxOpenTrades: number;
  stakeCurrency: string;
  dryRunWallet: number;
  tradingMode: 'futures' | 'spot';
}

export interface FtConfigJson {
  trading_mode: 'futures' | 'spot';
  margin_mode: 'isolated' | 'cross';
  max_open_trades: number;
  stake_currency: string;
  stake_amount: number;
  dry_run: true;
  dry_run_wallet: number;
  cancel_open_orders_on_exit: true;
  timeframe: FreqtradeTimeframe;
  exchange: {
    name: string;
    key: string;
    secret: string;
    pair_whitelist: string[];
    ccxt_config?: Record<string, unknown>;
    ccxt_async_config?: Record<string, unknown>;
  };
  entry_pricing: {
    price_side: string;
    use_order_book: boolean;
    order_book_top: number;
  };
  exit_pricing: {
    price_side: string;
    use_order_book: boolean;
    order_book_top: number;
  };
  webhook: {
    enabled: true;
    url: string;
    format: 'json';
    retries: number;
    entry: Record<string, string>;
    exit: Record<string, string>;
  };
  pairlists: Array<{ method: string; [k: string]: unknown }>;
  api_server?: {
    enabled: true;
    listen_ip_address: string;
    listen_port: number;
    username: string;
    password: string;
    jwt_secret_key: string;
  } | {
    enabled: false;
  };
  bot_name: string;
  user_data_dir: string;
  db_url?: string;
}

export interface TimeWindowSpec {
  startTime: string;
  endTime: string;
  days: number[];
}

export interface ConditionClassification {
  backtestableCount: number;
  liveOnlyCount: number;
  liveOnlyLabels: string[];
}

export interface FtBacktestParams {
  stoploss: number;
  minimalRoi: Record<string, number>;
  trailingStopEnabled: boolean;
  trailingStopPositive?: number;
  trailingOnlyOffsetIsReached?: boolean;
}

export type FreqtradeIndicator =
  | 'price'
  | 'volume'
  | 'RSI'
  | 'EMA'
  | 'MACD'
  | 'BB'
  | 'SMA'
  | 'ATR'
  | 'STOCH'
  | 'ADX'
  | 'MFI'
  | 'CCI'
  | 'VOL_MA';

export type FreqtradeOperator =
  | 'cross_above'
  | 'cross_below'
  | '>'
  | '<'
  | '>='
  | '<=';

export type PriceSource = 'close' | 'open' | 'high' | 'low' | 'volume';

export type MacdOutput = 'macd' | 'macdsignal' | 'macdhist';
export type BbOutput = 'lower' | 'mid' | 'upper';
export type StochOutput = 'slowk' | 'slowd';

export type Operand =
  | { kind: 'constant'; value: number }
  | { kind: 'price'; source: PriceSource }
  | { kind: 'indicator'; indicator: FreqtradeIndicator; output?: string };

export interface IndicatorCondition {
  category: 'indicator';
  indicator: FreqtradeIndicator;
  params: Record<string, number>;
  output?: MacdOutput | BbOutput | StochOutput | 'j';
  source?: PriceSource;
  timeframe?: FreqtradeTimeframe;
  pair?: string;
  operator: FreqtradeOperator;
  operand: Operand;
}

export interface ConditionGroup {
  logic: 'AND';
  children: IndicatorCondition[];
}

export interface FreqtradeStrategySpec {
  id: string;
  name: string;
  timeframe: FreqtradeTimeframe;
  entry: ConditionGroup;
  exit: ConditionGroup;
  stoploss: number;
  minimalRoi: Record<string, number>;
  tradingMode?: 'futures' | 'spot';
  timeWindows?: TimeWindowSpec[];
  backtest?: FtBacktestParams;
  pairWhitelist?: string[];
  tradingDirection?: 'long' | 'short';
}

export interface FtDownloadDataOpts {
  exchange: 'okx' | 'binance';
  pairWhitelist: string[];
  timeframes: FreqtradeTimeframe[];
  days: number;
  tradingMode?: 'futures' | 'spot';
}

export interface FtDownloadResult {
  ok: boolean;
  error?: string;
}

export interface FtBacktestRunOpts {
  exchange: string;
  pairWhitelist: string[];
  strategyName: string;
  timeframe: FreqtradeTimeframe;
  timerange: string;
  maxOpenTrades?: number;
  stakeAmount?: number;
  enableProtections?: boolean;
  dryRunWallet?: number;
  tradingMode?: 'futures' | 'spot';
  tradingDirection?: 'long' | 'short';
}

export interface FtBacktestResultSummary {
  strategy: string;
  profitTotal: number;
  profitTotalAbs: number;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  maxDrawdown: number;
  maxDrawdownAbs: number;
  drawdownStart?: string;
  drawdownEnd?: string;
  avgProfit: number;
  avgDuration: string;
  sharpe?: number;
  sortino?: number;
  calmar?: number;
  sqn?: number;
  profitFactor?: number;
  expectancy?: number;
  startingBalance?: number;
  finalBalance?: number;
  cagr?: number;
  tradeCountLong?: number;
  tradeCountShort?: number;
  profitMean?: number;
  backtestStart?: string;
  backtestEnd?: string;
}

export interface FtBacktestResultDetail {
  strategy: string;
  summary: FtBacktestResultSummary;
  trades: FtBacktestTrade[];
  dailyStats?: FtDailyStats[];
}

export interface FtBacktestTrade {
  pair: string;
  direction: 'long' | 'short';
  openDate: string;
  closeDate: string;
  openRate: number;
  closeRate: number;
  profit: number;
  profitRatio: number;
  exitReason: string;
  stakeAmount: number;
  duration: string;
  leverage?: number;
  enterTag?: string;
  exitTag?: string;
}

export interface FtDailyStats {
  date: string;
  profit: number;
  profitRatio: number;
  openTradeCount: number;
  balance: number;
}

export interface FtBacktestResult {
  ok: boolean;
  status: 'running' | 'stopped' | 'error';
  result?: FtBacktestResultDetail;
  error?: string;
}
