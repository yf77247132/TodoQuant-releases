import { useCallback, useEffect, useState } from 'react';
import { safeStorageGet, safeStorageSet } from '../lib/safeStorage.ts';
import { SymbolUtils } from '../lib/symbolUtils.ts';
import type { Position } from '../types/trading.ts';

const PREF_KEY = 'position-cancel-on-close';

interface PendingOrderItem {
  _accountId?: string;
  instId: string;
  ordId: string;
  algoId?: string;
  tdMode?: string;
}

export interface CancelPendingResult {
  count: number;
  success: number;
  fail: number;
}

export function useCancelOnClosePref() {
  const [cancelOnClosePref, setCancelOnClosePref] = useState<boolean>(() =>
    safeStorageGet<boolean>(PREF_KEY, false)
  );

  useEffect(() => {
    fetch(`/api/ui-prefs/${PREF_KEY}`)
      .then(r => r.json())
      .then(res => {
        if (res?.ok && typeof res.value === 'boolean') {
          setCancelOnClosePref(res.value);
          safeStorageSet(PREF_KEY, res.value);
        }
      })
      .catch(() => {});
  }, []);

  const setCancelOnClosePrefAndPersist = useCallback((next: boolean) => {
    setCancelOnClosePref(next);
    safeStorageSet(PREF_KEY, next);
    fetch(`/api/ui-prefs/${PREF_KEY}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: next }),
    }).catch(() => {});
  }, []);

  const cancelPendingOrdersForPositions = useCallback(async (positions: Position[]): Promise<CancelPendingResult> => {
    try {
      const res = await fetch('/api/orders/pending?noWait=1');
      const pending = await res.json();
      const all = (pending?.data || []) as PendingOrderItem[];
      const targetKeys = new Set(
        positions
          .filter(p => !!p._accountId)
          .map(p => `${p._accountId}|${p.instId}`)
      );
      const matches = all.filter(o =>
        (o.ordId || o.algoId) &&
        Array.from(targetKeys).some(key => {
          const sep = key.indexOf('|');
          const accId = key.slice(0, sep);
          const instId = key.slice(sep + 1);
          return o._accountId === accId && SymbolUtils.isSameSymbol(o.instId, instId);
        })
      );
      if (matches.length === 0) return { count: 0, success: 0, fail: 0 };

      const cancelRes = await fetch('/api/order/batch-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orders: matches.map(o => ({
            accountId: o._accountId,
            instId: o.instId,
            ordId: o.ordId,
            algoId: o.algoId,
            tdMode: o.tdMode,
          })),
        }),
      });
      const cancelData = await cancelRes.json();
      return { count: matches.length, success: cancelData?.success || 0, fail: cancelData?.fail || 0 };
    } catch {
      return { count: 0, success: 0, fail: 0 };
    }
  }, []);

  return { cancelOnClosePref, setCancelOnClosePrefAndPersist, cancelPendingOrdersForPositions };
}
