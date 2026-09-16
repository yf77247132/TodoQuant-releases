/**
 * 回归测试（2026-09-12）：免账户条件的 accountId 残留导致误报「账户不存在」
 *
 * 背景：evaluateTemplateCore 的「账户存在性校验」未区分条件类型。
 * 市场类条件（price_change / price_change_today / price_change_high24h 等）
 * 只读全市场行情，不消费账户数据，但其 params 里可能残留**已删除账户**的 accountId
 * （旧版表单未清空 / 模板复制带过来）。此时引擎会：
 *   1. 每秒刷日志「条件 N 指定的账户不存在…」→ 日志爆炸
 *   2. 把该条件误判为「未满足」→ 策略永不触发（市场条件根本不用账户）
 *
 * 修复：校验前先按条件类型分流，免账户条件直接忽略 accountId，
 *       并对真正缺失账户的告警做节流（60s 一次，原先 1s 一次）。
 *
 * ⚠️ 纯模块测试：不碰 trading.db、不跑整套 npm test。
 *    npx tsx --test tests/regression-20260912-accountfree-cond.test.ts
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { evaluateTemplateCore } from "../src/engine/diy/core/conditionEvaluator.ts";
import { LogService } from "../src/services/logService.ts";
import { makeDeps, mkStrategy, mkTemplate, mkTicker, stubSources } from "./fixtures/diyHarness.ts";

// ─── 测试基建 ───
// makeDeps / mkStrategy / mkTemplate / mkTicker / stubSources 统一由 ./fixtures/diyHarness.ts 提供

/** 已被删除的账户 ID（任何条件下都解析不到） */
const GONE_ACCOUNT_ID = "e3e2249183dcbcbfb17891f4489856d5";

/** 捕获 logKey 调用（用于断言是否误报账户不存在） */
function captureLogs(): { keys: string[]; restore: () => void } {
  const original = LogService.logKey;
  const keys: string[] = [];
  (LogService as unknown as { logKey: typeof LogService.logKey }).logKey = ((_s: string, key: string) => {
    keys.push(key);
  }) as typeof LogService.logKey;
  return { keys, restore: () => { (LogService as unknown as { logKey: typeof LogService.logKey }).logKey = original; } };
}

/** 市场条件：24H涨幅（免账户），可携带残留 accountId */
const marketCond = (instId: string, accountId?: string) => ({
  type: "price_change_today",
  params: {
    exchange: "okx", instId, window: "today", operator: ">", threshold: "5",
    ...(accountId ? { accountId } : {}),
  },
});

/** 账户条件：余额检测（必须解析账户），携带失效 accountId */
const accountCond = (accountId: string) => ({
  type: "balance_less",
  params: { accountId, operator: "<", threshold: "1000" },
});

const NO_ACCOUNTS = { accounts: [] } as never;

describe("免账户条件的 accountId 残留（2026-09-12 回归）", () => {
  test("市场条件携带已删除账户 ID → 仍正常求值触发，且不误报账户不存在", () => {
    const deps = makeDeps();
    stubSources([mkTicker("BTC-USDT-SWAP", 8)]);
    const strategy = mkStrategy("af-market");
    const template = mkTemplate([marketCond("BTC-USDT-SWAP", GONE_ACCOUNT_ID) as never]);

    const logs = captureLogs();
    let result;
    try {
      result = evaluateTemplateCore(deps, strategy, template, 0, NO_ACCOUNTS);
    } finally {
      logs.restore();
    }

    assert.equal(result.allMatched, true, "市场条件不受残留 accountId 影响，应正常触发");
    assert.deepEqual(result.triggeredInstIds, ["BTC-USDT-SWAP"], "应产出触发交易对");
    assert.ok(
      !logs.keys.includes("diy.cond.accountMissing"),
      `免账户条件不得报「账户不存在」，实际日志：${logs.keys.join(", ")}`,
    );
  });

  test("账户条件携带已删除账户 ID → 仍判为未满足（误触发防护未被削弱）", () => {
    const deps = makeDeps();
    stubSources([mkTicker("BTC-USDT-SWAP", 8)]);
    const strategy = mkStrategy("af-account");
    const template = mkTemplate([accountCond(GONE_ACCOUNT_ID) as never]);

    const result = evaluateTemplateCore(deps, strategy, template, 0, NO_ACCOUNTS);

    assert.equal(result.allMatched, false, "账户缺失仍须判为未满足 —— 宁可漏触发，不可误触发");
    assert.deepEqual(result.triggeredInstIds, []);
  });

  test("市场条件 + 账户条件混合：账户条件账户失效仍拦截整个模板", () => {
    const deps = makeDeps();
    stubSources([mkTicker("BTC-USDT-SWAP", 8)]);
    const strategy = mkStrategy("af-mixed");
    const template = mkTemplate([
      marketCond("BTC-USDT-SWAP", GONE_ACCOUNT_ID) as never, // 免账户，正常满足
      accountCond(GONE_ACCOUNT_ID) as never,                 // 账户失效 → 拦截
    ]);

    const result = evaluateTemplateCore(deps, strategy, template, 0, NO_ACCOUNTS);

    // 执行闸门是 allMatched（DiyEngine.ts:373 `if (!allMatched) continue`）。
    // triggeredInstIds 由「价格条件交集」得出，账户条件不参与交集 → 此处可能非空，
    // 但 allMatched=false 时 DiyEngine 不会执行任何动作，故非空不构成风险。
    assert.equal(result.allMatched, false, "模板内任一账户条件失效即整体未满足，动作被拦截");
    assert.ok(result.triggeredInstIds.length <= 1, "交易对列表仅来自价格条件交集，不应凭空增长");
  });

  test("市场条件不携带 accountId（正常配置）→ 行为与修复前一致", () => {
    const deps = makeDeps();
    stubSources([mkTicker("BTC-USDT-SWAP", 8)]);
    const strategy = mkStrategy("af-clean");
    const template = mkTemplate([marketCond("BTC-USDT-SWAP") as never]);

    const result = evaluateTemplateCore(deps, strategy, template, 0, NO_ACCOUNTS);

    assert.equal(result.allMatched, true);
    assert.deepEqual(result.triggeredInstIds, ["BTC-USDT-SWAP"]);
  });
});
