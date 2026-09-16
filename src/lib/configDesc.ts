
import i18next from 'i18next';
import type { DescSegment } from '../ui/ConfigSummaryRender.tsx';
import type {
  PlaceConfigItem,
  AmendConfigItem,
  CancelConfigItem,
  CloseConfigItem,
  MarginConfigItem,
} from '../types/configItems.ts';
import { getAccountNameFromConfig } from './resolveAccount.ts';
import {
  CANCEL_ORDER_TYPE_OPTIONS,
  getOrderTypeLabel,
  isRegularOrder,
  isTrigger,
  isConditional,
  isOCO,
  isChase,
  isMoveOrderStop,
} from '../constants/orderTypes.ts';
import {
  getPaymentOptions,
  getOkxDestOptions,
  getBinanceDestOptions,
} from '../constants/marginTransferOptions.ts';

export function buildPlaceDescSegments(
  cfg: PlaceConfigItem,
  accountNames: Record<number, string>,
  _accountColors: Record<number, string>,
  accounts: Array<{ id: string; name: string }> = [],
  t: (key: string) => string = (k) => k
): DescSegment[] {
  const accountName = getAccountNameFromConfig(cfg, accountNames, accounts, t);
  const instLabel = cfg.inst_id || t('place.desc.all');
  const typeLabel = t(getOrderTypeLabel(cfg.order_type));
  const sideLabel = cfg.side === 'buy' ? t('place.value.buy') : t('place.value.sell');
  const posSideText = cfg.pos_side === 'net' ? t('place.value.posSideNet') : (cfg.pos_side === 'long' ? t('place.value.posSideLong') : t('place.value.posSideShort'));
  const tdModeText = cfg.td_mode === 'cash' ? t('place.value.tdModeCash') : (cfg.td_mode === 'cross' ? t('place.value.tdModeCross') : t('place.value.tdModeIsolated'));
  const directionText = cfg.order_direction === 'up' ? t('place.value.directionUp') : t('place.value.directionDown');

  const segs: DescSegment[] = [
    { label: t('place.desc.account'), value: accountName },
    { label: t('place.desc.instId'), value: instLabel },
    { label: t('place.desc.posSide'), value: posSideText, style: cfg.pos_side === 'long' ? 'green' : (cfg.pos_side === 'short' ? 'red' : 'value') },
    { label: t('place.desc.tdMode'), value: tdModeText },
    { label: t('place.desc.orderDirection'), value: directionText },
    { label: t('place.desc.orderType'), value: typeLabel },
    { label: t('place.desc.side'), value: sideLabel, style: sideLabel === t('place.value.buy') ? 'green' : 'red' },
  ];

  const isMoveStop = cfg.tp_sl_type === 'move_stop';
  if (isRegularOrder(cfg.order_type)) {
    if (cfg.order_type !== 'market') {
      segs.push({ label: t('place.desc.orderPrice'), value: cfg.first_order_price });
    }
    if (isMoveStop) {
      if (cfg.callback_ratio_spread && cfg.callback_ratio_spread !== '-1') segs.push({ label: t('place.desc.callbackRatioSpread'), value: cfg.callback_ratio_spread });
      if (cfg.active_px !== '-1') segs.push({ label: t('place.desc.activePx'), value: cfg.active_px });
    } else {
      if (cfg.take_profit_margin !== '-1') segs.push({ label: t('place.desc.takeProfit'), value: cfg.take_profit_margin });
    }
    if (cfg.stop_loss_margin !== '-1') segs.push({ label: t('place.desc.stopLoss'), value: cfg.stop_loss_margin });
  }
  if (isTrigger(cfg.order_type)) {
    segs.push({ label: t('place.desc.triggerPrice'), value: cfg.first_order_price });
    if (isMoveStop) {
      if (cfg.callback_ratio_spread && cfg.callback_ratio_spread !== '-1') segs.push({ label: t('place.desc.callbackRatioSpread'), value: cfg.callback_ratio_spread });
      if (cfg.active_px !== '-1') segs.push({ label: t('place.desc.activePx'), value: cfg.active_px });
    } else {
      if (cfg.take_profit_margin !== '-1') segs.push({ label: t('place.desc.takeProfit'), value: cfg.take_profit_margin });
    }
    if (cfg.stop_loss_margin !== '-1') segs.push({ label: t('place.desc.stopLoss'), value: cfg.stop_loss_margin });
  }
  if (isConditional(cfg.order_type)) {
    if (cfg.first_tp_price !== '-1') segs.push({ label: t('place.desc.orderPrice'), value: cfg.first_tp_price });
  }
  if (isOCO(cfg.order_type)) {
    if (cfg.first_tp_price !== '-1') segs.push({ label: t('place.desc.tpPrice'), value: cfg.first_tp_price });
    if (cfg.first_sl_price !== '-1') segs.push({ label: t('place.desc.slPrice'), value: cfg.first_sl_price });
  }
  if (isChase(cfg.order_type) && cfg.chase_val !== '-1') {
    segs.push({ label: t('place.desc.chaseVal'), value: cfg.chase_val });
  }
  if (isMoveOrderStop(cfg.order_type)) {
    if (cfg.callback_ratio_spread && cfg.callback_ratio_spread !== '-1') segs.push({ label: t('place.desc.callbackRatioSpread'), value: cfg.callback_ratio_spread });
    if (cfg.active_px !== '-1') segs.push({ label: t('place.desc.activePx'), value: cfg.active_px });
  }

  segs.push({ label: t('place.desc.interval'), value: cfg.order_interval });
  segs.push({ label: t('place.desc.orderCount'), value: cfg.order_count });
  segs.push({ label: t('place.desc.contractSize'), value: cfg.contract_size });
  segs.push({ label: t('place.desc.testMode'), value: !cfg.place_test_mode ? t('place.value.on') : t('place.value.off'), style: !cfg.place_test_mode ? 'yellow-on' : 'gray-off' });
  segs.push({ label: t('place.desc.skipDuplicate'), value: cfg.skip_duplicate_orders ? t('place.value.on') : t('place.value.off'), style: cfg.skip_duplicate_orders ? 'yellow-on' : 'gray-off' });

  return segs;
}

