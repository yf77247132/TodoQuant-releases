
import type { ModuleConfig } from './strategy.ts';

export interface PlaceConfigItem extends ModuleConfig {
  id: string;
  name: string;
  inst_id: string;
  account_id: string;
  order_type: string;
  side: string;
  pos_side: string;
  td_mode: string;
  tgt_ccy: string;
  order_direction: string;
  first_order_price: string;
  order_interval: string;
  order_count: string;
  contract_size: string;
  take_profit_margin: string;
  stop_loss_margin: string;
  first_tp_price: string;
  first_sl_price: string;
  chase_val: string;
  tp_sl_type: string;
  callback_ratio_spread: string;
  active_px: string;
  place_test_mode: boolean;
  skip_duplicate_orders: boolean;
}

export interface CancelConfigItem extends ModuleConfig {
  id: string;
  name: string;
  inst_id: string;
  account_id: string;
  order_types: string[];
  side: string;
  test_mode: boolean;
}

export interface AmendConfigItem extends ModuleConfig {
  id: string;
  name: string;
  inst_id: string;
  account_id: string;
  order_type: string;
  tp_sl_type: string;
  trigger_px_increment: string;
  tp_ord_px_increment: string;
  sl_ord_px_increment: string;
  px_increment: string;
  tp_px_increment: string;
  sl_px_increment: string;
  callback_ratio_spread: string;
  active_px: string;
  new_contract_size: string;
  test_mode: boolean;
}

export interface CloseConfigItem extends ModuleConfig {
  id: string;
  name: string;
  inst_id: string;
  account_id: string;
  mgn_mode: string;
  pos_side: string;
  upl_filter: string;
  upl_ratio_filter: string;
  test_mode: boolean;
  reverse: boolean;
  cancel_pending: boolean;
}

export interface MarginConfigItem extends ModuleConfig {
  id: string;
  name: string;
  account_id: string;
  margin_guard_redeem_amt: string;
  margin_payment_account: string;
  margin_to_account?: string;
  test_mode: boolean;
}
