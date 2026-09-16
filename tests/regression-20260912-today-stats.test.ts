/**
 * 回归测试（2026-09-12）：今日开仓统计口径 =「开仓时间为今日」的仓位生命周期数
 *
 * 背景（用户报）：旧实现只把「当前持仓 + 历史中已**完全平仓**(type=2)」两边相加 →
 *   1) 开仓于今日但被强平/强减/ADL(type 3/4/5) 的仓位**漏计**；
 *   2) 若简单改成"两边都收"，部分平仓(type=1)后剩余仍持仓的仓位会**重复计数**
 *      —— 实测该仓位同时存在于当前持仓与历史（posId + cTime 完全一致）。
 *
 * 修复：合并「当前持仓 + 历史仓位」后按 positionLifecycleKey=(账户,posId,cTime) 去重计数。
 *
 * ⚠️ 纯模块测试（src/lib/todayStats.ts 无 React 依赖）：
 *    npx tsx --test tests/regression-20260912-today-stats.test.ts
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  computeTodayStats,
  todayStartMs,
  positionLifecycleKey,
} from "../src/lib/todayStats.ts";
import type { HistoryPosition } from "../src/components/dashboard/HistoryPositionTable.tsx";
import type { Order, Position } from "../src/types/index.ts";

// ─── 测试基建 ───

const T0 = todayStartMs();
/** 今日某时刻（相对零点偏移小时） */
const todayAt = (hours: number): string => String(T0 + hours * 3600_000);
/** 昨日某时刻 */
const yesterdayAt = (hours: number): string => String(T0 - 24 * 3600_000 + hours * 3600_000);

const ACC = "acct-1";

/** 构造历史仓位记录（OKX positions-history 口径） */
function mkHist(o: {
  posId: string; instId?: string; cTime: string; uTime?: string;
  type?: string; realizedPnl?: string; accountId?: string;
}): HistoryPosition {
  return {
    posId: o.posId,
    instId: o.instId || "BTC-USDT-SWAP",
    ccy: "USDT",
    direction: "long",
    lever: "10",
    openAvgPx: "100",
    closeAvgPx: "101",
    openMaxPos: "10",
    closeTotalPos: "10",
    realizedPnl: o.realizedPnl ?? "1",
    pnlRatio: "0.01",
    posSide: "long",
    mgnMode: "cross",
    cTime: o.cTime,
    uTime: o.uTime ?? o.cTime,
    type: o.type ?? "2",
    typeDisplay: "完全平仓",
    _account: 0,
    _accountId: o.accountId || ACC,
    exchange: "OKX",
  } as HistoryPosition;
}

/** 构造当前持仓 */
function mkPos(o: {
  posId: string; instId?: string; cTime: string; accountId?: string;
}): Position {
  return {
    posId: o.posId,
    instId: o.instId || "BTC-USDT-SWAP",
    pos: "10",
    availPos: "10",
    avgPx: "100",
    upl: "1",
    uplRatio: "0.01",
    lever: "10",
    posSide: "long",
    instType: "SWAP",
    _account: 0,
    _accountId: o.accountId || ACC,
    last: "101",
    liqPx: "90",
    cTime: o.cTime,
  } as unknown as Position;
}

/** 构造历史订单 */
function mkOrder(o: { cTime: string; state?: string }): Order {
  return { cTime: o.cTime, state: o.state ?? "filled" } as unknown as Order;
}

const stats = (
  hist: HistoryPosition[] = [],
  hOrders: Order[] = [],
  curOrders: Order[] = [],
  curPos: Position[] = [],
) => computeTodayStats(hist, hOrders, curOrders, curPos);

