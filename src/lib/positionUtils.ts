import { OKXPosition } from "../types/okx.ts";

export function calculateLiquidationDistance(
  pos: Partial<OKXPosition> & { last?: string }
): number | null {
  const pxToUse = parseFloat(pos.markPx || pos.last || '0');
  const liqPx = parseFloat(pos.liqPx || '0');

  if (!Number.isFinite(pxToUse) || !Number.isFinite(liqPx)) return null;
  if (pxToUse <= 0 || liqPx <= 0) return null;

  const posSide = pos.posSide || 'net';
  const isShort = posSide === 'short' || (posSide === 'net' && parseFloat(pos.pos || '0') < 0);
  
  if (isShort) {
     return liqPx - pxToUse;
  } else {
     return pxToUse - liqPx;
  }
}
