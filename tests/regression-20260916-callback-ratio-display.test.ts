/**
 * 回归测试（2026-09-16）：订单结果日志「回调比例」精度丢失
 *
 * 现象（用户实盘日志）：配置 `callback_ratio_spread = "0.1%"`（PlaceOrderAction 解析为 0.001）时，
 *   日志打出「回调比例: 0%」——看着像没配 / 配错，实际发出去的是 0.1%。
 *
 * 根因：`renderOrderFields`（src/lib/logTemplates.ts）对回调比例做 `(numVal * 100).toFixed(0)`，
 *   任何 < 0.5% 的比例都被舍成 "0"。
 *
 * 修复：保留 2 位小数后去掉尾随 0 → 0.001 → "0.1%"、0.01 → "1%"、0.5 → "50%"；
 *   两位仍为 0 的极小值退到 4 位，避免又显示成 "0%"。
 *
 * 附：值为 0 / -1（未设置）时，`renderOrderFields` 的 filter 会**整条剔除**该字段，
 *   所以「能看到回调比例这行」本身就说明值非 0 —— 这条不变行为也一并锁住。
 *
 * ⚠️ 纯模块测试：不碰 trading.db、不依赖 Electron。
 *    node --import tsx --import ./tests/env.ts --import ./tests/setup.ts --test tests/regression-20260916-callback-ratio-display.test.ts
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { LOG_TEMPLATES } from "../src/lib/logTemplates.ts";

/** 下单成功模板（renderOrderFields 的两个消费方之一；另一个是 order.simulate） */
const placed = LOG_TEMPLATES["order.placed"];

/** 只带回调比例的入参：其余字段 undefined → 被 filter 剔除，断言聚焦单字段 */
const params = (callbackRatio: number | string) => ({ num: 1, callbackRatio });

describe("订单结果日志 · 回调比例显示精度（2026-09-16 回归）", () => {
  test("0.1%（值 0.001）不再被舍成 0%", () => {
    const zh = placed.zh(params(0.001));
    assert.ok(zh.includes("回调比例: 0.1%"), `期望「回调比例: 0.1%」，实际: ${zh}`);

    const en = placed.en(params(0.001));
    assert.ok(en.includes("Callback Ratio: 0.1%"), `期望「Callback Ratio: 0.1%」，实际: ${en}`);
  });

  test("整数百分比保持简洁：1% / 5% / 50% / 100%（不出现 1.00% 这类冗余尾零）", () => {
    const cases: [number, string][] = [[0.01, "1%"], [0.05, "5%"], [0.5, "50%"], [1, "100%"]];
    for (const [value, expected] of cases) {
      const zh = placed.zh(params(value));
      assert.ok(zh.includes(`回调比例: ${expected}`), `值 ${value} 期望「回调比例: ${expected}」，实际: ${zh}`);
    }
  });

  test("极小值（0.001% 级）仍不显示成 0%", () => {
    const zh = placed.zh(params(0.00001));
    assert.ok(zh.includes("回调比例: 0.001%"), `期望「回调比例: 0.001%」，实际: ${zh}`);
  });

  test("值为 0 / -1（未设置）→ 整条字段被剔除，绝不打印「0%」", () => {
    for (const value of [0, -1, "-1"]) {
      const zh = placed.zh(params(value));
      assert.ok(!zh.includes("回调比例"), `值 ${value} 不应打印回调比例字段，实际: ${zh}`);
    }
  });
});