describe("今日开仓统计口径（2026-09-12 回归）", () => {
  test("部分平仓后剩余仍持仓 → 当前持仓与历史同时存在，只计 1 次（不重复）", () => {
    // 实测场景：STRK-USDT-SWAP —— 同一 posId + cTime 同时出现在两个数据源
    const posId = "3897197792704876550";
    const cTime = todayAt(10);
    const r = stats(
      [mkHist({ posId, instId: "STRK-USDT-SWAP", cTime, type: "1" })], // 历史：部分平仓
      [],
      [],
      [mkPos({ posId, instId: "STRK-USDT-SWAP", cTime })],             // 当前：剩余 148 仍持仓
    );
    assert.equal(r.todayOpened, 1, "同一仓位生命周期跨两个数据源必须去重，不能计 2");
  });

  test("今日开仓但被强平(type=3) → 计入（旧实现漏计）", () => {
    const r = stats([mkHist({ posId: "p-lq", cTime: todayAt(9), type: "3" })]);
    assert.equal(r.todayOpened, 1, "强平仓位的开仓时间在今日，应计入今日开仓");
  });

  test("今日开仓且完全平仓(type=2) → 计入", () => {
    const r = stats([mkHist({ posId: "p-full", cTime: todayAt(9), type: "2" })]);
    assert.equal(r.todayOpened, 1);
  });

  test("今日开仓仍持仓（无历史记录）→ 计入", () => {
    const r = stats([], [], [], [mkPos({ posId: "p-open", cTime: todayAt(9) })]);
    assert.equal(r.todayOpened, 1);
  });

  test("昨日开仓今日平仓 → 不计入今日开仓（cTime 口径，非 uTime）", () => {
    const r = stats([
      mkHist({ posId: "p-old", cTime: yesterdayAt(20), uTime: todayAt(8), type: "2" }),
    ]);
    assert.equal(r.todayOpened, 0, "开仓时间在昨日，即便今日才平仓也不算今日开仓");
  });

  test("同一 posId 今日两次独立开仓（cTime 不同）→ 计 2（posId 会被复用）", () => {
    const posId = "3608630547269312512";
    const r = stats([
      mkHist({ posId, cTime: todayAt(9) }),
      mkHist({ posId, cTime: todayAt(14) }),
    ]);
    assert.equal(r.todayOpened, 2, "(posId,cTime) 才是身份键，posId 复用不应被合并");
  });

  test("不同账户同名 posId → 分别计数（键含账户）", () => {
    const r = stats([
      mkHist({ posId: "same", cTime: todayAt(9), accountId: "acc-A" }),
      mkHist({ posId: "same", cTime: todayAt(9), accountId: "acc-B" }),
    ]);
    assert.equal(r.todayOpened, 2, "跨账户不应互相去重");
  });

  test("综合场景：当前持仓 1 + 历史今日 4 条（含 1 条与当前持仓重叠）→ 4", () => {
    const overlapPosId = "p-overlap";
    const overlapCTime = todayAt(10);
    const r = stats(
      [
        mkHist({ posId: overlapPosId, cTime: overlapCTime, type: "1" }), // 与当前持仓重叠
        mkHist({ posId: "h-1", cTime: todayAt(9), type: "2" }),
        mkHist({ posId: "h-2", cTime: todayAt(11), type: "3" }),
        mkHist({ posId: "h-3", cTime: yesterdayAt(23) }),                // 昨日 → 不计
      ],
      [],
      [],
      [mkPos({ posId: overlapPosId, cTime: overlapCTime })],
    );
    // 去重后生命周期：overlap, h-1, h-2 = 3；h-3 在昨日不计
    assert.equal(r.todayOpened, 3);
  });

  test("今日收益/今日平仓口径未被改动：仍只统计 type=2 且 uTime 为今日", () => {
    const r = stats([
      mkHist({ posId: "a", cTime: todayAt(1), uTime: todayAt(2), type: "2", realizedPnl: "5" }),
      mkHist({ posId: "b", cTime: todayAt(3), uTime: todayAt(4), type: "3", realizedPnl: "99" }), // 强平不计收益
      mkHist({ posId: "c", cTime: yesterdayAt(1), uTime: yesterdayAt(2), type: "2", realizedPnl: "7" }),
    ]);
    assert.equal(r.todayClosed, 1, "今日平仓仍只算完全平仓");
    assert.equal(r.todayProfit, 5, "今日收益仍只算完全平仓的实现收益");
    assert.equal(r.todayAvgProfit, 5);
    assert.equal(r.todayOpened, 2, "今日开仓按 cTime 计：a/b 今日开仓，c 昨日开仓");
  });

  test("订单类统计不受影响：今日下单 = 当前挂单 + 历史今日单；今日成交仅 filled", () => {
    const r = stats(
      [],
      [mkOrder({ cTime: todayAt(9), state: "filled" }), mkOrder({ cTime: todayAt(10), state: "live" })],
      [mkOrder({ cTime: todayAt(11) })],
      [],
    );
    assert.equal(r.todayOrders, 3, "当前挂单 1 + 历史今日 2");
    assert.equal(r.todayFilled, 1, "仅历史中 filled 计入");
  });
});

describe("positionLifecycleKey 键构造", () => {
  test("包含账户 + posId + cTime", () => {
    assert.equal(
      positionLifecycleKey({ posId: "p", cTime: "123", instId: "X", _accountId: "a" }),
      "a|p|123",
    );
  });

  test("posId 缺失时用 instId 兜底（不退化成单一键）", () => {
    const k1 = positionLifecycleKey({ cTime: "123", instId: "BTC-USDT-SWAP", _accountId: "a" });
    const k2 = positionLifecycleKey({ cTime: "123", instId: "ETH-USDT-SWAP", _accountId: "a" });
    assert.notEqual(k1, k2, "不同 instId 不应算出同一个键");
    assert.ok(k1.includes("BTC-USDT-SWAP"));
  });
});
