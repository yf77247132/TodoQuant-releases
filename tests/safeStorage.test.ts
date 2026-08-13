import assert from "node:assert/strict";
import test from "node:test";

import {
  safeStorageGet,
  safeStorageSet,
  safeStorageRemove,
  safeStorageClear,
  storageAvailable,
} from "../src/lib/safeStorage.ts";

test("safeStorageGet: returns fallback when localStorage unavailable (Node env)", () => {
  assert.equal(storageAvailable, false);
  const result = safeStorageGet("test_key", { fallback: true });
  assert.deepEqual(result, { fallback: true });
});

test("safeStorageGet: returns fallback for null", () => {
  const result = safeStorageGet("nonexistent", "default");
  assert.equal(result, "default");
});

test("safeStorageSet: returns false when localStorage unavailable (Node env)", () => {
  const result = safeStorageSet("test_key", { data: "value" });
  assert.equal(result, false);
});

test("safeStorageSet: does not throw in Node env", () => {
  assert.doesNotThrow(() => safeStorageSet("any_key", "any_value"));
});

test("safeStorageRemove: returns false when storage unavailable", () => {
  assert.equal(safeStorageRemove("any_key"), false);
});

test("safeStorageClear: returns false when storage unavailable", () => {
  assert.equal(safeStorageClear(), false);
});

test("storageAvailable: is false in Node.js environment", () => {
  assert.equal(storageAvailable, false);
});