export function buildPlaceDescText(segments: DescSegment[]): string {
  return segments.map(s => `${s.label}: ${s.value}`).join(', ');
}

export function buildCancelDescSegments(
  cfg: CancelConfigItem,
  accountNames: Record<number, string>,
  _accountColors: Record<number, string>,
  accounts: Array<{ id: string; name: string }> = [],
  t: (key: string) => string = i18next.t.bind(i18next)
): DescSegment[] {
  const typeLabels = (cfg.order_types || [])
    .map(v => t(getOrderTypeLabel(v)))
    .filter(Boolean);
  const isAllTypes = (cfg.order_types || []).length >= CANCEL_ORDER_TYPE_OPTIONS.length;
  const accountName = getAccountNameFromConfig(cfg, accountNames, accounts, t);
  const instLabel = cfg.inst_id || t('cancel.desc.all');

  const segs: DescSegment[] = [
    { label: t('cancel.desc.account'), value: accountName },
    { label: t('cancel.desc.instId'), value: instLabel, style: 'value' },
    {
      label: t('cancel.desc.orderType'),
      value: isAllTypes ? t('cancel.desc.allTypes') : typeLabels.join(', '),
      style: 'value',
    },
    { label: t('cancel.desc.testMode'), value: !cfg.test_mode ? t('cancel.value.on') : t('cancel.value.off'), style: !cfg.test_mode ? 'yellow-on' : 'gray-off' },
  ];

  segs.splice(2, 0, {
    label: t('cancel.desc.side'),
    value: cfg.side === 'buy' ? t('cancel.value.sideBuy') : cfg.side === 'sell' ? t('cancel.value.sideSell') : t('cancel.option.sideAll'),
    style: cfg.side === 'buy' ? 'green' : cfg.side === 'sell' ? 'red' : 'value',
  });

  return segs;
}

export function buildCancelDescText(segments: DescSegment[]): string {
  return segments.map(s => `${s.label}: ${s.value}`).join(', ');
}

