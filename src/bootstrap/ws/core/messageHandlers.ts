import { AccountMonitor } from '../../../services/AccountMonitor.ts';
import { DiyEngine } from '../../../engine/diy/DiyEngine.ts';
import { isAlgoOrderType } from '../../../lib/orderStates.ts';
import type { WSMessage, WSDataItem, WSStatusPayload, WebSocketMessage } from '../../../types/wsTypes.ts';

type BufferEntry = WSMessage | WSStatusPayload | WebSocketMessage | Record<string, unknown>;

export const handleDataMessageCore = (
  latestWsData: Record<number, Record<string, unknown>>,
  messageBuffer: BufferEntry[],
  message: WSMessage,
  accountIdx: number,
  accountId?: string
): void => {
  const channel = message.arg?.channel;
  if (!channel) return;

  if (!latestWsData[accountIdx]) latestWsData[accountIdx] = {};
  latestWsData[accountIdx][channel] = message;

  if (channel === 'positions' && message.data) {
    AccountMonitor.getInstance().updatePositionsFromWs(accountIdx, message.data as WSDataItem[]);
  }

  if (channel === 'account' && message.data) {
    AccountMonitor.getInstance().updateBalancesFromWs(accountIdx, message.data);
  }

  if (message.data) {
    try {
      DiyEngine.getInstance().onDataPush(accountIdx, channel, message.data);
    } catch {
    }
  }

  if ((channel === 'orders' || channel === 'orders-algo' || channel === 'algo-advance') && message.data) {
    const ordersCache = (globalThis as unknown as Record<string, {
      refreshNow: () => Promise<void>;
      updateOrder: (accountIdx: number, order: unknown) => void;
      removeOrder: (accountIdx: number, ordId: string) => void;
      broadcastSyncSignal: () => void;
    }>)?.ORDERS_CACHE;
    const transformedOrders: Record<string, unknown>[] = [];
    message.data = message.data.map((d: WSDataItem & Record<string, unknown>) => {
      d._account = accountIdx;
      if (accountId) d._accountId = accountId;
      const transformed = AccountMonitor.transformOrder(d);
      transformedOrders.push(transformed);
      if (ordersCache) {
        const state = transformed.state || '';
        const isLive = ['live', 'partially_filled', 'effective', 'partially_effective'].includes(state.toLowerCase());
        const isAlgoEffective = isLive
          && !!transformed.algoId
          && state.toLowerCase() === 'effective';
        if (isAlgoEffective) {
          ordersCache.removeOrder(accountIdx, String(transformed.algoId));
        } else if (isLive) {
          ordersCache.updateOrder(accountIdx, transformed);
        } else {
          const isAlgo = isAlgoOrderType(transformed);
          const removeId = isAlgo ? (transformed.algoId || transformed.ordId) : transformed.ordId;
          if (removeId) {
            ordersCache.removeOrder(accountIdx, String(removeId));
          }
        }
      }
      return transformed;
    });
    AccountMonitor.getInstance().updateOrdersFromWs(accountIdx, transformedOrders);
    ordersCache?.broadcastSyncSignal();
  } else if (message.data) {
    message.data.forEach((d: WSDataItem) => {
      (d as WSDataItem & { _account?: number })._account = accountIdx;
      if (accountId) (d as WSDataItem & { _accountId?: string })._accountId = accountId;
    });
  }

  messageBuffer.push(message);
};

export const sendLogCore = (messageBuffer: BufferEntry[], logEntry: Record<string, unknown>): void => {
  messageBuffer.push(logEntry);
};

export const broadcastCore = (messageBuffer: BufferEntry[], payload: BufferEntry): void => {
  messageBuffer.push(payload);
};

export const notifyWsStatusCore = (
  messageBuffer: BufferEntry[],
  accountIdx: number,
  connected: boolean,
  status?: string
): void => {
  const payload: WSStatusPayload = { type: 'ws_status', account: accountIdx, connected };
  if (status) payload.status = status;
  messageBuffer.push(payload);
};
