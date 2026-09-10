import assert from 'node:assert/strict';
import test from 'node:test';
import { encrypt, decrypt } from '../src/lib/encryption.ts';

test('encryption: 正常加解密往返', () => {
  const key = 'my-secret-key-16chars';
  const original = 'Hello, World! 你好，世界！';
  const encrypted = encrypt(original, key);
  const decrypted = decrypt(encrypted, key);
  assert.equal(decrypted, original);
});

test('encryption: 不同密钥不互通', () => {
  const keyA = 'aaaaaaaaaaaaaaaa';
  const keyB = 'bbbbbbbbbbbbbbbb';
  const original = 'secret data';
  const encrypted = encrypt(original, keyA);
  assert.throws(() => decrypt(encrypted, keyB), /Unsupported state or unable to authenticate data/i);
});

test('encryption: 空文本拒绝', () => {
  assert.throws(() => encrypt('', 'valid-key-16chars!'), /Text to encrypt cannot be empty/i);
});

test('encryption: 短密钥拒绝', () => {
  assert.throws(() => encrypt('hello', 'short'), /Master encryption key must be at least 16 characters long/i);
});

test('encryption: 空密文拒绝', () => {
  assert.throws(() => decrypt('', 'valid-key-16chars!'), /Data to decrypt cannot be empty/i);
});

test('encryption: 格式错误拒绝', () => {
  assert.throws(() => decrypt('bad:format:extra:part', 'valid-key-16chars!'), /Invalid encrypted data format/i);
});

test('encryption: 篡改检测', () => {
  const key = 'valid-key-16chars!';
  const original = 'tamper test data';
  const encrypted = encrypt(original, key);
  const parts = encrypted.split(':');
  // 修改密文字节中的最后一个字符
  const originalCipher = parts[2];
  const tamperedCipher = originalCipher.slice(0, -1) + (originalCipher.at(-1) === 'a' ? 'b' : 'a');
  const tampered = `${parts[0]}:${parts[1]}:${tamperedCipher}`;
  assert.throws(() => decrypt(tampered, key), /Unsupported state or unable to authenticate data/i);
});

test('encryption: IV 唯一性', () => {
  const key = 'valid-key-16chars!';
  const original = 'same text';
  const result1 = encrypt(original, key);
  const result2 = encrypt(original, key);
  assert.notEqual(result1, result2);
});

test('encryption: 大数据加解密', () => {
  const key = 'valid-key-16chars!';
  const largeText = 'A'.repeat(100 * 1024); // 100KB
  const encrypted = encrypt(largeText, key);
  const decrypted = decrypt(encrypted, key);
  assert.equal(decrypted, largeText);
});

test('encryption: 密钥边界', () => {
  // 正好 16 字符：合法
  const validKey = '1234567890123456';
  const result = encrypt('text', validKey);
  assert.equal(decrypt(result, validKey), 'text');

  // 15 字符：应抛异常
  assert.throws(() => encrypt('text', '123456789012345'), /Master encryption key must be at least 16 characters long/i);
});