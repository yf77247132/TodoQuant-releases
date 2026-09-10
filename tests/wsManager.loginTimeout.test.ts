import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { WebSocketServer, type WebSocket } from "ws";

import { createOkxWsInternalCore } from "../src/bootstrap/ws/core/connectionFactory.ts";
import { handleLoginTimeoutInternalCore } from "../src/bootstrap/ws/core/loginHandlers.ts";

test("ws login timeout closes connection and enters reconnect path", async () => {
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;

  const connectionStatus: Record<number, boolean> = {};
  const loginFailCount: Record<number, number> = {};
  const reconnectAttempts: Record<number, number> = {};
  const reconnectTimers: Record<number, NodeJS.Timeout> = {};
  const loginTimeoutTimers: Record<number, NodeJS.Timeout> = {};
  const activeClients: Record<number, WebSocket> = {};

  const reconnectCalls: Array<{
    wsType: "private" | "business";
    apiKey: string;
    secretKey: string;
    passphrase: string;
    accountIdx: number;
  }> = [];

  const clearLoginTimeout = (accountIdx: number) => {
    if (loginTimeoutTimers[accountIdx]) {
      clearTimeout(loginTimeoutTimers[accountIdx]);
      delete loginTimeoutTimers[accountIdx];
    }
  };

  let permanentlyStopped = false;

  createOkxWsInternalCore({
    url: `ws://127.0.0.1:${port}`,
    apiKey: "A".repeat(20),
    secretKey: "secret-demo",
    passphrase: "pass-demo",
    accountIdx: 7,
    wsType: "private",
    onLoginSuccess: () => {},
    connectionStatus,
    loginFailCount,
    reconnectAttempts,
    reconnectTimers,
    loginTimeoutTimers,
    activeClients,
    clearLoginTimeout,
    pongWaitTimers: {}, // 2026-09-07 pong 检测新增：测试场景不触发心跳，空表即可
    notifyWsStatus: () => {},
    stopPing: () => {},
    handleLoginInternal: () => {},
    handleLoginTimeoutInternal: (accountIdx, okxWs, wsType, loginFailCountRef) => {
      handleLoginTimeoutInternalCore({
        accountIdx,
        okxWs,
        wsType,
        loginFailCount: loginFailCountRef,
        loginTimeoutMs: 30,
        permanentlyStop: () => {
          permanentlyStopped = true;
        },
      });
    },
    handleDataMessage: () => {},
    calculateBackoffDelay: () => 10,
    permanentlyStop: () => {
      permanentlyStopped = true;
    },
    isPermanentlyStopped: () => permanentlyStopped,
    reconnectByType: (wsType, apiKey, secretKey, passphrase, accountIdx) => {
      reconnectCalls.push({ wsType, apiKey, secretKey, passphrase, accountIdx });
    },
    loginTimeoutMs: 30,
    getLoginTimestamp: () => Math.floor(Date.now() / 1000).toString(),
    maxReconnectAttempts: 20,
  });

  await new Promise((resolve) => setTimeout(resolve, 160));

  assert.equal(loginFailCount[7], 1);
  assert.equal(permanentlyStopped, false);
  assert.equal(reconnectCalls.length, 1);
  assert.deepEqual(reconnectCalls[0], {
    wsType: "private",
    apiKey: "A".repeat(20),
    secretKey: "secret-demo",
    passphrase: "pass-demo",
    accountIdx: 7,
  });

  Object.values(reconnectTimers).forEach((timer) => clearTimeout(timer));
  Object.values(loginTimeoutTimers).forEach((timer) => clearTimeout(timer));
  Object.values(activeClients).forEach((client) => {
    try {
      client.terminate();
    } catch {}
  });

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

