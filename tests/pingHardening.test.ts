import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";

import { startPingCore, stopPingCore } from "../src/bootstrap/ws/core/pingManager.ts";

type TimerMap = Record<number, NodeJS.Timeout>;
type WaitMap = Record<string, NodeJS.Timeout>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const makeState = () => ({
  pingTimers: {} as TimerMap,
  businessPingTimers: {} as TimerMap,
  pongWaitTimers: {} as WaitMap,
});

const fakeWs = (readyState: number, behavior: "ok" | "throw") => {
  const calls = { sent: 0, terminated: 0 };
  const ws = {
    readyState,
    send: () => {
      if (behavior === "throw") throw new Error("EPIPE");
      calls.sent++;
    },
    terminate: () => {
      calls.terminated++;
    },
  } as unknown as WebSocket;
  return { ws, calls };
};

// 心跳间隔取 1ms，让定时器回调在测试窗口内立刻触发（生产值 25s 不参与断言）。
const FAST = 1;

test("加固①：连接非 OPEN → 主动 terminate（原先静默跳过，连告警都没有）", async () => {
  const s = makeState();
  const { ws, calls } = fakeWs(WebSocket.CLOSED, "throw");

  startPingCore(s.pingTimers, s.businessPingTimers, s.pongWaitTimers, FAST, ws, 0, "private");
  await sleep(30);
  stopPingCore(s.pingTimers, s.businessPingTimers, s.pongWaitTimers, 0, "private");

  assert.ok(calls.terminated >= 1, "非 OPEN 必须 terminate 以触发重连");
  assert.equal(calls.sent, 0, "非 OPEN 不应尝试发送 ping");
});

test("加固②：send('ping') 抛错 → 主动 terminate（原先静默吞掉）", async () => {
  const s = makeState();
  const { ws, calls } = fakeWs(WebSocket.OPEN, "throw");

  startPingCore(s.pingTimers, s.businessPingTimers, s.pongWaitTimers, FAST, ws, 0, "private");
  await sleep(30);
  stopPingCore(s.pingTimers, s.businessPingTimers, s.pongWaitTimers, 0, "private");

  assert.ok(calls.terminated >= 1, "发送失败必须 terminate 以触发重连");
});

test("正路：OPEN 且发送成功 → 建 pong 等待窗、不误杀连接", async () => {
  const s = makeState();
  const { ws, calls } = fakeWs(WebSocket.OPEN, "ok");

  startPingCore(s.pingTimers, s.businessPingTimers, s.pongWaitTimers, FAST, ws, 1, "business");
  await sleep(30);

  assert.ok(calls.sent >= 1, "应发出 ping");
  assert.equal(calls.terminated, 0, "正常连接不得被误 terminate");
  assert.ok(s.pongWaitTimers["business:1"], "发出 ping 后必须建立 pong 等待窗");

  stopPingCore(s.pingTimers, s.businessPingTimers, s.pongWaitTimers, 1, "business");
  assert.equal(s.pongWaitTimers["business:1"], undefined, "stopPing 必须清理 pong 等待窗");
});
