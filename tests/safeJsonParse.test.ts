import assert from 'node:assert/strict';
import test from 'node:test';
import { safeJsonParse } from '../src/lib/safeJsonParse.ts';

test('safeJsonParse: 正常解析', () => {
  const result = safeJsonParse<{ a: number }>('{"a":1}', null);
  assert.deepEqual(result, { a: 1 });
});

test('safeJsonParse: 无效 JSON 返回 fallback', () => {
  const fallback = {};
  const result = safeJsonParse('not json', fallback);
  assert.equal(result, fallback);
});

test('safeJsonParse: null/undefined/空字符串返回 fallback', () => {
  const fallback = 'default';
  assert.equal(safeJsonParse(null, fallback), fallback);
  assert.equal(safeJsonParse(undefined, fallback), fallback);
  assert.equal(safeJsonParse('', fallback), fallback);
});

test('safeJsonParse: 自定义 reporter 触发', () => {
  let called = false;
  const reporter = (_err: Error) => { called = true; };
  safeJsonParse('invalid json', {}, { reporter });
  assert.equal(called, true);
});

test('safeJsonParse: context 透传', () => {
  let capturedContext = '';
  const reporter = (_err: Error, meta: { context: string }) => { capturedContext = meta.context; };
  safeJsonParse('bad', null, { context: 'my-test-context', reporter });
  assert.equal(capturedContext, 'my-test-context');
});

test('safeJsonParse: 超大输入截断', () => {
  let preview = '';
  const longStr = 'x'.repeat(500);
  const reporter = (_err: Error, meta: { rawPreview: string }) => { preview = meta.rawPreview; };
  safeJsonParse(longStr, null, { reporter });
  assert.equal(preview.length, 200);
  assert.equal(preview, 'x'.repeat(200));
});

test('safeJsonParse: 嵌套对象', () => {
  const result = safeJsonParse<{ a: { b: number[] } }>('{"a":{"b":[1,2,3]}}', null);
  assert.deepEqual(result, { a: { b: [1, 2, 3] } });
});

test('safeJsonParse: 数字/布尔值 JSON', () => {
  const numResult = safeJsonParse<number>('42', 0);
  assert.equal(numResult, 42);

  const boolResult = safeJsonParse<boolean>('true', false);
  assert.equal(boolResult, true);
});