
export type ConditionType =
  | "balance_less"
  | "pos_count"
  | "pos_side"
  | "pos_pnl_amount"
  | "pos_pnl_rate"
  | "pos_margin"
  | "pos_mgn_ratio_val"
  | "pos_sz_limit"
  | "pos_pnl_limit"
  | "pos_margin_less"
  | "pos_mgn_ratio"
  | "pos_liq_dist"
  | "pos_funding_rate"
  | "time_window"
  | "cooldown"
  | "count_limit"
  | "consecutive_loss"
  | "check_interval"
  | "tv_signal"
  | "indicator";

export interface ConditionBlock {
  id: string;
  category: "account" | "position" | "time" | "control" | "signal" | "indicator";
  type: ConditionType;
  params: Record<string, unknown>;
}

export interface ConditionTemplate {
  id: string;
  name: string;
  exchange?: 'okx' | 'binance';
  timeframe?: string;
  conditions: ConditionBlock[];
  createdAt: number;
}

export type ActionType =
  | "place_order"
  | "amend_order"
  | "cancel_order"
  | "close_pos"
  | "prevent_margin_risk"
  | "stop_strategy"
  | "notify"
  | "transfer";

export interface ActionBlock {
  id: string;
  type: ActionType;
  targetConfigId?: string;
  params: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DIYStrategy {
  id: string;
  name: string;
  conditionTemplateId: string;
  actions: ActionBlock[];
  running: boolean;
  testMode: boolean;
  createdAt: number;
  shortcut_key?: string;
  lastTriggered?: number;
  triggerCount?: number;
  liveStates?: { result: boolean; currentVal: string }[];
  freqtradeSpec?: import('./freqtrade.ts').FreqtradeStrategySpec;
}
