
export const OPERATOR_LABELS: Record<string, string> = {
  '=': 'operator.eq',
  '<': 'operator.lt',
  '>': 'operator.gt',
  '<=': 'operator.lte',
  '>=': 'operator.gte',
  'cross_above': 'indicators.crossAbove',
  'cross_below': 'indicators.crossBelow',
};

export const OPERATOR_LOG_LABELS: Record<string, string> = {
  '=': '等于',
  '<': '小于',
  '>': '大于',
  '<=': '小于等于',
  '>=': '大于等于',
  'cross_above': '上穿',
  'cross_below': '下穿',
};

export const CONDITION_TYPE_LABELS: Record<string, string> = {
  balance_less: 'condition.balance',
  pos_count: 'condition.posCount',
  pos_side: 'condition.posSide',
  pos_pnl_amount: 'condition.pnlAmount',
  pos_pnl_rate: 'condition.pnlRate',
  pos_margin: 'condition.margin',
  pos_mgn_ratio_val: 'condition.marginRatio',
  pos_sz_limit: 'condition.posSize',
  pos_liq_dist: 'condition.liqDist',
  pos_funding_rate: 'condition.fundingRate',
  pos_closed_pnl: 'condition.closedPnl',
  pos_hold_time: 'condition.holdTime',
  time_window: 'condition.timeWindow',
  cooldown: 'condition.cooldown',
  count_limit: 'condition.countLimit',
  tv_signal: 'condition.tvSignal',
  indicator: 'condition.typeIndicator',
  price_change: 'condition.typePriceChange',
  price_change_24h: 'condition.typePriceChange24h',
  price_change_today: 'condition.typePriceChangeToday',
  price_change_high24h: 'condition.typePriceChangeHigh24h',
};

export const CONDITION_TYPE_LOG_LABELS: Record<string, string> = {
  balance_less: '余额',
  pos_count: '仓位个数',
  pos_side: '方向',
  pos_pnl_amount: '收益额',
  pos_pnl_rate: '收益率',
  pos_margin: '保证金',
  pos_mgn_ratio_val: '保证金率',
  pos_sz_limit: '持仓量',
  pos_liq_dist: '距离爆仓',
  pos_funding_rate: '资金费率',
  pos_closed_pnl: '平仓收益',
  pos_hold_time: '持仓时间',
  time_window: '时间窗口',
  cooldown: '冷却',
  count_limit: '次数限制',
  tv_signal: 'TV信号',
  indicator: '指标条件',
  price_change: '涨幅',
  price_change_24h: '24H涨幅',
  price_change_today: '当日涨幅',
  price_change_high24h: '24H最高价涨幅',
};

export const COND_FIELD_LABELS = {
  bl_account: 'field.defaultAccount',
  bl_field: 'account.availableBalance',
  bl_operator: 'field.directionIs',
  bl_threshold: 'field.threshold',

  pc_instrument: 'field.instrument',
  pc_field: 'field.posCountValue',
  pc_target: 'field.threshold',
  pc_operator: 'field.directionIs',

  psl_instrument: 'field.instrument',
  psl_field: 'field.posSizeValue',
  psl_target: 'field.threshold',
  psl_operator: 'field.directionIs',

  ps_instrument: 'field.instrument',
  ps_match: 'field.direction',
  ps_current: 'field.directionIs',

  pa_instrument: 'field.instrument',
  pa_field: 'field.pnlAmountValue',
  pa_target: 'field.threshold',
  pa_operator: 'field.directionIs',

  pr_instrument: 'field.instrument',
  pr_field: 'field.pnlRateValue',
  pr_target: 'field.threshold',
  pr_operator: 'field.directionIs',

  pm_instrument: 'field.instrument',
  pm_field: 'field.marginValue',
  pm_target: 'field.threshold',
  pm_operator: 'field.directionIs',

  mr_instrument: 'field.instrument',
  mr_field: 'field.marginRatioValue',
  mr_target: 'field.threshold',
  mr_operator: 'field.directionIs',

  pl_instrument: 'field.instrument',
  pl_field: 'field.liqDistValue',
  pl_target: 'field.threshold',
  pl_operator: 'field.directionIs',

  fr_instrument: 'field.instrument',
  fr_field: 'field.fundingRateValue',
  fr_target: 'field.threshold',
  fr_operator: 'field.directionIs',

  cp_instrument: 'field.instrument',
  cp_field: 'field.closedPnlValue',
  cp_target: 'field.threshold',
  cp_operator: 'field.directionIs',

  ht_instrument: 'field.instrument',
  ht_field: 'field.holdTimeValue',
  ht_target: 'field.threshold',
  ht_operator: 'field.directionIs',
  ht_unit: 'field.unit',

  tw_timezone: 'field.timezone',
  tw_weekdays: 'field.weekly',

  cd_minutes: 'field.minutes',
  cd_seconds: 'field.seconds',

  cl_limit: 'field.dailyLimit',

  tv_condition_name: 'field.condition',
  tv_current_signal: 'field.tvSignalValue',

  ind_indicator: 'field.indicator',
  ind_params: 'field.indicatorParams',
  ind_output: 'field.indicatorOutput',
  ind_source: 'field.indicatorSource',
  ind_operator: 'field.indicatorOperator',
  ind_operand_kind: 'field.operandKind',
  ind_operand_value: 'field.operandValue',
  ind_operand_source: 'field.operandSource',
  ind_timeframe: 'field.indicatorTimeframe',

  pch_exchange: 'condition.exchangeSource',
  pch_instId: 'field.instrument',
  pch_window: 'condition.marketField',
  pch_operator: 'field.directionIs',
  pch_threshold: 'condition.threshold',
} as const;

export type CondFieldKey = keyof typeof COND_FIELD_LABELS;

export const BACKTESTABLE_CONDITION_TYPES = new Set<string>([
  'indicator',
  'time_window',
  'price_change',
]);
