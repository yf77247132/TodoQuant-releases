
export interface PlacePreset {
  id: string;
  nameKey: string;
  descKey: string;
  groupKey: string;
  risk: 'low' | 'medium' | 'high';
  generate: () => PresetFormValues;
}

export interface PresetFormValues {
  order_type?: string;
  side?: string;
  pos_side?: string;
  td_mode?: string;
  order_direction?: string;
  first_order_price?: string;
  order_interval?: string;
  order_count?: string;
  contract_size?: string;
  tp_sl_type?: string;
  take_profit_margin?: string;
  stop_loss_margin?: string;
}

const GRID_GROUP = 'place.preset.groupGrid';

const gridBuyLong: PlacePreset = {
  id: 'grid_buy_long',
  nameKey: 'place.preset.gridBuyLong',
  descKey: 'place.preset.gridBuyLongDesc',
  groupKey: GRID_GROUP,
  risk: 'low',
  generate: () => ({
    order_type: 'limit',
    side: 'buy',
    pos_side: 'long',
    td_mode: 'cross',
    order_direction: 'down',
    first_order_price: '=m*(1-1%)',
    order_interval: '=m*1%',
    order_count: '5',
    contract_size: '1',
  }),
};

const gridSellShort: PlacePreset = {
  id: 'grid_sell_short',
  nameKey: 'place.preset.gridSellShort',
  descKey: 'place.preset.gridSellShortDesc',
  groupKey: GRID_GROUP,
  risk: 'low',
  generate: () => ({
    order_type: 'limit',
    side: 'sell',
    pos_side: 'short',
    td_mode: 'cross',
    order_direction: 'up',
    first_order_price: '=m*(1+1%)',
    order_interval: '=m*1%',
    order_count: '5',
    contract_size: '1',
  }),
};

const gridBuyLongTpSl: PlacePreset = {
  id: 'grid_buy_long_tpsl',
  nameKey: 'place.preset.gridBuyLongTpSl',
  descKey: 'place.preset.gridBuyLongTpSlDesc',
  groupKey: GRID_GROUP,
  risk: 'low',
  generate: () => ({
    ...gridBuyLong.generate(),
    tp_sl_type: 'tp_sl',
    take_profit_margin: '3%',
    stop_loss_margin: '2%',
  }),
};

const gridSellShortTpSl: PlacePreset = {
  id: 'grid_sell_short_tpsl',
  nameKey: 'place.preset.gridSellShortTpSl',
  descKey: 'place.preset.gridSellShortTpSlDesc',
  groupKey: GRID_GROUP,
  risk: 'low',
  generate: () => ({
    ...gridSellShort.generate(),
    tp_sl_type: 'tp_sl',
    take_profit_margin: '3%',
    stop_loss_margin: '2%',
  }),
};

const SCALING_GROUP = 'place.preset.groupScaling';

const martingaleBuyLong: PlacePreset = {
  id: 'martingale_buy_long',
  nameKey: 'place.preset.martingaleBuyLong',
  descKey: 'place.preset.martingaleBuyLongDesc',
  groupKey: SCALING_GROUP,
  risk: 'high',
  generate: () => ({
    order_type: 'limit',
    side: 'buy',
    pos_side: 'long',
    td_mode: 'cross',
    order_direction: 'down',
    first_order_price: '=m',
    order_interval: '=m*1.5%',
    order_count: '5',
    contract_size: '=1*2^n',
  }),
};

const martingaleSellShort: PlacePreset = {
  id: 'martingale_sell_short',
  nameKey: 'place.preset.martingaleSellShort',
  descKey: 'place.preset.martingaleSellShortDesc',
  groupKey: SCALING_GROUP,
  risk: 'high',
  generate: () => ({
    order_type: 'limit',
    side: 'sell',
    pos_side: 'short',
    td_mode: 'cross',
    order_direction: 'up',
    first_order_price: '=m',
    order_interval: '=m*1.5%',
    order_count: '5',
    contract_size: '=1*2^n',
  }),
};

const CHASE_GROUP = 'place.preset.groupChase';

