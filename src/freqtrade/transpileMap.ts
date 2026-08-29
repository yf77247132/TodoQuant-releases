
import type {
  FreqtradeIndicator,
  FreqtradeOperator,
} from '../types/freqtrade.ts';

export interface IndicatorMapping {
  fn: string;
  args: { name: string; default: number }[];
  output: 'single' | 'multi';
  keys?: string[];
  inputFn?: string;
  isQtpylib?: boolean;
  isRolling?: boolean;
  isBuiltin?: boolean;
}

export const INDICATOR_MAP: Record<FreqtradeIndicator, IndicatorMapping> = {
  price: {
    fn: '',
    args: [],
    output: 'single',
    isBuiltin: true,
  },
  volume: {
    fn: '',
    args: [],
    output: 'single',
    isBuiltin: true,
  },
  RSI: {
    fn: 'ta.RSI',
    args: [{ name: 'timeperiod', default: 14 }],
    output: 'single',
  },
  EMA: {
    fn: 'ta.EMA',
    args: [{ name: 'timeperiod', default: 21 }],
    output: 'single',
  },
  MACD: {
    fn: 'ta.MACD',
    args: [],
    output: 'multi',
    keys: ['macd', 'macdsignal', 'macdhist'],
  },
  BB: {
    fn: 'qtpylib.bollinger_bands',
    args: [
      { name: 'window', default: 20 },
      { name: 'stds', default: 2 },
    ],
    output: 'multi',
    keys: ['lower', 'mid', 'upper'],
    inputFn: 'qtpylib.typical_price(dataframe)',
    isQtpylib: true,
  },
  SMA: {
    fn: 'ta.SMA',
    args: [{ name: 'timeperiod', default: 21 }],
    output: 'single',
  },
  ATR: {
    fn: 'ta.ATR',
    args: [{ name: 'timeperiod', default: 14 }],
    output: 'single',
  },
  STOCH: {
    fn: 'ta.STOCH',
    args: [],
    output: 'multi',
    keys: ['slowk', 'slowd'],
  },
  ADX: {
    fn: 'ta.ADX',
    args: [{ name: 'timeperiod', default: 14 }],
    output: 'single',
  },
  MFI: {
    fn: 'ta.MFI',
    args: [{ name: 'timeperiod', default: 14 }],
    output: 'single',
  },
  CCI: {
    fn: 'ta.CCI',
    args: [{ name: 'timeperiod', default: 14 }],
    output: 'single',
  },
  VOL_MA: {
    fn: "dataframe['volume'].rolling",
    args: [{ name: 'window', default: 20 }],
    output: 'single',
    isRolling: true,
  },
};

export const OPERATOR_MAP: Record<FreqtradeOperator, string> = {
  'cross_above': 'qtpylib.crossed_above({left}, {right})',
  'cross_below': 'qtpylib.crossed_below({left}, {right})',
  '>':  '({left} > {right})',
  '<':  '({left} < {right})',
  '>=': '({left} >= {right})',
  '<=': '({left} <= {right})',
};
