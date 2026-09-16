import assert from 'node:assert/strict';
import test from 'node:test';
import { formatApiError } from '../src/lib/apiErrorFormatter.ts';

test('formatApiError: 返回"未知错误"当 result 为 null/undefined', () => {
  assert.equal(formatApiError(null), '未知错误');
  assert.equal(formatApiError(undefined), '未知错误');
});

test('formatApiError: 正确提取 code', () => {
  const result = formatApiError({ code: '51000' });
  assert.ok(result.includes('"code":"51000"'));
});

test('formatApiError: sCode 与 code 相同时不重复输出', () => {
  const result = formatApiError({ code: '51000', data: [{ sCode: '51000' }] });
  assert.ok(result.includes('"code":"51000"'));
  // sCode 相同，不应该出现两次
  const matches = (result.match(/51000/g) || []);
  assert.equal(matches.length, 1);
});

test('formatApiError: sCode 与 code 不同时都输出', () => {
  const result = formatApiError({ code: '1', data: [{ sCode: '51000' }] });
  assert.ok(result.includes('"sCode":"51000"'));
});

test('formatApiError: sMsg 与 msg 相同时不重复', () => {
  const result = formatApiError({ code: '1', msg: 'error', data: [{ sCode: '1', sMsg: 'error' }] });
  const matches = (result.match(/error/g) || []);
  assert.equal(matches.length, 1);
});

test('formatApiError: code 为 0 时不输出 code 字段', () => {
  const result = formatApiError({ code: '0', msg: 'TestError' });
  assert.ok(result.includes('"msg":"TestError"'));
  assert.ok(!result.includes('"code":"0"'));
});

test('formatApiError: 批量索引 dataIdx 正确读取不同子单错误', () => {
  const result = formatApiError({
    code: '2', msg: 'Partial',
    data: [
      { sCode: '0', sMsg: 'OK' },
      { sCode: '51000', sMsg: 'Parameter px error' }
    ]
  }, 1);
  assert.ok(result.includes('"sCode":"51000"'));
  assert.ok(result.includes('Parameter px error'));
});

test('formatApiError: sMsg 为 OK 时被过滤', () => {
  const result = formatApiError({ code: '0', data: [{ sCode: '0', sMsg: 'OK' }] });
  assert.ok(!result.includes('OK'));
});
