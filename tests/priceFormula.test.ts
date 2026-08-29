import assert from 'node:assert/strict';
import test from 'node:test';
import { isFormula, formulaNeedsVar, evaluateFormula, formatPreview } from '../src/lib/priceFormula.ts';

test('isFormula: =开头返回true', () => {
  assert.equal(isFormula('=1+1'), true);
  assert.equal(isFormula('=M*2'), true);
});

test('isFormula: 非=开头返回false', () => {
  assert.equal(isFormula('100'), false);
  assert.equal(isFormula(''), false);
  assert.equal(isFormula('CEILING(1,2)'), false);
});

test('isFormula: 单独=返回false', () => {
  assert.equal(isFormula('='), false);
});

test('isFormula: 非字符串返回false', () => {
  assert.equal(isFormula(123 as any), false);
});

test('formulaNeedsVar: 检测到变量返回true', () => {
  // 大小写不敏感
  assert.equal(formulaNeedsVar('=M*2', 'm'), true);
  assert.equal(formulaNeedsVar('=ROUND(M,-3)', 'M'), true);
});

test('formulaNeedsVar: 没有变量返回false', () => {
  assert.equal(formulaNeedsVar('=100+200', 'm'), false);
  assert.equal(formulaNeedsVar('', 'm'), false);
});

test('formulaNeedsVar: 不会被函数名中的字母误匹配', () => {
  // M 是变量但 SUM 中的 M 不应匹配
  assert.equal(formulaNeedsVar('=SUM(1,2)', 'm'), false);
});

test('evaluateFormula: 简单算术公式', () => {
  const r = evaluateFormula('=1+2*3', {});
  assert.equal(r.error, undefined);
  assert.equal(r.result, 7);
});

test('evaluateFormula: 带变量替换', () => {
  const r = evaluateFormula('=M*2', { m: 100 });
  assert.equal(r.error, undefined);
  assert.equal(r.result, 200);
});

test('evaluateFormula: 非法公式返回错误', () => {
  const r = evaluateFormula('=!!!', {});
  assert.ok(r.error !== undefined);
});

test('evaluateFormula: 非=开头原样返回', () => {
  const r = evaluateFormula('hello', {});
  assert.equal(r.error, undefined);
});

test('formatPreview: 成功求值显示结果', () => {
  const r = evaluateFormula('=1+2', {});
  const preview = formatPreview(r, {});
  assert.ok(preview.includes('3'));
});

test('formatPreview: 求值失败显示错误信息', () => {
  const r = evaluateFormula('=!!!', {});
  assert.ok(r.error !== undefined);
  // formatPreview 返回原始错误信息（由前端翻译前缀）
  const preview = formatPreview(r, {});
  assert.ok(preview.length > 0);
});
