import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { BinanceSdkTradeService } from "../src/services/binanceSdkTradeService.ts";

/**
 * BinanceSdkTradeService 纯逻辑方法测试
 * 通过 as any 访问私有方法（与 binance.mapping.test.ts 模式一致）
 * 不重复已有 binance.mapping.test.ts 的测试用例
 */

function createService() {
  return new BinanceSdkTradeService({
    apiKey: "dummy",
    secretKey: "dummy",
    accountIdx: 0,
  });
}

describe("parsePercentIncrement", () => {
  const s = createService();
  const svc = s as any;

  it('输入 "1%" → { value: 0.01, isPercent: true }', () => {
    const result = svc.parsePercentIncrement("1%");
    assert.strictEqual(result.value, 0.01);
    assert.strictEqual(result.isPercent, true);
  });

  it("输入 0.01 → { value: 0.01, isPercent: true }（数值<1判定为百分比）", () => {
    const result = svc.parsePercentIncrement(0.01);
    assert.strictEqual(result.value, 0.01);
    assert.strictEqual(result.isPercent, true);
  });

  it('输入 "5" → { value: 5, isPercent: false }', () => {
    const result = svc.parsePercentIncrement("5");
    assert.strictEqual(result.value, 5);
    assert.strictEqual(result.isPercent, false);
  });

  it("输入 undefined → { value: 0, isPercent: false }", () => {
    const result = svc.parsePercentIncrement(undefined);
    assert.strictEqual(result.value, 0);
    assert.strictEqual(result.isPercent, false);
  });

  it("输入 null → { value: 0, isPercent: false }", () => {
    const result = svc.parsePercentIncrement(null);
    assert.strictEqual(result.value, 0);
    assert.strictEqual(result.isPercent, false);
  });

  it('输入 "0.5%" → { value: 0.005, isPercent: true }', () => {
    const result = svc.parsePercentIncrement("0.5%");
    assert.strictEqual(result.value, 0.005);
    assert.strictEqual(result.isPercent, true);
  });
});

describe("calculateTpSlPrice", () => {
  const s = createService();
  const svc = s as any;

  it("买入止盈(百分比): workingPrice=100, incrementValue=0.01, isPercent=true, side=BUY, isTp=true → 101", () => {
    const result = svc.calculateTpSlPrice(100, 0.01, true, "BUY", true);
    assert.strictEqual(result, 101);
  });

  it("买入止损(百分比): workingPrice=100, incrementValue=0.01, isPercent=true, side=BUY, isTp=false → 99", () => {
    const result = svc.calculateTpSlPrice(100, 0.01, true, "BUY", false);
    assert.strictEqual(result, 99);
  });

  it("卖出止盈(百分比): workingPrice=100, incrementValue=0.01, isPercent=true, side=SELL, isTp=true → 99", () => {
    const result = svc.calculateTpSlPrice(100, 0.01, true, "SELL", true);
    assert.strictEqual(result, 99);
  });

  it("卖出止损(百分比): workingPrice=100, incrementValue=0.01, isPercent=true, side=SELL, isTp=false → 101", () => {
    const result = svc.calculateTpSlPrice(100, 0.01, true, "SELL", false);
    assert.strictEqual(result, 101);
  });

  it("绝对值模式(incrementValue=0): 返回 workingPrice 原值", () => {
    const result = svc.calculateTpSlPrice(100, 0, true, "BUY", true);
    assert.strictEqual(result, 100);
  });

  it("isPercent=false: 返回 workingPrice 原值", () => {
    const result = svc.calculateTpSlPrice(100, 0.01, false, "BUY", true);
    assert.strictEqual(result, 100);
  });
});

describe("inferConditionalExecutionType", () => {
  const s = createService();
  const svc = s as any;

  it("BUY + triggerPrice > marketPrice → STOP", () => {
    assert.strictEqual(svc.inferConditionalExecutionType("BUY", 110, 100), "STOP");
  });

  it("BUY + triggerPrice < marketPrice → TAKE_PROFIT", () => {
    assert.strictEqual(svc.inferConditionalExecutionType("BUY", 90, 100), "TAKE_PROFIT");
  });

  it("SELL + triggerPrice < marketPrice → STOP", () => {
    assert.strictEqual(svc.inferConditionalExecutionType("SELL", 90, 100), "STOP");
  });

  it("SELL + triggerPrice > marketPrice → TAKE_PROFIT", () => {
    assert.strictEqual(svc.inferConditionalExecutionType("SELL", 110, 100), "TAKE_PROFIT");
  });

  it("BUY + triggerPrice == marketPrice → TAKE_PROFIT（不大于则走TAKE_PROFIT分支）", () => {
    assert.strictEqual(svc.inferConditionalExecutionType("BUY", 100, 100), "TAKE_PROFIT");
  });
});

