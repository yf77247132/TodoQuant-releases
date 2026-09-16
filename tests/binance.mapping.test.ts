import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { BinanceSdkTradeService } from "../src/services/binanceSdkTradeService.ts";
import { CancelOrderAction } from "../src/blocks/actions/CancelOrderAction.ts";

/**
 * 币安服务映射验证测试
 * 重点验证：符号转换、订单类型适配等纯逻辑部分
 */

test("Binance symbol conversion (Spot)", () => {
  const service = new BinanceSdkTradeService({
    apiKey: "dummy",
    secretKey: "dummy",
    accountIdx: 0
  });

  // 访问私有方法进行单元测试（使用 any 绕过 TS 检查）
  const serviceAny = service as any;

  // instId -> symbol
  assert.strictEqual(serviceAny.toBinanceSymbol("BTC-USDT"), "BTCUSDT");
  assert.strictEqual(serviceAny.toBinanceSymbol("eth-usdt"), "ETHUSDT");
  
  // symbol -> instId
  assert.strictEqual(serviceAny.fromBinanceSymbol("BTCUSDT"), "BTC-USDT");
  assert.strictEqual(serviceAny.fromBinanceSymbol("WIFUSDT"), "WIF-USDT");
});

test("Binance symbol conversion (Futures)", () => {
  const service = new BinanceSdkTradeService({
    apiKey: "dummy",
    secretKey: "dummy",
    accountIdx: 0
  });
  const serviceAny = service as any;

  // instId -> symbol
  assert.strictEqual(serviceAny.toBinanceSymbol("BTC-USDT-SWAP"), "BTCUSDT");
  assert.strictEqual(serviceAny.toBinanceSymbol("ETH-USDT-FUTURES"), "ETHUSDT");
  
  // isFutures check
  assert.strictEqual(serviceAny.isFutures("BTC-USDT-SWAP"), true);
  assert.strictEqual(serviceAny.isFutures("BTC-USDT"), false);
});

test("Binance futures order type normalization", () => {
  const service = new BinanceSdkTradeService({
    apiKey: "dummy",
    secretKey: "dummy",
    accountIdx: 0
  });
  const serviceAny = service as any;

  // LIMIT + GTC -> limit
  assert.strictEqual(serviceAny.normalizeBinanceFuturesOrdType("LIMIT", "GTC"), "limit");
  // LIMIT + GTX -> post_only
  assert.strictEqual(serviceAny.normalizeBinanceFuturesOrdType("LIMIT", "GTX"), "post_only");
  // LIMIT + FOK -> fok
  assert.strictEqual(serviceAny.normalizeBinanceFuturesOrdType("LIMIT", "FOK"), "fok");
});

test("Binance getAccountBalance mapping logic", async () => {
  const service = new BinanceSdkTradeService({
    apiKey: "dummy",
    secretKey: "dummy",
    accountIdx: 0
  });

  const serviceAny = service as any;

  // Mock internal data
  const mockFuturesAccount = {
    assets: [
      {
        asset: "USDT",
        availableBalance: "100.5",
        walletBalance: "120.0",
        positionInitialMargin: "10.0"
      }
    ]
  };

  // Override fetch method to return mock
  serviceAny.fetchFuturesAccountCached = async () => mockFuturesAccount;

  const result = await serviceAny.getAccountBalance("USDT");
  assert.strictEqual(result.totalEq, "120"); // walletBalance
  assert.strictEqual(result.details[0].availBal, "100.5");
  assert.strictEqual(result.details[0].frozenBal, "10");
});

test("Binance cancel log keeps LIMIT orders distinct from trailing stop", () => {
  const order = {
    exchange: "BINANCE",
    ordId: "1032977221",
    instId: "ACT-USDT",
    ordType: "limit",
    type: "LIMIT",
    px: "0.008",
    price: "0.008",
    triggerPx: "0",
    activationPrice: "0",
    trailingDelta: 0,
    tdMode: "cross",
  };
  const actionAny = CancelOrderAction as any;

  assert.notStrictEqual(actionAny.getOrderTypeLabel(order), "移动止盈止损");
  assert.strictEqual(actionAny.getOrderTypeLabel(order), "限价委托");
  assert.match(actionAny.formatOrderDetails(order.ordId, order), /类型: 限价委托/);
});

test("Binance cancel log identifies real trailing stop by trailingDelta", () => {
  const order = {
    exchange: "BINANCE",
    ordId: "1032977222",
    instId: "ACT-USDT",
    ordType: "take_profit",
    type: "TAKE_PROFIT",
    px: "0",
    price: "0",
    triggerPx: "0",
    activationPrice: "0.008",
    trailingDelta: 100,
    tdMode: "cross",
  };
  const actionAny = CancelOrderAction as any;

  assert.strictEqual(actionAny.getOrderTypeLabel(order), "移动止盈止损");
  assert.match(actionAny.formatOrderDetails(order.ordId, order), /类型: 移动止盈止损/);
});

describe('extractTriggerPx — 触发价提取', () => {
  // 通过 as any 访问私有静态方法（与上方 getOrderTypeLabel 测试同模式）
  const extractTriggerPx = (CancelOrderAction as any).extractTriggerPx;

  it('OKX 普通触发订单取 triggerPx', () => {
    const result = extractTriggerPx({ ordType: 'trigger', triggerPx: '1800', instId: 'BTC-USDT-SWAP' });
    assert.equal(result, '1800');
  });

  it('OKX 移动止盈止损取 activePx', () => {
    // trailingDelta 或 callbackRate 存在则判定为移动止盈止损
    const result = extractTriggerPx({ ordType: 'move_order_stop', activePx: '2000', trailingDelta: '1', instId: 'BTC-USDT-SWAP' });
    assert.equal(result, '2000');
  });

  it('币安合约 trailing stop 取 activationPrice', () => {
    const result = extractTriggerPx({ 
      origExecType: 'TRAILING_STOP_MARKET', 
      activationPrice: '35000',
      instId: 'BTCUSDT'
    });
    assert.equal(result, '35000');
  });

  it('无触发价字段返回 undefined', () => {
    const result = extractTriggerPx({ ordType: 'limit', instId: 'BTC-USDT-SWAP' });
    assert.equal(result, undefined);
  });
});
