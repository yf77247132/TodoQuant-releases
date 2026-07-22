import assert from "node:assert/strict";
import test from "node:test";

import { configCache } from "../src/lib/configCache.ts";

test("configCache.get: 在 Node 环境（无 localStorage）返回 null", () => {
  const result = configCache.get();
  assert.strictEqual(result, null);
});

test("configCache.set: 在 Node 环境（无 localStorage）返回 false", () => {
  const result = configCache.set({ accounts: [] });
  assert.strictEqual(result, false);
});

test("configCache.set: 在无 localStorage 环境不抛异常", () => {
  assert.doesNotThrow(() => {
    configCache.set({ accounts: [] });
  });
});

test("configCache.get: 在无 localStorage 环境不抛异常", () => {
  assert.doesNotThrow(() => {
    configCache.get();
  });
});

test("configCache: 导出对象包含 get 和 set 两个方法", () => {
  assert.equal(typeof configCache.get, "function");
  assert.equal(typeof configCache.set, "function");
  assert.equal(Object.keys(configCache).length, 2);
});