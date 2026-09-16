/**
 * 回归测试（2026-09-16）：条件「空闲日志」的展示方向
 *
 * 背景：`price_change_*` 条件无命中时，日志会打印一行「当前持仓最高X%」（X = 扫描范围内该指标的极值）。
 *   该值只用于展示，不参与判定 —— 但它是排查时唯一的可见线索。
 *
 * 缺陷：原先**恒取 max**。对「下穿 -6%」这类条件，显示的是「当前持仓最高5.04%」——
 *   离阈值**最远**的一端。一个已经跌到 -9% 的币永远不会出现在这行里，
 *   排查时会误以为"检测没工作"（用户 2026-09-16 实盘日志踩到）。
 *
 * 修复：按 operator 方向取「最贴近阈值的那一端」——
 *   下穿 / 小于（<、<=）→ 最小值 → 「最低X%」
 *   上穿 / 大于（>、>=）→ 最大值 → 「最高X%」（保持原行为）
 *
 * ⚠️ 纯模块测试：行情与持仓全为内存桩，不碰 trading.db。
 *    node --import tsx --import ./tests/env.ts --import ./tests/setup.ts --test tests/regression-20260916-idle-label-direction.test.ts
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { evaluateTemplateCore, type ConditionEvaluatorDeps } from "../src/engine/diy/core/conditionEvaluator.ts";
import { AccountMonitor } from "../src/services/AccountMonitor.ts";
import { makeDeps, mkTicker, stubSources } from "./fixtures/diyHarness.ts";
import type { ConditionTemplate } from "../src/types/diy.ts";

// ─── 测试基建 ───
// makeDeps / mkTicker / stubSources 复用 ./fixtures/diyHarness.ts，仅额外补持仓桩

const SID = "idle-dir";
const A = "A-USDT-SWAP";
const B = "B-USDT-SWAP";
const strategy = { id: SID, name: `测试策略-${SID}` } as never;
const NO_ACCOUNTS = { accounts: [] } as never;

/**
 * 注入行情 + 持仓。
 * `@positions` 模式的检测范围由 AccountMonitor.getAllPositions() 决定，
 * 故除 stubSources 外还需补一个持仓桩（否则该分支直接返回「无持仓」拿不到空闲日志）。
 */
function stubMarket(quotes: Array<[string, number]>): void {
  const tickers = quotes.map(([id, value]) => mkTicker(id, value));
  stubSources(tickers);
  const monitor = AccountMonitor.getInstance() as unknown as { getAllPositions: () => Array<{ instId: string }> };
  monitor.getAllPositions = () => tickers.map((t) => ({ instId: t.instId }));
}

/** 当日涨幅条件（阈值 -6%，daily 去重；只关心展示值，不关心是否触发） */
const cond = (operator: string, instId: string) => ({
  type: "price_change_today",
  params: { exchange: "okx", instId, operator, threshold: "-6", repeat: "daily" },
});

/**
 * 跑一个 tick，读回条件 0 写入 liveStates 的展示值。
 * 该值正是日志里的空闲文案（getEvaluationLogMessageCore 从 liveStates 取 currentVal）。
 */
function tickDisplayValue(deps: ConditionEvaluatorDeps, condition: unknown): string | undefined {
  const template = { conditions: [condition] } as unknown as ConditionTemplate;
  evaluateTemplateCore(deps, strategy, template, 0, NO_ACCOUNTS);
  return deps.liveStates.get(`${SID}:0:0`)?.currentVal;
}

// ─── 测试 ───

describe("条件空闲日志 · 展示方向（2026-09-16 回归）", () => {
  test("下穿 + 当前仓位交易对 → 「当前持仓最低X%」（修复前恒为最高，取到 +1.50 完全无关的值）", () => {
    const deps = makeDeps();
    stubMarket([[A, -9.12], [B, 1.5]]);
    // 下穿首次检测只登记 crossState、不触发 → 无命中 → 走空闲文案
    const value = tickDisplayValue(deps, cond("cross_below", "@positions"));
    assert.equal(value, "当前持仓最低-9.12%", "下穿条件必须取最小值（-9.12），而非最大值 +1.50");
  });

  test("小于（<）+ 当前仓位交易对 → 同样取最小值", () => {
    const deps = makeDeps();
    // 两个值都在阈值之上 → 无命中（否则会打印满足列表而非空闲文案）
    stubMarket([[A, -5.0], [B, 1.5]]);
    const value = tickDisplayValue(deps, cond("<", "@positions"));
    assert.equal(value, "当前持仓最低-5.00%", "小于类条件同样取最小值（-5.00），而非 +1.50");
  });

  test("大于（>）+ 当前仓位交易对 → 保持「当前持仓最高X%」（原行为不变）", () => {
    const deps = makeDeps();
    // 两个值都在阈值之下 → 无命中
    stubMarket([[A, -9.12], [B, -7.5]]);
    const value = tickDisplayValue(deps, cond(">", "@positions"));
    assert.equal(value, "当前持仓最高-7.50%", "大于类条件仍取最大值（-7.50，最贴近阈值的一端）");
  });

  test("全市场（空 instId）→ 不带「当前持仓」前缀，方向词仍跟随 operator", () => {
    const deps = makeDeps();
    stubMarket([[A, -9.12], [B, 1.5]]);
    const value = tickDisplayValue(deps, cond("cross_below", ""));
    assert.equal(value, "最低-9.12%", "全市场范围不应出现「当前持仓」前缀");
  });
});
