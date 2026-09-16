import assert from "node:assert/strict";
import test from "node:test";

import { planWsFlush, WS_BUFFER_MAX, WS_FRAME_MAX } from "../src/lib/wsBatchBuffer.ts";

type Entry = Record<string, unknown>;

const log = (i: number): Entry => ({ type: "log", msg: `log-${i}` });
const order = (i: number): Entry => ({ type: "orders", id: `ord-${i}` });

test("常规量级：单帧发送、零丢失", () => {
  const entries: Entry[] = [order(1), order(2), log(3)];
  const { frames, dropped } = planWsFlush(entries);
  assert.equal(dropped, 0);
  assert.equal(frames.length, 1); // ≤ frameMax → 单帧
  assert.deepEqual(frames[0], entries);
});

test("回归锁（本次修复的核心）：超过单帧上限改为分片，而不是丢弃", () => {
  // 旧实现：100ms 窗口内积压 > 500 直接 slice(-500)，丢弃最早的 339 条（实测 839 条积压）。
  const entries: Entry[] = Array.from({ length: 839 }, (_, i) => order(i));
  const { frames, dropped } = planWsFlush(entries);

  assert.equal(dropped, 0); // ✅ 零丢失
  assert.deepEqual(frames.map(f => f.length), [WS_FRAME_MAX, 339]); // 500 + 339
  assert.equal(frames.flat().length, entries.length); // 拼接后一条不少
  assert.deepEqual(frames.flat(), entries); // 顺序不变
});

test("超过缓冲上限：优先丢弃日志条目，业务数据全保", () => {
  const entries: Entry[] = [
    ...Array.from({ length: 5 }, (_, i) => order(i)),
    ...Array.from({ length: WS_BUFFER_MAX + 100 }, (_, i) => log(i)),
  ];
  const { frames, dropped } = planWsFlush(entries);
  const kept = frames.flat();

  // 超出的部分全部由日志承担：总 2105 条，保留 2000 条 → 丢 105 条日志
  assert.equal(dropped, 5 + WS_BUFFER_MAX + 100 - WS_BUFFER_MAX);
  assert.equal(kept.length, WS_BUFFER_MAX);
  // 业务数据一条不丢
  assert.equal(kept.filter(e => e.type === "orders").length, 5);
  // 业务数据排在日志之前（保持原有相对顺序，未被重排到末尾）
  assert.deepEqual(kept.slice(0, 5).map(e => e.type), ["orders", "orders", "orders", "orders", "orders"]);
  // 保留的是最新的日志（尾部）
  assert.deepEqual(kept[kept.length - 1], log(WS_BUFFER_MAX + 99));
});

test("极端：业务数据本身超过上限 → 日志全丢，业务数据保最新 bufferMax 条", () => {
  const entries: Entry[] = [
    ...Array.from({ length: WS_BUFFER_MAX + 50 }, (_, i) => order(i)),
    ...Array.from({ length: 30 }, (_, i) => log(i)),
  ];
  const { frames, dropped } = planWsFlush(entries);
  const kept = frames.flat();

  assert.equal(dropped, 80); // 50 条最旧业务 + 30 条日志
  assert.equal(kept.length, WS_BUFFER_MAX);
  assert.equal(kept.filter(e => e.type === "log").length, 0);
  assert.deepEqual(kept[0], order(50)); // 丢掉最旧的 50 条业务
  assert.deepEqual(kept[kept.length - 1], order(WS_BUFFER_MAX + 49));
});

test("空缓冲：不产生空帧", () => {
  const { frames, dropped } = planWsFlush([]);
  assert.deepEqual(frames, []);
  assert.equal(dropped, 0);
});
