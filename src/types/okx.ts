
export interface OKXRequestOptions {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

export interface OKXApiResponse<T = unknown> {
  code: string;
  msg: string;
  data?: T[];
}

export interface OKXTimeResponse extends OKXApiResponse<{ ts: string }> {}

export interface OKXTickerResponse extends OKXApiResponse<{
  instId: string;
  last: string;
  lastSz: string;
  askPx: string;
  bidPx: string;
  open24h: string;
  high24h: string;
  low24h: string;
}> {}

export interface OKXOrder {
  instId: string;
  ordId: string;
  clOrdId?: string;
  tag?: string;
  px: string;
  sz: string;
  side: string;
  posSide?: string;
  ordType: string;
  state: string;
  avgPx: string;
  fillSz: string;
  accFillSz: string;
  lever?: string;
  tpTriggerPx?: string;
  tpTriggerPxType?: string;
  tpOrdPx?: string;
  slTriggerPx?: string;
  slTriggerPxType?: string;
  slOrdPx?: string;
  cTime: string;
  uTime: string;
}

export type OKXAlgoOrder = Omit<OKXOrder, "ordId" | "ordType" | "px"> & {
  algoId: string;
  ordType?: string;
  ordPx?: string;
  triggerPx?: string;
  triggerPxType?: string;
  triggerType?: string;
  attachAlgoOrds?: Array<{
    attachAlgoId?: string;
    tpOrdPx?: string;
    tpTriggerPx?: string;
    slOrdPx?: string;
    slTriggerPx?: string;
    callbackRatio?: string;
    callbackSpread?: string;
    activePx?: string;
  }>;
};

export interface OKXPosition {
  instId: string;
  pos: string;
  avgPx: string;
  upl: string;
  uplRatio: string;
  realizedPnl?: string;
  lever: string;
  posSide: string;
  posCcy?: string;
  instType: string;
  last: string;
  liqPx: string;
  markPx: string;
  idxPx: string;
  deltaBS: string;
  gammaBS: string;
  thetaBS: string;
  vegaBS: string;
  margin: string;
  mgnMode: string;
  notionalUsd: string;
  adl: string;
  ccy: string;
  imr: string;
  mmr: string;
  mgnRatio: string;
  closeOrderAlgo: {
    tpTriggerPx?: string;
    tpTriggerPxType?: string;
    tpOrdPx?: string;
    slTriggerPx?: string;
    slTriggerPxType?: string;
    slOrdPx?: string;
  } | null;
}

export interface OKXPositionsResponse extends OKXApiResponse<OKXPosition> {}

export interface OKXSavingsBalanceResponse extends OKXApiResponse<{
  ccy: string;
  amt: string;
}> {}

export interface OKXAssetValuationResponse extends OKXApiResponse<{
  totalEq: string;
  details: Array<{
    ccy: string;
    eq: string;
  }>;
}> {}

export interface CancelOrderParams {
  instId: string;
  ordId?: string;
  clOrdId?: string;
}

export interface PlaceOrderParams {
  instId: string;
  tdMode: string;
  side: string;
  ordType: string;
  sz: string;
  ccy?: string;
  clOrdId?: string;
  tag?: string;
  posSide?: string;
  px?: string;
  reduceOnly?: boolean;
  tgtCcy?: string;
  banAmend?: boolean;
  attachAlgoOrds?: Array<{
    attachAlgoClOrdId?: string;
    tpTriggerPx?: string;
    tpTriggerPxType?: string;
    tpOrdPx?: string;
    tpOrdKind?: string;
    slTriggerPx?: string;
    slTriggerPxType?: string;
    slOrdPx?: string;
    slOrdKind?: string;
    sz?: string;
    amendPxOnTriggerType?: string;
  }>;
}

export interface PlaceAlgoOrderParams {
  instId: string;
  tdMode: string;
  side: string;
  ordType: "conditional" | "oco" | "trigger" | "move_order_stop" | "chase";
  sz: string;
  algoClOrdId?: string;
  ccy?: string;
  triggerType?: string;
  triggerPx?: string;
  triggerPxType?: string;
  orderPx?: string;
  px?: string;
  qy?: string;
  baseCcy?: string;
  quoteCcy?: string;
  szLimit?: string;
  tpTriggerPx?: string;
  tpTriggerPxType?: string;
  tpOrdPx?: string;
  slTriggerPx?: string;
  slTriggerPxType?: string;
  slOrdPx?: string;
  lever?: string;
  mgnMode?: string;
  posSide?: string;
  chaseType?: string;
  chaseVal?: string;
  maxChaseType?: string;
  maxChaseVal?: string;
  callbackRatio?: string;
  callbackSpread?: string;
  activePx?: string;
  tgtCcy?: string;
  attachAlgoOrds?: Array<{
    attachAlgoClOrdId?: string;
    algoType?: string;
    tpTriggerPx?: string;
    tpTriggerPxType?: string;
    tpOrdPx?: string;
    slTriggerPx?: string;
    slTriggerPxType?: string;
    slOrdPx?: string;
    ordType?: string;
    sz?: string;
    side?: string;
  }>;
}

export interface AmendOrderParams {
  instId: string;
  ordId?: string;
  algoId?: string;
  clOrdId?: string;
  reqId?: string;
  newSz?: string;
  newPx?: string;
  newTriggerPx?: string;
  newOrdPx?: string;
  newTpTriggerPx?: string;
  newTpTriggerPxType?: string;
  newTpOrdPx?: string;
  newSlTriggerPx?: string;
  newSlTriggerPxType?: string;
  newSlOrdPx?: string;
  ctpType?: string;
  newCtpPx?: string;
  newCcy?: string;
  attachAlgoOrds?: Array<{
    newTpTriggerPx?: string;
    newTpTriggerPxType?: string;
    newTpOrdPx?: string;
    newSlTriggerPx?: string;
    newSlTriggerPxType?: string;
    newSlOrdPx?: string;
  }>;
}

export interface TransferAssetParams {
  ccy: string;
  amt: string;
  from: string;
  to: string;
  type?: string;
  subAcct?: string;
}
