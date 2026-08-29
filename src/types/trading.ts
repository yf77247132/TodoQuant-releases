
export type Side = 'buy' | 'sell';

export type PosSide = 'long' | 'short' | 'net';

export type MgnMode = 'cross' | 'isolated';

export type InstType = 'SWAP' | 'FUTURES' | 'OPTION' | 'MARGIN';

export interface Position {
  posId?: string;
  instId: string;
  pos: string;
  availPos?: string;
  avgPx: string;
  upl: string;
  uplRatio: string;
  lever: string;
  posSide: PosSide;
  posCcy?: string;
  instType: InstType;
  _account: number;
  _accountId?: string;
  last: string;
  liqPx: string;
  imr?: string;
  mgn?: string;
  mmr?: string;
  mgnRatio?: string;
  markPx?: string;
  mgnMode?: MgnMode;
  margin?: string;
  ccy?: string;
  cTime?: string;
}

export interface AccountDetail {
  ccy: string;
  eq: string;
  availEq: string;
  cashBal: string;
  frozenBal: string;
  imr: string;
  mmr: string;
  mgnRatio: string;
  availBal?: string;
}

export interface Account {
  _account: number;
  _accountId?: string;
  details?: AccountDetail[];
  savingsUsdt?: string;
  savingsUsdc?: string;
  totalEq?: string;
  valuation?: {
    totalBal: string;
    funding: string;
    trading: string;
    earn: string;
  };
}

export interface Order {
  ordId: string;
  algoId?: string;
  instId: string;
  side: Side;
  ordType: string;
  px: string;
  sz: string;
  tgtCcy?: string;
  _account: number;
  _accountId?: string;
  cTime: string;
  triggerPx?: string;
  tpOrdPx?: string;
  slOrdPx?: string;
  state?: string;
  exchange?: string;

  uTime?: string;

  orderTime?: string;
  orderTypeDisplay?: string;
  triggerPrice?: string | number | null;
  orderPrice?: string | number | null;
  avgPx?: string | number | null;
  tpPrice?: string | number | null;
  slPrice?: string | number | null;

  tdMode?: string;
  lever?: string;

  otoGroupType?: 'OTO' | 'OTOCO' | undefined;
  otoTpPrice?: string | number | null;
  otoSlPrice?: string | number | null;
  isOtoChild?: boolean;

  callbackRatio?: string | number | null;
  callbackSpread?: string | number | null;
  activePx?: string | number | null;
}
