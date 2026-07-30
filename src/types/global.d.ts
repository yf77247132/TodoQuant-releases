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
        refreshNow: () => Promise<void>;
        updateOrder: (accountIdx: number, order: unknown) => void;
        removeOrder: (accountIdx: number, ordId: string) => void;
      }
    | undefined;
}

export {};
