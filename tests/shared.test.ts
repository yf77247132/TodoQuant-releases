import assert from "node:assert/strict";
import test from "node:test";

import { getConfigArray, redactSensitive } from "../src/routes/modules/shared.ts";

test("getConfigArray: 传入合法数组 [1,2,3] 返回原数组", () => {
  const result = getConfigArray([1, 2, 3]);
  assert.deepEqual(result, [1, 2, 3]);
});

test("getConfigArray: 传入 null 返回空数组", () => {
  const result = getConfigArray(null);
  assert.deepEqual(result, []);
});

test("getConfigArray: 传入 undefined 返回空数组", () => {
  const result = getConfigArray(undefined);
  assert.deepEqual(result, []);
});

test("getConfigArray: 传入非数组对象返回空数组", () => {
  const result = getConfigArray({ a: 1 });
  assert.deepEqual(result, []);
});

test("getConfigArray: 传入空数组返回空数组", () => {
  const result = getConfigArray([]);
  assert.deepEqual(result, []);
});

test("getConfigArray: 传入对象数组可正确访问属性", () => {
  interface TestItem {
    id: string;
  }
  const input = [{ id: "a" }, { id: "b" }];
  const result = getConfigArray<TestItem>(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "a");
  assert.equal(result[1].id, "b");
});

test("redactSensitive: 普通对象保持不变", () => {
  const input = { a: 1, b: "hello" };
  const result = redactSensitive(input) as Record<string, unknown>;
  assert.equal(result.a, 1);
  assert.equal(result.b, "hello");
});

test("redactSensitive: apiKey 敏感字段被掩码", () => {
  const input = { apiKey: "secret123", name: "test" };
  const result = redactSensitive(input) as Record<string, unknown>;
  assert.equal(result.apiKey, "[REDACTED]");
  assert.equal(result.name, "test");
});

test("redactSensitive: 所有敏感字段列表均被掩码", () => {
  const input = {
    masterKey: "mk",
    apiKey: "ak",
    secretKey: "sk",
    passphrase: "pp",
    key: "k",
    normalField: "visible",
  };
  const result = redactSensitive(input) as Record<string, unknown>;
  assert.equal(result.masterKey, "[REDACTED]");
  assert.equal(result.apiKey, "[REDACTED]");
  assert.equal(result.secretKey, "[REDACTED]");
  assert.equal(result.passphrase, "[REDACTED]");
  assert.equal(result.key, "[REDACTED]");
  assert.equal(result.normalField, "visible");
});

test("redactSensitive: 嵌套对象递归掩码", () => {
  const input = { user: { apiKey: "nested_secret", name: "account1" } };
  const result = redactSensitive(input) as Record<string, unknown>;
  const user = result.user as Record<string, unknown>;
  assert.equal(user.apiKey, "[REDACTED]");
  assert.equal(user.name, "account1");
});

test("redactSensitive: 数组嵌套递归掩码", () => {
  const input = [
    { apiKey: "s1", name: "a" },
    { apiKey: "s2", name: "b" },
  ];
  const result = redactSensitive(input) as Array<Record<string, unknown>>;
  assert.equal(result[0].apiKey, "[REDACTED]");
  assert.equal(result[0].name, "a");
  assert.equal(result[1].apiKey, "[REDACTED]");
  assert.equal(result[1].name, "b");
});

test("redactSensitive: 非对象值原样返回", () => {
  assert.equal(redactSensitive(null), null);
  assert.equal(redactSensitive(42), 42);
  assert.equal(redactSensitive("str"), "str");
});