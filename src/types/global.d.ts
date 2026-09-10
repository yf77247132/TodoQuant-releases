declare global {
  var OKX_WS_MANAGER:
    | {
        broadcast?: (payload: unknown) => void;
        sendLog?: (entry: unknown) => void;
        getGlobalTimeOffset?: () => number;
      }
    | undefined;

  var ORDERS_CACHE:
    | {
        get: (accountIdx: number) => { data: any[]; timestamp: number };
        getAll: () => any[];
        isReady: () => boolean;
        waitForReady: () => Promise<void>;
        refreshNow: () => Promise<void>;
        updateOrder: (accountIdx: number, order: any) => void;
        removeOrder: (accountIdx: number, ordId: string) => void;
        setAccountOrders: (accountIdx: number, orders: any[], timestamp?: number) => void;
        broadcastSyncSignal: () => void;
        isRecentlyRemoved: (accountIdx: number, orderId: string) => boolean;
      }
    | undefined;
}

export {};
