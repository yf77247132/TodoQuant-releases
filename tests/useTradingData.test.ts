import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LogEntry, LogLevel } from "../src/types/logs.ts";

// ── 以下函数在 useTradingData.ts 中为模块级私有（未 export），
//    此处内联复制实现以便测试。若源码变更需同步更新。 ──

const shallowEqualRecord = <T extends string | number | boolean | null | undefined>(
  a: Record<string, T> | undefined,
  b: Record<string, T> | undefined
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
};

const LOG_WINDOW_SIZE = 300;

const isDuplicateLogEntry = (existing: LogEntry[], incoming: LogEntry): boolean => {
  if (incoming.id !== undefined && incoming.id !== null) {
    return existing.some((item) => {
      if (item.bootId && incoming.bootId && item.bootId !== incoming.bootId) {
        return false;
      }
      return item.id === incoming.id;
    });
  }
  return existing.some((item) =>
    item.timestamp === incoming.timestamp &&
    item.script === incoming.script &&
    item.configId === incoming.configId &&
    item.level === incoming.level &&
    item.message === incoming.message
  );
};

const mergeLogEntries = (existing: LogEntry[], incoming: LogEntry[]): LogEntry[] => {
  if (!incoming.length) return existing;
  const merged = [...existing];
  for (const item of incoming) {
    if (!isDuplicateLogEntry(merged, item)) {
      merged.push(item);
    }
  }
  merged.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    const aId = a.id ?? Number.MAX_SAFE_INTEGER;
    const bId = b.id ?? Number.MAX_SAFE_INTEGER;
    return aId - bId;
  });
  return merged.slice(-LOG_WINDOW_SIZE);
};

// ── 辅助：快速构造 LogEntry ──
function entry(overrides: Partial<LogEntry> & { timestamp: number }): LogEntry {
  return {
    level: LogLevel.INFO,
    message: "",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
//  shallowEqualRecord
// ═══════════════════════════════════════════════════════════════

describe("shallowEqualRecord", () => {
  it("同一引用 → true", () => {
    const obj: Record<string, string> = { a: "1" };
    assert.equal(shallowEqualRecord(obj, obj), true);
  });

  it("相同内容 → true", () => {
    const a: Record<string, string> = { a: "1", b: "2" };
    const b: Record<string, string> = { a: "1", b: "2" };
    assert.equal(shallowEqualRecord(a, b), true);
  });

  it("不同值 → false", () => {
    const a: Record<string, string> = { a: "1" };
    const b: Record<string, string> = { a: "2" };
    assert.equal(shallowEqualRecord(a, b), false);
  });

  it("不同 key → false", () => {
    const a: Record<string, string> = { a: "1" };
    const b: Record<string, string> = { b: "1" };
    assert.equal(shallowEqualRecord(a, b), false);
  });

  it("key 数量不同 → false", () => {
    const a: Record<string, string> = { a: "1" };
    const b: Record<string, string> = { a: "1", b: "2" };
    assert.equal(shallowEqualRecord(a, b), false);
  });

  it("一方 undefined → false", () => {
    const a: Record<string, string> = { a: "1" };
    assert.equal(shallowEqualRecord(a, undefined), false);
    assert.equal(shallowEqualRecord(undefined, a), false);
  });

  it("两方 undefined → true（a === b 都是 undefined）", () => {
    assert.equal(shallowEqualRecord(undefined, undefined), true);
  });

  it("空对象相等 → true", () => {
    assert.equal(shallowEqualRecord({}, {}), true);
  });

  it("值类型混合（number / boolean / null）正确比较", () => {
    const a: Record<string, string | number | boolean | null | undefined> = {
      x: 1,
      y: true,
      z: null,
    };
    const b: Record<string, string | number | boolean | null | undefined> = {
      x: 1,
      y: true,
      z: null,
    };
    assert.equal(shallowEqualRecord(a, b), true);
  });
});

// ═══════════════════════════════════════════════════════════════
//  mergeLogEntries
// ═══════════════════════════════════════════════════════════════

describe("mergeLogEntries", () => {
  it("空 existing + 非空 incoming → incoming", () => {
    const incoming = [entry({ id: 1, timestamp: 100 })];
    const result = mergeLogEntries([], incoming);
    assert.deepEqual(result, incoming);
  });

  it("非空 existing + 空 incoming → existing", () => {
    const existing = [entry({ id: 1, timestamp: 100 })];
    const result = mergeLogEntries(existing, []);
    assert.equal(result, existing); // 直接返回引用
  });

  it("去重：相同 id 的条目不重复添加", () => {
    const existing = [entry({ id: 1, timestamp: 100, message: "a" })];
    const incoming = [entry({ id: 1, timestamp: 100, message: "a" })];
    const result = mergeLogEntries(existing, incoming);
    assert.equal(result.length, 1);
  });

  it("去重：不同 bootId 的相同 id 不算重复", () => {
    const existing = [entry({ id: 1, timestamp: 100, bootId: "boot-1" })];
    const incoming = [entry({ id: 1, timestamp: 200, bootId: "boot-2" })];
    const result = mergeLogEntries(existing, incoming);
    assert.equal(result.length, 2);
  });

  it("去重：无 id 时按复合键去重", () => {
    const base = {
      level: LogLevel.WARN,
      script: "trader",
      configId: "cfg-1",
      message: "hello",
    };
    const existing = [entry({ timestamp: 100, ...base })];
    const incoming = [entry({ timestamp: 100, ...base })];
    const result = mergeLogEntries(existing, incoming);
    assert.equal(result.length, 1);
  });

  it("排序：按 timestamp 升序", () => {
    const existing = [entry({ id: 1, timestamp: 300 })];
    const incoming = [entry({ id: 2, timestamp: 100 }), entry({ id: 3, timestamp: 200 })];
    const result = mergeLogEntries(existing, incoming);
    assert.equal(result[0].id, 2);
    assert.equal(result[1].id, 3);
    assert.equal(result[2].id, 1);
  });

  it("排序：timestamp 相同按 id 升序", () => {
    const existing = [entry({ id: 3, timestamp: 100 })];
    const incoming = [entry({ id: 1, timestamp: 100 }), entry({ id: 2, timestamp: 100 })];
    const result = mergeLogEntries(existing, incoming);
    assert.equal(result[0].id, 1);
    assert.equal(result[1].id, 2);
    assert.equal(result[2].id, 3);
  });

  it("排序：无 id 条目排在有 id 条目之后（id 默认 MAX_SAFE_INTEGER）", () => {
    const existing = [entry({ timestamp: 100 })]; // 无 id
    const incoming = [entry({ id: 5, timestamp: 100 })];
    const result = mergeLogEntries(existing, incoming);
    assert.equal(result[0].id, 5);
    assert.equal(result[1].id, undefined);
  });

  it("截断：保留最后 LOG_WINDOW_SIZE 条", () => {
    const existing = Array.from({ length: 200 }, (_, i) =>
      entry({ id: i + 1, timestamp: i })
    );
    const incoming = Array.from({ length: 200 }, (_, i) =>
      entry({ id: i + 201, timestamp: i + 200 })
    );
    const result = mergeLogEntries(existing, incoming);
    assert.equal(result.length, LOG_WINDOW_SIZE);
    // 应保留的是 timestamp 最大的 300 条
    assert.equal(result[0].id, 101);
    assert.equal(result[result.length - 1].id, 400);
  });
});
