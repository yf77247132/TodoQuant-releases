import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { AccountMonitor } from "../src/services/AccountMonitor.ts";
import type { AccountOrder } from "../src/types/monitorTypes.ts";

// ============================================================
// transformOrder 测试
// ============================================================
describe("AccountMonitor.transformOrder", () => {
  // ----------------------------------------------------------
  // 基础映射测试
  // ----------------------------------------------------------
  describe("基础映射", () => {
    it("ordType='market' → orderTypeDisplay='市价委托'", () => {
      const result = AccountMonitor.transformOrder({ ordType: "market" });
      assert.strictEqual(result.orderTypeDisplay, "市价委托");
    });

    it("ordType='limit' → orderTypeDisplay='限价委托'", () => {
      const result = AccountMonitor.transformOrder({ ordType: "limit" });
      assert.strictEqual(result.orderTypeDisplay, "限价委托");
    });

    it("ordType='post_only' → orderTypeDisplay='限价-Post only'", () => {
      const result = AccountMonitor.transformOrder({ ordType: "post_only" });
      assert.strictEqual(result.orderTypeDisplay, "限价-Post only");
    });

    it("ordType='trigger' → orderTypeDisplay='计划委托'", () => {
      const result = AccountMonitor.transformOrder({ ordType: "trigger" });
      assert.strictEqual(result.orderTypeDisplay, "计划委托");
    });

    it("ordType='oco' → orderTypeDisplay='双向止盈止损'", () => {
      const result = AccountMonitor.transformOrder({ ordType: "oco", algoId: "1" });
      assert.strictEqual(result.orderTypeDisplay, "双向止盈止损");
    });

    it("ordType='move_order_stop' → orderTypeDisplay='移动止盈止损'", () => {
      const result = AccountMonitor.transformOrder({ ordType: "move_order_stop", algoId: "1" });
      assert.strictEqual(result.orderTypeDisplay, "移动止盈止损");
    });

    it("ordType='conditional' → orderTypeDisplay='单向止盈止损'", () => {
      const result = AccountMonitor.transformOrder({ ordType: "conditional" });
      assert.strictEqual(result.orderTypeDisplay, "单向止盈止损");
    });
  });

  // ----------------------------------------------------------
  // 币安特殊逻辑测试
  // ----------------------------------------------------------
  describe("币安特殊逻辑", () => {
    it("trailingDelta 存在时 → orderTypeDisplay='移动止盈止损'", () => {
      const result = AccountMonitor.transformOrder({
        ordType: "move_order_stop",
        trailingDelta: 100,
      });
      assert.strictEqual(result.orderTypeDisplay, "移动止盈止损");
    });

    it("exchange=BINANCE + _algoType=CONDITIONAL + _execType=STOP → orderTypeDisplay='单向止盈止损'（不是移动止盈止损）", () => {
      const result = AccountMonitor.transformOrder({
        exchange: "BINANCE",
        ordType: "move_order_stop",
        _algoType: "CONDITIONAL",
        _execType: "STOP",
        trailingDelta: 100,
      });
      assert.strictEqual(result.orderTypeDisplay, "单向止盈止损");
    });

    it("exchange=BINANCE + tdMode=cross + activationPrice存在 + px='0' → orderTypeDisplay='移动止盈止损'", () => {
      const result = AccountMonitor.transformOrder({
        exchange: "BINANCE",
        ordType: "move_order_stop",
        tdMode: "cross",
        activationPrice: "50000",
        px: "0",
      });
      assert.strictEqual(result.orderTypeDisplay, "移动止盈止损");
    });

    it("OCO订单 (orderListId存在 + contingencyType=OCO) → orderTypeDisplay='双向止盈止损'", () => {
      const result = AccountMonitor.transformOrder({
        ordType: "limit",
        orderListId: "100",
        contingencyType: "OCO",
      });
      assert.strictEqual(result.orderTypeDisplay, "双向止盈止损");
    });

    it("OTO订单 (orderListId存在 + contingencyType=OTO) + ordType=limit → orderTypeDisplay='限价委托'", () => {
      const result = AccountMonitor.transformOrder({
        ordType: "limit",
        orderListId: "200",
        contingencyType: "OTO",
      });
      assert.strictEqual(result.orderTypeDisplay, "限价委托");
    });

    it("OTO止损子单 (contingencyType=OTO + ordType=stop_loss_limit) → orderTypeDisplay='止损子单 (OTO)'", () => {
      const result = AccountMonitor.transformOrder({
        ordType: "stop_loss_limit",
        orderListId: "200",
        contingencyType: "OTO",
      });
      assert.strictEqual(result.orderTypeDisplay, "止损子单 (OTO)");
    });
  });

  // ----------------------------------------------------------
  // 价格映射测试
  // ----------------------------------------------------------
  describe("价格映射", () => {
    it("OCO订单: tpTriggerPx + slTriggerPx → triggerPrice 格式化为 'tp/sl'", () => {
      const result = AccountMonitor.transformOrder({
        ordType: "oco",
        algoId: "1",
        tpTriggerPx: "50000",
        slTriggerPx: "48000",
      });
      assert.strictEqual(result.triggerPrice, "50000/48000");
    });

    it("algo订单: triggerPx → triggerPrice", () => {
      const result = AccountMonitor.transformOrder({
        ordType: "trigger",
        algoId: "1",
        triggerPx: "50000",
      });
      assert.strictEqual(result.triggerPrice, "50000");
    });

    it("cTime → orderTime 映射", () => {
      const result = AccountMonitor.transformOrder({
        ordType: "limit",
        cTime: "1700000000000",
      });
      assert.strictEqual(result.orderTime, "1700000000000");
    });
  });
});

