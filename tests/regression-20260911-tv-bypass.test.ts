/**
 * 回归测试（2026-09-11）：TV 信号不得绕过 FT 指标条件
 *
 * 背景：evaluateTemplateCore 里「失败条件全为 indicator 则视为通过」的兜底，
 * 其前置判断用的是 hadPendingSignal = hasAnySignal()（tv / ft 任一来源有信号即为 true）。
 * 于是「TV 信号条件 + FT 指标条件」的混合策略只要收到 TV 信号，
 * indicator 条件全部失败时兜底会把 allMatched 改回 true
 * → 指标条件未满足也会执行下单/平仓（错触发，资金风险）。
 *
 * 修复：兜底额外要求 hasSignalForSource(..., 'ft') 为 true。
 * indicator 由 freqtrade 侧求值：有 FT 信号时它必然 matched；
 * 无 FT 信号时的失败属正常「未触发」，绝不可放行。
 *
 * ⚠️ 纯模块测试：不碰 trading.db、不跑整套 npm test。
 *    运行前需确保 better-sqlite3 为 node ABI（若上次跑的是 Electron：
 *    npm rebuild better-sqlite3），并建议用独立数据目录避免碰真实 trading.db：
 *      ELECTRON_USER_DATA_PATH=<临时目录> npx tsx --test tests/regression-20260911-tv-bypass.test.ts
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { evaluateTemplateCore, type ConditionEvaluatorDeps } from "../src/engine/diy/core/conditionEvaluator.ts";
import { makeDeps, mkStrategy, mkTemplate, stubAccountData } from "./fixtures/diyHarness.ts";

// ─── 测试基建 ───
// makeDeps / mkStrategy / mkTemplate / stubAccountData 统一由 ./fixtures/diyHarness.ts 提供

type SignalSource = "tv" | "ft";

/** 投递信号（key 格式与 signalQueue 一致：{strategyId}:{source}） */
function pushSignal(deps: ConditionEvaluatorDeps, strategyId: string, source: SignalSource): void {
  deps.pendingSignals.set(`${strategyId}:${source}`, { receivedAt: Date.now(), payload: {} });
}

const tvCond = () => ({ type: "tv_signal", params: {} });
const indicatorCond = () => ({ type: "indicator", params: {} });

/** 预置「未匹配告警已打」标记，避免测试写日志（测试不碰 trading.db） */
function silenceUnmatchedWarn(deps: ConditionEvaluatorDeps, strategyId: string): void {
  deps.conditionState.set(`__signalWarned:${strategyId}`, { result: true, lastLoggedAt: Date.now() });
}

describe("TV 信号不得绕过 FT 指标条件（2026-09-11 回归）", () => {
  test("TV 信号到达但 FT 指标条件未满足 → allMatched=false（修复前会被兜底误放行）", () => {
    const deps = makeDeps();
    stubAccountData();
    const strategy = mkStrategy("tvbypass");
    silenceUnmatchedWarn(deps, strategy.id);
    // 只有 TV 信号，没有 FT 信号：indicator 条件应判定为未满足
    pushSignal(deps, strategy.id, "tv");
    const template = mkTemplate([tvCond(), indicatorCond()] as never);

    const result = evaluateTemplateCore(deps, strategy, template, 0, { accounts: [] } as never);

    assert.equal(result.allMatched, false, "FT 指标未满足时不得因 TV 信号而放行（会错触发下单）");
  });

  test("仅 indicator 条件 + FT 信号存在 → allMatched=true（正常路径未被破坏）", () => {
    const deps = makeDeps();
    stubAccountData();
    const strategy = mkStrategy("ftonly");
    pushSignal(deps, strategy.id, "ft");
    const template = mkTemplate([indicatorCond()] as never);

    const result = evaluateTemplateCore(deps, strategy, template, 0, { accounts: [] } as never);

    assert.equal(result.allMatched, true, "FT 信号到达且指标条件由 FT 侧确认时应正常触发");
  });

  test("TV + FT 信号同时存在 → 两类条件均满足 → allMatched=true", () => {
    const deps = makeDeps();
    stubAccountData();
    const strategy = mkStrategy("tvft");
    pushSignal(deps, strategy.id, "tv");
    pushSignal(deps, strategy.id, "ft");
    const template = mkTemplate([tvCond(), indicatorCond()] as never);

    const result = evaluateTemplateCore(deps, strategy, template, 0, { accounts: [] } as never);

    assert.equal(result.allMatched, true, "两个来源的信号都到达时应触发");
  });

  test("无任何信号 → allMatched=false（兜底不得凭空触发）", () => {
    const deps = makeDeps();
    stubAccountData();
    const strategy = mkStrategy("nosignal");
    const template = mkTemplate([indicatorCond()] as never);

    const result = evaluateTemplateCore(deps, strategy, template, 0, { accounts: [] } as never);

    assert.equal(result.allMatched, false, "无信号时不得触发");
  });
});