describe("roundStep", () => {
  const s = createService();
  const svc = s as any;

  it("roundStep(1.23456, 2) → 1.23", () => {
    assert.strictEqual(svc.roundStep(1.23456, 2), "1.23");
  });

  it("roundStep(1.235, 2) → 1.23（floor向下取整）", () => {
    assert.strictEqual(svc.roundStep(1.235, 2), "1.23");
  });

  it("roundStep(0.999, 3) → 0.999", () => {
    assert.strictEqual(svc.roundStep(0.999, 3), "0.999");
  });

  it("roundStep(1.0000001, 6) → 1.000000（+0.0000001容差补偿浮点误差）", () => {
    assert.strictEqual(svc.roundStep(1.0000001, 6), "1.000000");
  });
});

describe("fromBinanceSymbol（补充已有测试未覆盖的用例）", () => {
  const s = createService();
  const svc = s as any;

  it('"ETHBTC" → "ETH-BTC"', () => {
    assert.strictEqual(svc.fromBinanceSymbol("ETHBTC"), "ETH-BTC");
  });

  it('"XRPUSDC" → "XRP-USDC"', () => {
    assert.strictEqual(svc.fromBinanceSymbol("XRPUSDC"), "XRP-USDC");
  });

  it('"UNKNOWNPAIR" → "UNKNOWNPAIR"（无匹配quote）', () => {
    assert.strictEqual(svc.fromBinanceSymbol("UNKNOWNPAIR"), "UNKNOWNPAIR");
  });
});

describe("isFutures（补充已有测试未覆盖的用例）", () => {
  const s = createService();
  const svc = s as any;

  it('"ETH-USDT-FUTURES" → true', () => {
    assert.strictEqual(svc.isFutures("ETH-USDT-FUTURES"), true);
  });
});

describe("normalizeBinanceFuturesOrdType（补充IOC类型映射）", () => {
  const s = createService();
  const svc = s as any;

  it("LIMIT + IOC → ioc", () => {
    assert.strictEqual(svc.normalizeBinanceFuturesOrdType("LIMIT", "IOC"), "ioc");
  });
});

describe("applyTiming", () => {
  const s = createService();
  const svc = s as any;

  it("验证 payload 添加了 timestamp 和 recvWindow 字段", () => {
    const payload: Record<string, unknown> = {};
    svc.applyTiming(payload, false);
    assert.ok("timestamp" in payload, "payload 应包含 timestamp");
    assert.ok("recvWindow" in payload, "payload 应包含 recvWindow");
    assert.strictEqual(payload.recvWindow, 60000);
  });

  it("验证 timestamp = _dateNowPatched() + offset", () => {
    const payload: Record<string, unknown> = {};
    // 设置 spot 偏移量以便验证
    const spotOffset = svc._spotTimeOffsetMs;
    const realNow = BinanceSdkTradeService._dateNowPatched();
    svc.applyTiming(payload, false);
    assert.strictEqual(payload.timestamp, realNow + spotOffset);
  });

  it("futures 模式使用 _futuresTimeOffsetMs", () => {
    const payload: Record<string, unknown> = {};
    const futuresOffset = svc._futuresTimeOffsetMs;
    const realNow = BinanceSdkTradeService._dateNowPatched();
    svc.applyTiming(payload, true);
    assert.strictEqual(payload.timestamp, realNow + futuresOffset);
  });
});

describe("patchDateNowForSdk / restoreDateNow", () => {
  it("patchDateNowForSdk: 偏移量<=100时返回false不push", () => {
    const s = createService();
    const svc = s as any;
    // 默认偏移量为0
    assert.strictEqual(svc._spotTimeOffsetMs, 0);
    const result = svc.patchDateNowForSdk(false);
    assert.strictEqual(result, false);
  });

  it("patchDateNowForSdk: 偏移量>100时push并返回true", () => {
    const s = createService();
    const svc = s as any;
    // 手动设置偏移量>100
    svc._spotTimeOffsetMs = 500;
    const result = svc.patchDateNowForSdk(false);
    assert.strictEqual(result, true);
    // 清理：pop掉push的偏移量
    svc.restoreDateNow();
    svc._spotTimeOffsetMs = 0;
  });

  it("restoreDateNow: pop偏移量栈", () => {
    const s = createService();
    const svc = s as any;
    // 手动设置偏移量>100，触发push
    svc._futuresTimeOffsetMs = 200;
    const patched = svc.patchDateNowForSdk(true);
    assert.strictEqual(patched, true);
    // restore 应该 pop 掉刚 push 的偏移量
    svc.restoreDateNow();
    // 再次 patch 验证栈已恢复（只push一个，不会累积）
    const patched2 = svc.patchDateNowForSdk(true);
    assert.strictEqual(patched2, true);
    svc.restoreDateNow();
    svc._futuresTimeOffsetMs = 0;
  });
});
