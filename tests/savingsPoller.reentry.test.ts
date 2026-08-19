import assert from "node:assert/strict";
import test from "node:test";

import { SavingsPoller } from "../src/services/savingsPoller.ts";
import { OKXWebSocketManager } from "../src/services/wsManager.ts";
import { dbService } from "../src/services/dbService.ts";

test("SavingsPoller prevents re-entry and duplicate start timers", async () => {
  const originalGetAllConfigs = dbService.getAllConfigs.bind(dbService);
  const originalGetAccounts = dbService.getAccounts.bind(dbService);
  const originalWsManagerInstance = OKXWebSocketManager.instance;
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;

  const accountStub = {
    apiKey: "A".repeat(20),
    secretKey: "S".repeat(20),
    passphrase: "P".repeat(20),
    exchange: "OKX",
  };

  (dbService as any).getAllConfigs = () => ({});
  (dbService as any).getAccounts = () => [accountStub];
  (OKXWebSocketManager as any).instance = {
    isPermanentlyStopped: () => false,
  };

  let intervalCount = 0;
  let intervalCallback: (() => void | Promise<void>) | null = null;
  const intervalToken = { token: "interval" };

  (global as any).setInterval = (cb: () => void | Promise<void>) => {
    intervalCount += 1;
    intervalCallback = cb;
    return intervalToken as any;
  };
  (global as any).clearInterval = () => {};

  const poller = new SavingsPoller({ wss: { clients: new Set() } as any });

  let syncCalls = 0;
  let releaseSync!: () => void;
  const syncGate = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });

  (poller as any).getService = () => ({
    syncTime: async () => {
      syncCalls += 1;
      await syncGate;
    },
    getSavingsBalance: async () => "0",
    getAssetValuation: async () => ({ totalEq: "0", details: {} }),
  });

  try {
    poller.start();
    poller.start();

    assert.equal(intervalCount, 1);
    assert.ok(intervalCallback);

    await Promise.resolve();
    await intervalCallback!();
    assert.equal(syncCalls, 1);

    releaseSync();
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    poller.stop();
    (dbService as any).getAllConfigs = originalGetAllConfigs;
    (dbService as any).getAccounts = originalGetAccounts;
    (OKXWebSocketManager as any).instance = originalWsManagerInstance;
    (global as any).setInterval = originalSetInterval;
    (global as any).clearInterval = originalClearInterval;
  }
});

