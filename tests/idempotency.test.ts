import assert from "node:assert/strict";
import test from "node:test";

import {
  createBatchSignature,
  createChildIdempotencyKey,
  createRequestIdempotencyKey,
} from "../src/lib/idempotency.ts";

test("createRequestIdempotencyKey returns bounded key", () => {
  const key = createRequestIdempotencyKey("place", "cfg_demo_1");
  assert.ok(key.length > 0);
  assert.ok(key.length <= 32);
});

test("createChildIdempotencyKey keeps length bound and uniqueness by index", () => {
  const base = createRequestIdempotencyKey("amend", "cfg_demo_2");
  const k1 = createChildIdempotencyKey(base, 1);
  const k2 = createChildIdempotencyKey(base, 2);
  assert.ok(k1.length <= 32);
  assert.ok(k2.length <= 32);
  assert.notEqual(k1, k2);
});

test("createBatchSignature is stable for same ids regardless order", () => {
  const s1 = createBatchSignature(0, false, ["3", "1", "2"]);
  const s2 = createBatchSignature(0, false, ["2", "3", "1"]);
  assert.equal(s1, s2);
});