export function buildAmendDescSegments(
  cfg: AmendConfigItem,
  accountNames: Record<number, string>,
  _accountColors: Record<number, string>,
  accounts: Array<{ id: string; name: string; exchange?: string }> = [],
  t: (key: string) => string = i18next.t.bind(i18next)
): DescSegment[] {
  const typeLabel = t(getOrderTypeLabel(cfg.order_type));
  const accountName = getAccountNameFromConfig(cfg, accountNames, accounts, t);
  const instLabel = cfg.inst_id || t('amend.all');

  const segs: DescSegment[] = [
    { label: t('amend.account'), value: accountName },
    { label: t('amend.tradingPair'), value: instLabel },
    { label: t('amend.type'), value: typeLabel },
  ];

  if (cfg.order_type === 'trigger') {
    segs.push({ label: t('amend.triggerPxIncrement'), value: cfg.trigger_px_increment });
    if (cfg.tp_sl_type === 'move_stop') {
      if (cfg.callback_ratio_spread && cfg.callback_ratio_spread !== '-1' && cfg.callback_ratio_spread !== '0') segs.push({ label: t('amend.callbackRatioSpreadIncrement'), value: cfg.callback_ratio_spread });
      if (cfg.active_px && cfg.active_px !== '') segs.push({ label: t('amend.activationPxIncrement'), value: cfg.active_px });
    } else {
      if (cfg.tp_ord_px_increment && cfg.tp_ord_px_increment !== '-1') segs.push({ label: t('amend.takeProfit'), value: cfg.tp_ord_px_increment });
    }
    if (cfg.sl_ord_px_increment && cfg.sl_ord_px_increment !== '-1') segs.push({ label: t('amend.stopLoss'), value: cfg.sl_ord_px_increment });
  }
  if (cfg.order_type === 'limit') {
    if (cfg.px_increment && cfg.px_increment !== '0') segs.push({ label: t('amend.ordPxIncrement'), value: cfg.px_increment });
    if (cfg.tp_sl_type === 'move_stop') {
      if (cfg.callback_ratio_spread && cfg.callback_ratio_spread !== '-1' && cfg.callback_ratio_spread !== '0') segs.push({ label: t('amend.callbackRatioSpreadIncrement'), value: cfg.callback_ratio_spread });
      if (cfg.active_px && cfg.active_px !== '') segs.push({ label: t('amend.activationPxIncrement'), value: cfg.active_px });
    } else {
      if (cfg.tp_ord_px_increment && cfg.tp_ord_px_increment !== '-1') segs.push({ label: t('amend.takeProfit'), value: cfg.tp_ord_px_increment });
    }
    if (cfg.sl_ord_px_increment && cfg.sl_ord_px_increment !== '-1') segs.push({ label: t('amend.stopLoss'), value: cfg.sl_ord_px_increment });
  }
  if (cfg.order_type === 'conditional' || cfg.order_type === 'oco' || cfg.order_type === 'move_order_stop') {
    if (cfg.tp_px_increment && cfg.tp_px_increment !== '0') segs.push({ label: cfg.order_type === 'move_order_stop' ? t('amend.callbackRatioIncrement') : t('amend.tpIncrement'), value: cfg.tp_px_increment });
    if (cfg.sl_px_increment && cfg.sl_px_increment !== '0') segs.push({ label: cfg.order_type === 'move_order_stop' ? t('amend.activationPxIncrement') : t('amend.slIncrement'), value: cfg.sl_px_increment });
  }

  if (cfg.new_contract_size) segs.push({ label: t('amend.quantity'), value: cfg.new_contract_size });
  segs.push({ label: t('amend.liveMode'), value: !cfg.test_mode ? t('amend.on') : t('amend.off'), style: !cfg.test_mode ? 'yellow-on' : 'gray-off' });

  return segs;
}

export function buildAmendDescText(segments: DescSegment[]): string {
  return segments.map(s => `${s.label}: ${s.value}`).join(', ');
}

