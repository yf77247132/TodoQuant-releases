
import type { ModuleConfig } from './strategy.ts';
import type { TradeOrder } from './trade.ts';
import type { PlaceOrderParams, AmendOrderParams } from './okx.ts';

export interface ActionPlaceOrderParams extends PlaceOrderParams {
  mgnMode?: string;
  posSide?: string;
  triggerPx?: string;
  orderPrice?: string;
  firstOrderPrice?: string;
  orderInterval?: string;
  orderCount?: string;
  contractSize?: string;
  takeProfitMargin?: string;
  stopLossMargin?: string;
  firstTpPrice?: string;
  firstSlPrice?: string;
  chaseVal?: string;
  callbackRatio?: string;
  callbackSpread?: string;
  activePx?: string;
  clOrdId?: string;
  tag?: string;
  px?: string;
  reduceOnly?: boolean;
  tgtCcy?: string;
  banAmend?: boolean;
  [key: string]: unknown;
}

export interface ActionAmendOrderParams extends AmendOrderParams {
  tdMode?: string;
  side?: string;
  tpIncrement?: number;
  slIncrement?: number;
  callbackRate?: string;
  tpPxIncrement?: string;
  slPxIncrement?: string;
  [key: string]: unknown;
}

export interface ActionAttachAlgoOrd {
  attachAlgoId?: string;
  attachAlgoClOrdId?: string;
  tpTriggerPx?: string;
  tpOrdPx?: string;
  slTriggerPx?: string;
  slOrdPx?: string;
  newTpTriggerPx?: string;
  newTpTriggerPxType?: string;
  newTpOrdPx?: string;
  newTpOrdKind?: string;
  newSlTriggerPx?: string;
  newSlTriggerPxType?: string;
  newSlOrdPx?: string;
  newSlOrdKind?: string;
  newCallbackRatio?: string;
  newCallbackSpread?: string;
  newActivePx?: string;
  [key: string]: unknown;
}

export interface ActionCancelOrderParams {
  instId: string;
  algoId?: string;
  ordId?: string;
  tdMode?: string;
  orderListId?: string;
  clOrdId?: string;
  [key: string]: unknown;
}

export interface ActionClosePositionParams {
  instId: string;
  mgnMode: string;
  posSide?: string;
  ccy?: string;
  autoCxl?: boolean;
  [key: string]: unknown;
}

export interface TestPosition {
  instId?: string;
  posSide: string;
  pos: string;
  markPx: string;
  liqPx: string;
}

export interface AmendOrderActionConfig extends ModuleConfig {
  id?: string;
  name?: string;
  amend_inst_id?: string;
  inst_id?: string;
  amend_test_mode?: boolean;
  test_mode?: boolean;
  amend_tp_increment?: string;
  tp_ord_px_increment?: string;
  sl_ord_px_increment?: string;
  test_amend_orders?: string;
  modify_contract_size?: boolean;
  new_contract_size?: string;
  modify_all_orders?: boolean;
  amend_order_type?: string;
  trigger_px_increment?: string;
  px_increment?: string;
  tp_px_increment?: string;
  sl_px_increment?: string;
  tp_sl_type?: string;
  callback_ratio_spread?: string;
  active_px?: string;
}

export interface PlaceOrderActionConfig extends ModuleConfig {
  id?: string;
  name?: string;
  inst_id?: string;
  order_type?: string;
  side?: string;
  pos_side?: string;
  td_mode?: string;
  order_direction?: string;
  first_order_price?: string;
  order_interval?: string;
  order_count?: string;
  contract_size?: string;
  take_profit_margin?: string;
  stop_loss_margin?: string;
  first_tp_price?: string;
  first_sl_price?: string;
  chase_val?: string;
  tp_sl_type?: string;
  callback_ratio?: string;
  callback_spread?: string;
  active_px?: string;
  tgt_ccy?: string;
  place_test_mode?: boolean;
  test_mode?: boolean;
  skip_duplicate_orders?: boolean;
}

export interface TPAlgoOrder {
  attachAlgoId?: string;
  tpOrdPx?: string;
  tpTriggerPx?: string;
  slOrdPx?: string;
  slTriggerPx?: string;
  callbackRatio?: string;
  callbackSpread?: string;
  activePx?: string;
}

export interface OrderWithAlgo extends TradeOrder {
  algoOrdType?: string;
  attachAlgoOrds?: TPAlgoOrder[];
}

export interface AddMarginActionConfig extends ModuleConfig {
  margin_guard_redeem_amt?: string;
  margin_payment_account?: string;
  margin_to_account?: string;
  margin_test_mode?: boolean;
}

export interface CancelOrderActionConfig extends ModuleConfig {
  id?: string;
  name?: string;
  inst_id?: string;
  cancel_inst_id?: string;
  cancel_order_types?: string[];
  cancel_side?: string;
  side?: string;
  cancel_test_mode?: boolean;
  test_mode?: boolean;
}

export interface ClosePositionActionConfig extends ModuleConfig {
  id?: string;
  name?: string;
  inst_id?: string;
  close_inst_id?: string;
  mgn_mode?: string;
  pos_side?: string;
  upl_filter?: string;
  upl_ratio_filter?: string;
  close_mgn_mode?: string;
  close_pos_side?: string;
  close_upl_filter?: string;
  close_upl_ratio_filter?: string;
  close_test_mode?: boolean;
  test_mode?: boolean;
  reverse?: boolean;
  cancel_pending?: boolean;
}
