/**
 * 回归测试（2026-09-09）：conditionEvaluator 交集判定提前
 *
 * 背景：evaluateTemplateCore 原先在提交循环里用"未经交集降级的 allMatched"
 * 写入 instrumentTriggered 去重标记，导致"两个价格条件各自触发不同交易对 →
 * 交集为空"时交易对被误标"已触发过"且动作不执行。
 *
 * 修复后：交集计算与终值判定提前到提交循环之前，提交循环使用最终 allMatched。
 *
 * ⚠️ 纯模块测试：不碰 trading.db、不跑整套 npm test。
 *    npx tsx --test tests/regression-20260909-intersection.test.ts
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { evaluateTemplateCore, type ConditionEvaluatorDeps } from "../src/engine/diy/core/conditionEvaluator.ts";
import { marketScanner, type TickerData } from "../src/services/MarketScanner.ts";
import { AccountMonitor } from "../src/services/AccountMonitor.ts";
import type { DIYStrategy, ConditionTemplate } from "../src/types/diy.ts";

// ─── 测试基建 ───

/** 构造指定涨幅的 ticker */
function mkTicker(instId: string, change24h: number): TickerData {
  return {
    instId, last: 100, open24h: 100 / (1 + change24h / 100), sodUtc8: 100,
    high24h: 100, low24h: 100, volCcy24h: 1000, change24h, changeToday: change24h, ts: Date.now(),
  };
}

/** 用最小 deps 运行 evaluateTemplateCore（price_change 指定 instId 时不依赖账户数据） */
function makeDeps(): ConditionEvaluatorDeps {
  return {
    conditionState: new Map(),
    liveStates: new Map(),
    userTimezone: null,
    lastTriggeredMap: new Map(),
    pendingSignals: new Map(),
    fundingRateCache: new Map(),
    crossState: new Map(),
    instrumentTriggered: new Map(),
    checkSafetyLocks: () => true,
  };
}

function mkStrategy(id: string): DIYStrategy {
  return { id, name: `测试策略-${id}` } as unknown as DIYStrategy;
}

function mkTemplate(conditions: ConditionTemplate["conditions"]): ConditionTemplate {
  return { conditions } as unknown as ConditionTemplate;
}

/** 注入涨幅缓存并屏蔽账户数据依赖 */
function stubSources(tickers: TickerData[]): void {
  Object.assign(marketScanner, {
    getTicker: (_exchange: string, instId: string) => tickers.find(t => t.instId === instId),
    getAllTickers: () => tickers,
  });
  Object.assign(AccountMonitor.getInstance(), { getAccountData: () => null });
}

const priceCond = (instId: string) => ({
  type: "price_change",
  params: { exchange: "okx", instId, operator: ">", threshold: "5" },
});

describe("conditionEvaluator 交集判定（2026-09-09 回归）", () => {
  test("两个价格条件各触发不同交易对 → 交集空 → allMatched=false 且 instrumentTriggered 未写入", () => {
    const deps = makeDeps();
    stubSources([mkTicker("BTC-USDT-SWAP", 8), mkTicker("ETH-USDT-SWAP", 8)]);
    const strategy = mkStrategy("itx-empty");
    // 条件0 只可能触发 BTC，条件1 只可能触发 ETH → 交集必然为空
    const template = mkTemplate([priceCond("BTC-USDT-SWAP"), priceCond("ETH-USDT-SWAP")]);

    const result = evaluateTemplateCore(deps, strategy, template, 0, { accounts: [] } as never);

    assert.equal(result.allMatched, false, "交集为空应降级为未触发");
    assert.deepEqual(result.triggeredInstIds, [], "交集为空时不应有触发交易对");
    assert.equal(deps.instrumentTriggered.size, 0, "交集为空时不得写入 instrumentTriggered 去重标记");
  });

  test("同引擎此前行为对照：单价格条件命中 → 正常触发且去重标记写入", () => {
    const deps = makeDeps();
    stubSources([mkTicker("BTC-USDT-SWAP", 8)]);
    const strategy = mkStrategy("itx-single");
    const template = mkTemplate([priceCond("BTC-USDT-SWAP")]);

    const result = evaluateTemplateCore(deps, strategy, template, 0, { accounts: [] } as never);

    assert.equal(result.allMatched, true);
    assert.deepEqual(result.triggeredInstIds, ["BTC-USDT-SWAP"]);
    assert.ok(deps.instrumentTriggered.has("itx-single:0:BTC-USDT-SWAP"), "正常触发应写入去重标记");
  });

  test("两个价格条件命中同一交易对 → 交集非空 → allMatched=true 且标记写入", () => {
    const deps = makeDeps();
    stubSources([mkTicker("BTC-USDT-SWAP", 8)]);
    const strategy = mkStrategy("itx-same");
    const template = mkTemplate([priceCond("BTC-USDT-SWAP"), { ...priceCond("BTC-USDT-SWAP") }]);

    const result = evaluateTemplateCore(deps, strategy, template, 0, { accounts: [] } as never);

    assert.equal(result.allMatched, true, "同交易对交集非空应正常触发");
    assert.deepEqual(result.triggeredInstIds, ["BTC-USDT-SWAP"]);
    assert.ok(deps.instrumentTriggered.has("itx-same:0:BTC-USDT-SWAP"));
    assert.ok(deps.instrumentTriggered.has("itx-same:1:BTC-USDT-SWAP"));
  });
});
