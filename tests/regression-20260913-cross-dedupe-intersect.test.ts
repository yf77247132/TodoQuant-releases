/**
 * 回归测试（2026-09-13）：跨条件去重标记未按交集过滤 → 交易对「未执行动作却被消费触发额度」
 *
 * 场景：配置「上穿 7% 每日 1 次」+「24H涨幅 > 7%」两条件取交集。
 *   同一 tick 内 A、B 两个交易对都上穿阈值，但只有 A 同时满足 24H 条件 → 交集 = [A]。
 *   A 正常执行动作并记录消费；B 没进交集、没执行动作，却被**连带写入**去重标记。
 *
 * 根因：pendingTriggeredUpdates 是「条件级」收集的（该 tick 上穿即入队），
 *       而提交闸门 allMatched 是「模板级」判定 —— 只要本批有任意一个交易对凑齐交集，
 *       同批所有「上穿过」的交易对就被整批落库。
 *
 * 后果：B 之后重新上穿（跌破再涨回）且两条件都满足时，会在**条件层**就被
 *       isAlreadyTriggered 拦死（daily 模式当天 / once 模式生命周期内）→ 永久漏触发。
 *
 * 修复：instrumentTriggered 提交时按最终交集 triggeredInstIds 过滤。
 *
 * ⚠️ 纯模块测试：不碰 trading.db、不跑整套 npm test。
 *    npx tsx --test tests/regression-20260913-cross-dedupe-intersect.test.ts
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { evaluateTemplateCore, type ConditionEvaluatorDeps } from "../src/engine/diy/core/conditionEvaluator.ts";
import { makeDeps, mkTicker, stubSources } from "./fixtures/diyHarness.ts";
import type { DIYStrategy, ConditionTemplate } from "../src/types/diy.ts";

// ─── 测试基建 ───
// makeDeps / mkTicker / stubSources 统一由 ./fixtures/diyHarness.ts 提供

const SID = "ab-dedupe";
const A = "A-USDT-SWAP";
const B = "B-USDT-SWAP";

/** 逐 tick 可变行情：today = 当日涨幅（条件0 用），h24 = 24H涨幅（条件1 用） */
interface Quote { today: number; h24: number }

const strategy = { id: SID, name: `测试策略-${SID}` } as unknown as DIYStrategy;

/** 条件0：当日涨幅「上穿」7%，全市场（空 instId），每日 1 次 */
const crossCond = {
  type: "price_change_today",
  params: { exchange: "okx", instId: "", operator: "cross_above", threshold: "7", repeat: "daily" },
};

/** 条件1：24H涨幅 > 7%，全市场，允许重复（仅作过滤，不参与去重） */
const filterCond = {
  type: "price_change_24h",
  params: { exchange: "okx", instId: "", operator: ">", threshold: "7", repeat: "repeat" },
};

const template = { conditions: [crossCond, filterCond] } as unknown as ConditionTemplate;
const NO_ACCOUNTS = { accounts: [] } as never;

/** 推进一个 tick：设置行情 → 求值 → 返回结果 */
function tick(deps: ConditionEvaluatorDeps, qa: Quote, qb: Quote) {
  // fixture 签名 mkTicker(instId, change24h, changeToday)：两个条件分别读 24H 与当日涨幅
  stubSources([mkTicker(A, qa.h24, qa.today), mkTicker(B, qb.h24, qb.today)]);
  return evaluateTemplateCore(deps, strategy, template, 0, NO_ACCOUNTS);
}

const keyOf = (condIdx: number, instId: string) => `${SID}:${condIdx}:${instId}`;

// ─── 测试 ───

describe("跨条件去重标记按交集过滤（2026-09-13 回归）", () => {
  test("A 进入交集执行动作、B 被 24H 条件拦下 → B 不得被标记「已触发」", () => {
    const deps = makeDeps();

    // t1：A、B 当日涨幅均在 7% 之下 → 无上穿
    const r1 = tick(deps, { today: 6.5, h24: 9 }, { today: 6.8, h24: 5 });
    assert.equal(r1.allMatched, false, "尚未上穿，不应触发");
    assert.equal(deps.instrumentTriggered.size, 0, "未触发时不得写入任何去重标记");

    // t2：A、B 同时上穿 7%；条件1 只匹配 A（B 的 24H=5% 不达标）
    const r2 = tick(deps, { today: 7.5, h24: 9 }, { today: 7.2, h24: 5 });
    assert.equal(r2.allMatched, true, "A 满足全部条件，模板应触发");
    assert.deepEqual(r2.triggeredInstIds, [A], "交集应只有 A");

    assert.ok(
      deps.instrumentTriggered.has(keyOf(0, A)),
      "A 执行了动作 → 应消费当日额度",
    );
    assert.ok(
      !deps.instrumentTriggered.has(keyOf(0, B)),
      "B 未进入交集、未执行动作 → 绝不能被标记「已触发」（本次修复点）",
    );
  });

  test("B 之后跌破再重新上穿、两条件均满足 → 仍能正常触发（漏触发已修复）", () => {
    const deps = makeDeps();

    // t1/t2：复现同批上穿，B 被拦
    tick(deps, { today: 6.5, h24: 9 }, { today: 6.8, h24: 5 });
    tick(deps, { today: 7.5, h24: 9 }, { today: 7.2, h24: 5 });

    // t3：双双跌破 7%（上穿是边沿事件，必须先跌破才能重新上穿）
    const r3 = tick(deps, { today: 6.0, h24: 9 }, { today: 6.0, h24: 5 });
    assert.equal(r3.allMatched, false, "跌破后无上穿，不应触发");

    // t4：双双重新上穿，且两者 24H 涨幅都 > 7%
    //     A 已在 t2 消费额度 → 被条件层拦下；B 未被误标 → 应正常进入交集
    const r4 = tick(deps, { today: 7.8, h24: 9 }, { today: 7.5, h24: 10 });
    assert.equal(r4.allMatched, true, "B 应能正常触发（修复前此处 allMatched=false → B 漏触发）");
    assert.deepEqual(r4.triggeredInstIds, [B], "A 已消费、B 未消费 → 交集应只有 B");
    assert.ok(deps.instrumentTriggered.has(keyOf(0, B)), "B 执行动作后应消费当日额度");
  });

  test("本批无人凑齐交集 → 任何交易对都不写标记（行为与修复前一致）", () => {
    const deps = makeDeps();

    tick(deps, { today: 6.5, h24: 9 }, { today: 6.8, h24: 5 });
    // 双双上穿，但两者 24H 涨幅都不达标 → 交集为空
    const r = tick(deps, { today: 7.5, h24: 3 }, { today: 7.2, h24: 5 });

    assert.equal(r.allMatched, false, "交集为空 → 整体不触发");
    assert.equal(deps.instrumentTriggered.size, 0, "全批失败时不得写入任何去重标记");
  });

  test("单交易对正常触发路径不受影响", () => {
    const deps = makeDeps();

    tick(deps, { today: 6.5, h24: 9 }, { today: 6.0, h24: 3 });
    const r = tick(deps, { today: 7.5, h24: 9 }, { today: 6.0, h24: 3 });

    assert.equal(r.allMatched, true);
    assert.deepEqual(r.triggeredInstIds, [A]);
    assert.ok(deps.instrumentTriggered.has(keyOf(0, A)), "唯一触发交易对应正常消费");
  });
});