const breakoutBuyLong: PlacePreset = {
  id: 'breakout_buy_long',
  nameKey: 'place.preset.breakoutBuyLong',
  descKey: 'place.preset.breakoutBuyLongDesc',
  groupKey: CHASE_GROUP,
  risk: 'medium',
  generate: () => ({
    order_type: 'trigger',
    side: 'buy',
    pos_side: 'long',
    td_mode: 'cross',
    order_direction: 'up',
    first_order_price: '=m*(1+1%)',
    order_interval: '=m*0.5%',
    order_count: '3',
    contract_size: '1',
  }),
};

const breakoutSellShort: PlacePreset = {
  id: 'breakout_sell_short',
  nameKey: 'place.preset.breakoutSellShort',
  descKey: 'place.preset.breakoutSellShortDesc',
  groupKey: CHASE_GROUP,
  risk: 'medium',
  generate: () => ({
    order_type: 'trigger',
    side: 'sell',
    pos_side: 'short',
    td_mode: 'cross',
    order_direction: 'down',
    first_order_price: '=m*(1-1%)',
    order_interval: '=m*0.5%',
    order_count: '3',
    contract_size: '1',
  }),
};

const pyramidBuyLong: PlacePreset = {
  id: 'pyramid_buy_long',
  nameKey: 'place.preset.pyramidBuyLong',
  descKey: 'place.preset.pyramidBuyLongDesc',
  groupKey: CHASE_GROUP,
  risk: 'medium',
  generate: () => ({
    order_type: 'trigger',
    side: 'buy',
    pos_side: 'long',
    td_mode: 'cross',
    order_direction: 'up',
    first_order_price: '=m',
    order_interval: '=m*1%',
    order_count: '4',
    contract_size: '=8*0.5^n',
  }),
};

const pyramidSellShort: PlacePreset = {
  id: 'pyramid_sell_short',
  nameKey: 'place.preset.pyramidSellShort',
  descKey: 'place.preset.pyramidSellShortDesc',
  groupKey: CHASE_GROUP,
  risk: 'medium',
  generate: () => ({
    order_type: 'trigger',
    side: 'sell',
    pos_side: 'short',
    td_mode: 'cross',
    order_direction: 'down',
    first_order_price: '=m',
    order_interval: '=m*1%',
    order_count: '4',
    contract_size: '=8*0.5^n',
  }),
};

const CLOSE_GROUP = 'place.preset.groupClose';

const ladderCloseLong: PlacePreset = {
  id: 'ladder_close_long',
  nameKey: 'place.preset.ladderCloseLong',
  descKey: 'place.preset.ladderCloseLongDesc',
  groupKey: CLOSE_GROUP,
  risk: 'low',
  generate: () => ({
    order_type: 'limit',
    side: 'sell',
    pos_side: 'long',
    td_mode: 'cross',
    order_direction: 'up',
    first_order_price: '=m*(1+3%)',
    order_interval: '=m*2%',
    order_count: '3',
    contract_size: '1',
  }),
};

const ladderCloseShort: PlacePreset = {
  id: 'ladder_close_short',
  nameKey: 'place.preset.ladderCloseShort',
  descKey: 'place.preset.ladderCloseShortDesc',
  groupKey: CLOSE_GROUP,
  risk: 'low',
  generate: () => ({
    order_type: 'limit',
    side: 'buy',
    pos_side: 'short',
    td_mode: 'cross',
    order_direction: 'down',
    first_order_price: '=m*(1-3%)',
    order_interval: '=m*2%',
    order_count: '3',
    contract_size: '1',
  }),
};

export const PLACE_PRESETS: PlacePreset[] = [
  gridBuyLong,
  gridSellShort,
  gridBuyLongTpSl,
  gridSellShortTpSl,
  martingaleBuyLong,
  martingaleSellShort,
  breakoutBuyLong,
  breakoutSellShort,
  pyramidBuyLong,
  pyramidSellShort,
  ladderCloseLong,
  ladderCloseShort,
];

export const PLACE_PRESET_GROUPS = [
  { key: GRID_GROUP, presets: [gridBuyLong, gridSellShort, gridBuyLongTpSl, gridSellShortTpSl] },
  { key: SCALING_GROUP, presets: [martingaleBuyLong, martingaleSellShort] },
  { key: CHASE_GROUP, presets: [breakoutBuyLong, breakoutSellShort, pyramidBuyLong, pyramidSellShort] },
  { key: CLOSE_GROUP, presets: [ladderCloseLong, ladderCloseShort] },
];

export function findPreset(id: string): PlacePreset | undefined {
  return PLACE_PRESETS.find(p => p.id === id);
}