export function buildCloseDescSegments(
  cfg: CloseConfigItem,
  accountNames: Record<number, string>,
  _accountColors?: Record<number, string>,
  accounts: Array<{ id: string; name: string }> = [],
  t: (key: string) => string = i18next.t.bind(i18next)
): DescSegment[] {
  const accountName = getAccountNameFromConfig(cfg, accountNames, accounts, t);
  const instLabel = cfg.inst_id || t('close.desc.all');

  const segs: DescSegment[] = [
    { label: t('close.desc.account'), value: accountName },
    { label: t('close.desc.instId'), value: instLabel, style: 'value' },
  ];

  const mgnModeMap: Record<string, string> = { cross: t('close.value.mgnModeCross'), isolated: t('close.value.mgnModeIsolated') };
  segs.push({ label: t('close.desc.mgnMode'), value: mgnModeMap[cfg.mgn_mode] || t('close.option.all'), style: 'value' });

  const posSideMap: Record<string, string> = { long: t('close.value.posSideLong'), short: t('close.value.posSideShort') };
  segs.push({ label: t('close.desc.posSide'), value: posSideMap[cfg.pos_side] || t('close.option.all'), style: cfg.pos_side === 'long' ? 'green' : cfg.pos_side === 'short' ? 'red' : 'value' });
  if (cfg.upl_filter) {
    segs.push({ label: t('close.desc.uplFilter'), value: cfg.upl_filter, style: 'value' });
  }
  if (cfg.upl_ratio_filter) {
    segs.push({ label: t('close.desc.uplRatioFilter'), value: cfg.upl_ratio_filter, style: 'value' });
  }

  segs.push({ label: t('close.desc.testMode'), value: !cfg.test_mode ? t('close.value.on') : t('close.value.off'), style: !cfg.test_mode ? 'yellow-on' : 'gray-off' });

  segs.push({ label: t('close.desc.reverse'), value: cfg.reverse ? t('close.value.on') : t('close.value.off'), style: cfg.reverse ? 'yellow-on' : 'gray-off' });

  segs.push({ label: t('close.desc.cancelPending'), value: cfg.cancel_pending ? t('close.value.on') : t('close.value.off'), style: cfg.cancel_pending ? 'yellow-on' : 'gray-off' });

  return segs;
}

export function buildCloseDescText(segments: DescSegment[]): string {
  return segments.map(s => `${s.label}: ${s.value}`).join(', ');
}

export function buildMarginDescSegments(
  cfg: MarginConfigItem,
  accountNames: Record<number, string>,
  _accountColors: Record<number, string>,
  accounts: Array<{ id: string; name: string; exchange?: string }> = [],
  t: (key: string) => string = i18next.t.bind(i18next)
): DescSegment[] {
  const account = accounts?.find(a => a.id === cfg.account_id);
  const accountName = getAccountNameFromConfig(cfg, accountNames, accounts, t);
  const paymentLabel = getPaymentOptions(t).find(o => o.value === cfg.margin_payment_account)?.label || cfg.margin_payment_account || t('margin.desc.unknown');

  const isBinance = account?.exchange === 'BINANCE';
  const destOptions = isBinance ? getBinanceDestOptions(t) : getOkxDestOptions(t);

  let displayValue = cfg.margin_to_account;
  if (isBinance && (displayValue === '18' || !displayValue)) {
    displayValue = 'SPOT';
  }

  const destLabel = destOptions.find(o => o.value === displayValue)?.label || displayValue || (isBinance ? t('margin.option.destBinanceSpot') : t('margin.option.destOkxTrading'));

  const segs: DescSegment[] = [
    { label: t('margin.desc.account'), value: accountName },
    { label: t('margin.desc.transferAmount'), value: `₮${cfg.margin_guard_redeem_amt}` },
    { label: t('margin.desc.paymentAccount'), value: paymentLabel },
    { label: t('margin.desc.destAccount'), value: destLabel },
    { label: t('margin.desc.testMode'), value: !cfg.test_mode ? t('margin.value.on') : t('margin.value.off'), style: !cfg.test_mode ? 'yellow-on' : 'gray-off' },
  ];

  return segs;
}

export function buildMarginDescText(segments: DescSegment[]): string {
  return segments.map(s => `${s.label}: ${s.value}`).join(', ');
}
