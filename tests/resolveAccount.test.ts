import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAccountFromConfig, getAccountNameFromConfig } from "../src/lib/resolveAccount.ts";
import type { ExchangeAccount } from "../src/types/core.ts";

test("resolveAccountFromConfig - Success with valid UUID", () => {
  const accounts: Partial<ExchangeAccount>[] = [
    { id: "uuid-1", name: "Acc 1", apiKey: "key", secretKey: "sec" },
    { id: "uuid-2", name: "Acc 2", apiKey: "key2", secretKey: "sec2" }
  ];

  const result = resolveAccountFromConfig(
    { account_id: "uuid-2" },
    "place",
    accounts as ExchangeAccount[]
  );

  assert.ok(!("error" in result));
  assert.strictEqual(result.account.name, "Acc 2");
  assert.strictEqual(result.accountIdx, 1);
});

test("resolveAccountFromConfig - Error on missing account_id", () => {
  const result = resolveAccountFromConfig({}, "place", []);
  assert.ok("error" in result);
  assert.match(result.error, /缺少 account_id/);
});

test("resolveAccountFromConfig - Error on non-existent account", () => {
  const accounts: Partial<ExchangeAccount>[] = [
    { id: "uuid-1", name: "Acc 1" }
  ];
  const result = resolveAccountFromConfig(
    { account_id: "uuid-ghost" },
    "place",
    accounts as ExchangeAccount[]
  );
  assert.ok("error" in result);
  assert.match(result.error, /对应的账户不存在/);
});

test("getAccountNameFromConfig fallback logic", () => {
  const accounts = [
    { id: "uuid-1", name: "Modern Acc" }
  ];
  const accountNames = {
    0: "Old Acc"
  };

  // 1. UUID lookup
  assert.strictEqual(
    getAccountNameFromConfig({ account_id: "uuid-1" }, accountNames, accounts),
    "Modern Acc"
  );

  // 2. Index fallback
  assert.strictEqual(
    getAccountNameFromConfig({ account_id: "0" }, accountNames, accounts),
    "Old Acc"
  );

  // 3. Not found
  assert.strictEqual(
    getAccountNameFromConfig({ account_id: "uuid-ghost" }, accountNames, accounts),
    "账户(已删除)"
  );
});