// ============================================================
// mergeBinanceOtoOrders 测试
// ============================================================
describe("AccountMonitor.mergeBinanceOtoOrders", () => {
  // ----------------------------------------------------------
  // 基础边界测试
  // ----------------------------------------------------------
  describe("基础边界", () => {
    it("空数组 → 返回空数组", () => {
      const result = AccountMonitor.mergeBinanceOtoOrders([]);
      assert.deepStrictEqual(result, []);
    });

    it("无BINANCE订单 → 原样返回", () => {
      const orders: AccountOrder[] = [
        { ordId: "1", instId: "BTC-USDT-SWAP", ordType: "limit", side: "buy", sz: "1" },
      ];
      const result = AccountMonitor.mergeBinanceOtoOrders(orders);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].ordId, "1");
    });

    it("单个订单 → 原样返回", () => {
      const orders: AccountOrder[] = [
        { exchange: "BINANCE", ordId: "1", instId: "BTC-USDT-SWAP", ordType: "limit", side: "buy", sz: "1" },
      ];
      const result = AccountMonitor.mergeBinanceOtoOrders(orders);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].ordId, "1");
    });
  });

  // ----------------------------------------------------------
  // orderListId 分组测试
  // ----------------------------------------------------------
  describe("orderListId 分组", () => {
    it("mainLeg(limit) + tpLeg(limit_maker) + slLeg(stop_loss_limit) → mainLeg 标记 OTOCO 类型，子单被过滤", () => {
      const mainLeg = {
        exchange: "BINANCE", ordId: "1", ordType: "limit", orderListId: "100", cTime: "1000", px: "100", instId: "BTC-USDT-SWAP", side: "buy", sz: "1", state: "live",
      };
      const tpLeg = {
        exchange: "BINANCE", ordId: "2", ordType: "limit_maker", orderListId: "100", cTime: "1000", px: "110", instId: "BTC-USDT-SWAP", side: "sell", sz: "1", state: "live",
      };
      const slLeg = {
        exchange: "BINANCE", ordId: "3", ordType: "stop_loss_limit", orderListId: "100", cTime: "1000", px: "90", instId: "BTC-USDT-SWAP", side: "sell", sz: "1", state: "live",
      };

      const orders = [mainLeg, tpLeg, slLeg] as AccountOrder[];
      const result = AccountMonitor.mergeBinanceOtoOrders(orders);

      // 只剩主单
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].ordId, "1");

      // 主单被标记为 OTOCO
      const mainResult = result[0] as Record<string, unknown>;
      assert.strictEqual(mainResult.otoGroupType, "OTOCO");
      assert.strictEqual(mainResult.otoTpPrice, "110");
      assert.strictEqual(mainResult.otoSlPrice, "90");
      assert.strictEqual(mainResult.orderTypeDisplay, "限价委托");
    });

    it("只有 mainLeg + tpLeg → 标记 OTO 类型", () => {
      const mainLeg = {
        exchange: "BINANCE", ordId: "1", ordType: "limit", orderListId: "200", cTime: "2000", px: "100", instId: "BTC-USDT-SWAP", side: "buy", sz: "1", state: "live",
      };
      const tpLeg = {
        exchange: "BINANCE", ordId: "2", ordType: "limit_maker", orderListId: "200", cTime: "2000", px: "120", instId: "BTC-USDT-SWAP", side: "sell", sz: "1", state: "live",
      };

      const orders = [mainLeg, tpLeg] as AccountOrder[];
      const result = AccountMonitor.mergeBinanceOtoOrders(orders);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].ordId, "1");

      const mainResult = result[0] as Record<string, unknown>;
      assert.strictEqual(mainResult.otoGroupType, "OTO");
      assert.strictEqual(mainResult.otoTpPrice, "120");
      assert.strictEqual(mainResult.otoSlPrice, null);
    });
  });

  // ----------------------------------------------------------
  // cTime 分组测试
  // ----------------------------------------------------------
  describe("cTime 分组", () => {
    it("相同cTime的订单合并逻辑", () => {
      const mainLeg = {
        exchange: "BINANCE", ordId: "10", ordType: "limit", cTime: "3000", px: "50", instId: "ETH-USDT-SWAP", side: "buy", sz: "2", state: "live",
      };
      const tpLeg = {
        exchange: "BINANCE", ordId: "11", ordType: "limit_maker", cTime: "3000", px: "55", instId: "ETH-USDT-SWAP", side: "sell", sz: "2", state: "live",
      };
      const slLeg = {
        exchange: "BINANCE", ordId: "12", ordType: "stop_loss_limit", cTime: "3000", px: "45", instId: "ETH-USDT-SWAP", side: "sell", sz: "2", state: "live",
      };

      // 不设 orderListId，仅靠 cTime 分组
      const orders = [mainLeg, tpLeg, slLeg] as AccountOrder[];
      const result = AccountMonitor.mergeBinanceOtoOrders(orders);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].ordId, "10");

      const mainResult = result[0] as Record<string, unknown>;
      assert.strictEqual(mainResult.otoGroupType, "OTOCO");
      assert.strictEqual(mainResult.otoTpPrice, "55");
      assert.strictEqual(mainResult.otoSlPrice, "45");
    });
  });

  // ----------------------------------------------------------
  // orderListId 优先于 cTime
  // ----------------------------------------------------------
  describe("orderListId 优先于 cTime", () => {
    it("orderListId 优先于 cTime（当两者都存在时）", () => {
      // 主单和止盈单有相同 orderListId，但 cTime 不同（改单后场景）
      const mainLeg = {
        exchange: "BINANCE", ordId: "1", ordType: "limit", orderListId: "400", cTime: "4001", px: "100", instId: "BTC-USDT-SWAP", side: "buy", sz: "1", state: "live",
      };
      const tpLeg = {
        exchange: "BINANCE", ordId: "2", ordType: "limit_maker", orderListId: "400", cTime: "4002", px: "110", instId: "BTC-USDT-SWAP", side: "sell", sz: "1", state: "live",
      };
      const slLeg = {
        exchange: "BINANCE", ordId: "3", ordType: "stop_loss_limit", orderListId: "400", cTime: "4003", px: "90", instId: "BTC-USDT-SWAP", side: "sell", sz: "1", state: "live",
      };

      const orders = [mainLeg, tpLeg, slLeg] as AccountOrder[];
      const result = AccountMonitor.mergeBinanceOtoOrders(orders);

      // orderListId 分组成功，cTime 不同不影响
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].ordId, "1");

      const mainResult = result[0] as Record<string, unknown>;
      assert.strictEqual(mainResult.otoGroupType, "OTOCO");
    });
  });
});
