import assert from "node:assert/strict";
import test from "node:test";

import { sweepRestMissingGrace } from "../src/lib/restMissingGrace.ts";

const GRACE = 30_000;

test("首次缺失：登记计时并保留（不剔除）", () => {
  const r = sweepRestMissingGrace({
    prevMarkers: {},
    candidateIds: ["algo-1", "ord-2"],
    now: 1_000_000,
    graceMs: GRACE,
  });
  assert.deepEqual(r.keptIds, ["algo-1", "ord-2"]);
  assert.deepEqual(r.expireIds, []);
  // 计时起点 = now（与订单对象无关，调用方按 orderKey 存取）
  assert.deepEqual(r.nextMarkers, { "algo-1": 1_000_000, "ord-2": 1_000_000 });
});

test("宽限期内连续缺失：继承原计时，既不重复计数也不剔除", () => {
  const r = sweepRestMissingGrace({
    prevMarkers: { "algo-1": 1_000_000 },
    candidateIds: ["algo-1"],
    now: 1_000_000 + GRACE - 1, // 差 1ms 未到期
    graceMs: GRACE,
  });
  assert.deepEqual(r.keptIds, []); // ⚠️ 只在首次计一次，避免每轮刷屏
  assert.deepEqual(r.expireIds, []);
  assert.equal(r.nextMarkers["algo-1"], 1_000_000); // 计时未被重置
});

test("连续缺失超过窗口：放行剔除（不再继承计时）", () => {
  const r = sweepRestMissingGrace({
    prevMarkers: { "algo-1": 1_000_000 },
    candidateIds: ["algo-1"],
    now: 1_000_000 + GRACE + 1,
    graceMs: GRACE,
  });
  assert.deepEqual(r.expireIds, ["algo-1"]);
  assert.deepEqual(r.keptIds, []);
  assert.equal(r.nextMarkers["algo-1"], undefined);
});

test("回归锁（本次修复的核心）：计时与订单对象解耦 —— 对象被替换不影响计时累计", () => {
  // 旧实现把计时挂在订单对象字段上：对象每轮被 REST/WS 的新对象替换即丢计时，
  // 多少轮都到不了 30s 窗口 → 永不剔除（永久幽灵）。
  // 现在计时在外部表里按 orderKey 累计 → 第一次超过 30s 的那轮必然到期。
  const T0 = 5_000_000;
  let markers: Record<string, number> = {};
  const rounds: Array<{ kept: number; expired: number }> = [];

  for (let i = 0; i < 5; i++) {
    const now = T0 + i * 10_000; // 10s 轮询
    const r = sweepRestMissingGrace({
      prevMarkers: markers,
      candidateIds: ["algo-ghost"], // 每轮都是"缓存里有、REST 没返回"
      now,
      graceMs: GRACE,
    });
    markers = r.nextMarkers;
    rounds.push({ kept: r.keptIds.length, expired: r.expireIds.length });
  }

  assert.deepEqual(rounds, [
    { kept: 1, expired: 0 }, // 第 1 轮（0s）：登记计时，保留
    { kept: 0, expired: 0 }, // 10s：静默保留（不重复计数，避免刷屏）
    { kept: 0, expired: 0 }, // 20s：静默保留
    { kept: 0, expired: 0 }, // 30s：恰好等于窗口（判据是严格 > graceMs，未到期）
    { kept: 0, expired: 1 }, // 40s：超过窗口 → 墓碑剔除
  ]);
});

test("订单重新被 REST 返回：调用方不把它放进 candidateIds → 计时自动清零", () => {
  const r = sweepRestMissingGrace({
    prevMarkers: { "algo-1": 1_000_000, "algo-2": 1_000_000 },
    candidateIds: ["algo-2"], // algo-1 已回到 REST，不在候选集
    now: 1_000_000 + 20_000,
    graceMs: GRACE,
  });
  assert.equal(r.nextMarkers["algo-1"], undefined); // 计时清零
  assert.equal(r.nextMarkers["algo-2"], 1_000_000); // 仍在缺失 → 计时保留
});

test("空 key / 空候选集：不产生脏条目", () => {
  // 真实调用方传的是 orderKey(o)（算法单 algoId / 普通单 ordId），可能为 undefined
  const r1 = sweepRestMissingGrace({ prevMarkers: {}, candidateIds: ["", undefined as never], now: 1, graceMs: GRACE });
  assert.deepEqual(r1.nextMarkers, {});
  assert.deepEqual(r1.keptIds, []);
  assert.deepEqual(r1.expireIds, []);

  const r2 = sweepRestMissingGrace({
    prevMarkers: { "algo-1": 1_000_000 },
    candidateIds: [],
    now: 9_999_999,
    graceMs: GRACE,
  });
  assert.deepEqual(r2.nextMarkers, {}); // 候选集为空 → 旧计时整体作废
});
