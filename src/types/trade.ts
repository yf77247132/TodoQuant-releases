
export interface TradeOrder {
  ordId: string;
  algoId?: string;
  instId: string;
  ordType: string;
  tdMode?: string;
  side: string;
  sz: string;
  px?: string;
  ordPx?: string;
  state?: string;
  avgPx?: string;
  accFillSz?: string;
  posSide?: string;
  triggerPx?: string;
  tpTriggerPx?: string;
  slTriggerPx?: string;
  tpOrdPx?: string;
  slOrdPx?: string;
  orderListId?: string;
  algoOrdType?: string;
  cTime?: string;
  uTime?: string;
  _restMissingAt?: number;
}
