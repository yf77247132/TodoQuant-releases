import assert from "node:assert/strict";
import test from "node:test";

import {
  ValidationError,
  validateAccountIndex,
  validateMasterKey,
  validateNumberRange,
  validateOrderCancelPayload,
  validatePositionClosePayload,
  validateModuleConfig,
} from "../src/middleware/inputValidation.ts";

test("validateAccountIndex accepts non-negative integer string", () => {
  const idx = validateAccountIndex("12", "accountIdx");
  assert.equal(idx, 12);
});

test("validateAccountIndex rejects invalid numeric format", () => {
  assert.throws(
    () => validateAccountIndex("12abc", "accountIdx"),
    (err: unknown) => err instanceof ValidationError && err.field === "accountIdx",
  );
});

test("validateModuleConfig accepts valid account_id (UUID)", () => {
  assert.doesNotThrow(() => validateModuleConfig({ account_id: "550e8400-e29b-41d4-a716-446655440000" }));
});

test("validateModuleConfig rejects empty account_id", () => {
  assert.throws(
    () => validateModuleConfig({ account_id: "" }),
    (err: unknown) => err instanceof ValidationError && err.field === "account_id"
  );
});

test("validateNumberRange keeps global -1 sentinel as pass-through", () => {
  assert.doesNotThrow(() => validateNumberRange("-1", "take_profit_margin", 0, 1000, false));
});

test("validateMasterKey rejects whitespace", () => {
  assert.throws(
    () => validateMasterKey("abcd efghijklmnop"),
    (err: unknown) => err instanceof ValidationError && err.field === "key",
  );
});

test("validateOrderCancelPayload requires ordId or algoId", () => {
  assert.throws(
    () => validateOrderCancelPayload({ accountIdx: "0", instId: "BTC-USDT-SWAP" }),
    (err: unknown) => err instanceof ValidationError && err.field === "ordId/algoId",
  );
});

test("validatePositionClosePayload accepts valid close payload", () => {
  assert.doesNotThrow(() =>
    validatePositionClosePayload({
      accountIdx: "0",
      instId: "BTC-USDT-SWAP",
      mgnMode: "cross",
      posSide: "long",
      ccy: "USDT",
    }),
  );
});
