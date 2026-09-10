/**
 * 回测修复回归测试（#31，2026-09-07）
 *
 * 覆盖 2026-09-07 三批修复中可纯函数测试的核心逻辑：
 * 1. runBatched（#8 OKX 限流执行器）：顺序保持、并发上限、批间间隔
 * 2. signalPairToInstId（#5 FT/TV 信号 pair 归一化）：ccxt/OKX/无法识别格式
 * 3. historyCacheService（平仓/撤单后历史延迟显示）：TTL、失效、isRecordStale 双窗口
 *
 * ⚠️ 这些模块均为零重依赖纯模块，可在系统 Node 下独立运行：
 *    npx tsx --test tests/regression-20260907.test.ts
 * （不要在测试里 import dbService/AccountMonitor 等重链——better-sqlite3 为 Electron 编译，
 *   系统 Node 加载不了；整套 npm test 需在 Electron 环境跑。）
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { runBatched } from "../src/lib/runBatched.ts";
import { signalPairToInstId } from "../src/lib/signalPairUtils.ts";
import { ftPairToOkxPair, jsDayToPandasDay } from "../src/freqtrade/strategyGenerator.ts";
import {
  getHistoryCache,
  setHistoryCache,
  invalidateOrdersHistoryCache,
  invalidatePositionsHistoryCache,
  isRecordStale,
  INVALIDATED_WINDOW_MS,
  STALE_WINDOW_MS,
  STALE_SHORT_TTL_MS,
} from "../src/services/historyCacheService.ts";

// ─── runBatched（#8 限流执行器）───

describe("runBatched", () => {
  test("保持任务顺序与结果一一对应", async () => {
    const tasks = [1, 2, 3, 4, 5].map(n => async () => {
      // 故意乱序完成：越靠后的任务越快返回
      await new Promise(r => setTimeout(r, (6 - n) * 5));
      return n * 10;
    });
    const out = await runBatched(tasks, 5, 0);
    assert.deepEqual(out, [10, 20, 30, 40, 50]);
  });

  test("单批内并发不超过 limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const tasks = Array.from({ length: 12 }, (_, i) => async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 10));
      inFlight--;
      return i;
    });
    await runBatched(tasks, 3, 5);
    assert.ok(maxInFlight <= 3, `峰值并发 ${maxInFlight} 超过 limit=3`);
  });

  test("批间等待 gapMs（12 任务每批 5 个应有 2 次间隔）", async () => {
    const t0 = Date.now();
    const tasks = Array.from({ length: 12 }, () => async () => 1);
    await runBatched(tasks, 5, 40);
    const elapsed = Date.now() - t0;
    // 2 次批间隔 = 80ms；任务本身瞬时完成，余量放宽
    assert.ok(elapsed >= 80, `耗时 ${elapsed}ms 小于预期的 2×40ms 批间隔`);
  });
});

// ─── signalPairToInstId / ftPairToOkxPair（#5 信号 pair 透传）───

describe("signalPairToInstId", () => {
  test("freqtrade ccxt 合约格式 → OKX SWAP", () => {
    assert.equal(signalPairToInstId("BTC/USDT:USDT"), "BTC-USDT-SWAP");
    assert.equal(signalPairToInstId("RAY/USDT:USDT"), "RAY-USDT-SWAP");
  });

  test("freqtrade ccxt 现货格式 → OKX 现货", () => {
    assert.equal(signalPairToInstId("BTC/USDT"), "BTC-USDT");
  });

  test("OKX 原生格式原样通过（含首尾空白裁剪）", () => {
    assert.equal(signalPairToInstId("BTC-USDT-SWAP"), "BTC-USDT-SWAP");
    assert.equal(signalPairToInstId("  ETH-USDT  "), "ETH-USDT");
  });

  test("无法识别的格式返回空串（不参与交易对交集）", () => {
    // TradingView 自定义格式：无 - 或 /
    assert.equal(signalPairToInstId("BINANCE:BTCUSDT"), "");
    assert.equal(signalPairToInstId(""), "");
    assert.equal(signalPairToInstId("   "), "");
  });
});

describe("ftPairToOkxPair", () => {
  test("反向与正向格式全覆盖", () => {
    assert.equal(ftPairToOkxPair("BTC/USDT:USDT"), "BTC-USDT-SWAP");
    assert.equal(ftPairToOkxPair("BTC/USDT"), "BTC-USDT");
    assert.equal(ftPairToOkxPair("BTC-USDT-SWAP"), "BTC-USDT-SWAP");
    assert.equal(ftPairToOkxPair("BTC-USDT"), "BTC-USDT");
  });
});

// ─── jsDayToPandasDay（#14 星期编码换算）───

describe("jsDayToPandasDay", () => {
  test("JS getDay（周日=0）→ pandas dayofweek（周一=0）全 7 天映射", () => {
    // 周日: getDay=0 → dayofweek=6；周一: 1 → 0；周六: 6 → 5
    assert.equal(jsDayToPandasDay(0), 6, "周日 getDay=0 应映射到 dayofweek=6");
    assert.equal(jsDayToPandasDay(1), 0, "周一 getDay=1 应映射到 dayofweek=0");
    assert.equal(jsDayToPandasDay(2), 1);
    assert.equal(jsDayToPandasDay(3), 2);
    assert.equal(jsDayToPandasDay(4), 3);
    assert.equal(jsDayToPandasDay(5), 4);
    assert.equal(jsDayToPandasDay(6), 5, "周六 getDay=6 应映射到 dayofweek=5");
  });
});

// ─── historyCacheService（平仓/撤单后历史延迟显示）───
// mock Date.now 做时间确定性（模块内部全部用 Date.now 计时）

describe("historyCacheService", () => {
  const NOW = 1_700_000_000_000;

  test("TTL 语义：默认 120s、自定义短 TTL、过期即失效", (t) => {
    const clock = t.mock.timers;
    clock.enable({ apis: ["Date"], now: NOW });

    const key = "orders-history:acc-a:SWAP::100";
    setHistoryCache(key, { ok: true }); // 默认 120s
    clock.tick(119_000);
    assert.ok(getHistoryCache(key), "119s 时应命中");
    clock.tick(2_000); // 121s
    assert.equal(getHistoryCache(key), null, "121s 应过期");

    // 短 TTL：缺失结果只缓存 15s，下轮轮询即可重查
    setHistoryCache(key, { ok: true }, STALE_SHORT_TTL_MS);
    clock.tick(STALE_SHORT_TTL_MS - 1_000);
    assert.ok(getHistoryCache(key), "短 TTL 14s 时应命中");
    clock.tick(2_000);
    assert.equal(getHistoryCache(key), null, "短 TTL 15s 后应过期");
  });

  test("invalidate 按账户前缀清除缓存并打点", (t) => {
    const clock = t.mock.timers;
    clock.enable({ apis: ["Date"], now: NOW });

    setHistoryCache("orders-history:acc-b:SWAP::100", { ok: true });
    setHistoryCache("algo-history:acc-b:SWAP::100", { ok: true });
    setHistoryCache("positions-history:acc-b:SWAP::100", { ok: true });
    setHistoryCache("orders-history:acc-c:SWAP::100", { ok: true });

    invalidateOrdersHistoryCache("acc-b");

    assert.equal(getHistoryCache("orders-history:acc-b:SWAP::100"), null, "同账户 orders 应被清除");
    assert.equal(getHistoryCache("algo-history:acc-b:SWAP::100"), null, "同账户 algo 应被清除");
    assert.ok(getHistoryCache("positions-history:acc-b:SWAP::100"), "positions 不随撤单失效");
    assert.ok(getHistoryCache("orders-history:acc-c:SWAP::100"), "其他账户不受影响");
  });

  test("isRecordStale：未失效过 → false", (t) => {
    const clock = t.mock.timers;
    clock.enable({ apis: ["Date"], now: NOW });

    assert.equal(isRecordStale("acc-never", []), false, "无失效标记不判陈旧");
  });

  test("isRecordStale：失效窗口内缺失新记录 → true（触发 3s 重试 + 15s 短缓存）", (t) => {
    const clock = t.mock.timers;
    clock.enable({ apis: ["Date"], now: NOW });

    invalidateOrdersHistoryCache("acc-d");
    // 空结果（OKX 尚未生成）
    assert.equal(isRecordStale("acc-d", []), true);
    // 最新记录早于失效时刻（时钟容忍 3s 内不算新）→ 仍是缺失
    const oldRows = [{ uTime: String(NOW - 10_000) }];
    assert.equal(isRecordStale("acc-d", oldRows), true, "失效前 10s 的旧记录不算新记录");
    // 最新记录晚于失效时刻 → 拿到新记录，不 stale
    const newRows = [{ uTime: String(NOW + 1_000) }];
    assert.equal(isRecordStale("acc-d", newRows), false);
  });

  test("isRecordStale 双窗口：12s 重试窗口过期后，5min 短缓存窗口仍生效", (t) => {
    const clock = t.mock.timers;
    clock.enable({ apis: ["Date"], now: NOW });

    invalidateOrdersHistoryCache("acc-e");
    clock.tick(INVALIDATED_WINDOW_MS + 1_000); // 13s：超出重试窗口

    assert.equal(isRecordStale("acc-e", []), false, "13s 后不再触发 3s 重试");
    assert.equal(
      isRecordStale("acc-e", [], STALE_WINDOW_MS),
      true,
      "13s 仍在 5min 短缓存窗口内，缺失结果应只缓存 15s",
    );

    clock.tick(5 * 60_000); // 再走 5min：累计 13s + 5min > STALE_WINDOW_MS
    assert.equal(isRecordStale("acc-e", [], STALE_WINDOW_MS), false, "5min 窗口过期后回归正常缓存语义");
  });

  test("订单与仓位失效时刻分开打点（撤单不误伤仓位 stale 判定）", (t) => {
    const clock = t.mock.timers;
    clock.enable({ apis: ["Date"], now: NOW });

    invalidateOrdersHistoryCache("acc-f"); // 只撤单
    assert.equal(isRecordStale("acc-f", [], STALE_WINDOW_MS, "positions"), false, "撤单不应让仓位判 stale");

    invalidatePositionsHistoryCache("acc-f"); // 平仓
    assert.equal(isRecordStale("acc-f", [], STALE_WINDOW_MS, "positions"), true, "平仓后仓位缺失应判 stale");
    assert.equal(isRecordStale("acc-f", [], STALE_WINDOW_MS, "orders"), true, "订单仍在其窗口内");
  });
});
