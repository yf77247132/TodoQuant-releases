
import crypto from 'crypto';
import { execSync } from 'child_process';
import { LogService } from '../services/logService.ts';
import fs from 'fs';
import path from 'path';
import os from 'os';

const isWindows = process.platform === 'win32';

function isValidBase64(str: string): boolean {
  return /^[A-Za-z0-9+/]*={0,2}$/.test(str);
}

function runPowerShell(psScript: string): string {
  const tmpFile = path.join(os.tmpdir(), `tq-dpapi-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
  try {
    fs.writeFileSync(tmpFile, psScript, 'utf8');
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, {
      encoding: 'utf8',
      timeout: 10000
    }).trim();
    if (!result) {
      throw new Error('PowerShell 执行返回空输出');
    }
    return result;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {  }
  }
}

export function dpapiEncrypt(plainText: string): string {
  if (!isWindows) {
    LogService.logKey('CONFIG', 'config.dpapi.fallback', {}, 'warn');
    return aesFallbackEncrypt(plainText);
  }

  try {
    const b64 = Buffer.from(plainText, 'utf8').toString('base64');
    if (!isValidBase64(b64)) {
      throw new Error('Base64 编码结果包含非法字符');
    }
    const psScript = `[Reflection.Assembly]::LoadWithPartialName('System.Security') | Out-Null
$bytes = [Convert]::FromBase64String('${b64}')
$encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($encrypted)`;
    const result = runPowerShell(psScript);
    return `dpapi:${result}`;
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    LogService.systemError('CONFIG', `DPAPI 加密失败，降级为 AES: ${errMsg}`);
    return aesFallbackEncrypt(plainText);
  }
}

export function dpapiDecrypt(encrypted: string): string {
  if (!encrypted.startsWith('dpapi:')) {
    return aesFallbackDecrypt(encrypted);
  }

  if (!isWindows) {
    LogService.warn('CONFIG', '非 Windows 系统，无法解密 DPAPI 数据');
    throw new Error('DPAPI 仅支持 Windows 系统');
  }

  const cipherB64 = encrypted.slice(6);
  if (!cipherB64) {
    throw new Error('DPAPI 密文为空');
  }
  
  if (!isValidBase64(cipherB64)) {
    throw new Error('DPAPI 密文包含非法字符');
  }

  try {
    const psScript = `[Reflection.Assembly]::LoadWithPartialName('System.Security') | Out-Null
$bytes = [Convert]::FromBase64String('${cipherB64}')
$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($decrypted)`;
    const result = runPowerShell(psScript);
    return Buffer.from(result, 'base64').toString('utf8');
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    LogService.systemError('CONFIG', `DPAPI 解密失败: ${errMsg}`);
    throw e;
  }
}

const AES_IV_LENGTH = 12;

function aesFallbackEncrypt(plainText: string): string {
  const userKey = getUserSpecificKey();
  const iv = crypto.randomBytes(AES_IV_LENGTH);
  const key = crypto.createHash('sha256').update(userKey).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `aes:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function aesFallbackDecrypt(encrypted: string): string {
  if (!encrypted.startsWith('aes:')) {
    throw new Error('无效的降级加密格式');
  }
  const parts = encrypted.slice(4).split(':');
  if (parts.length !== 3) {
    throw new Error('无效的降级加密数据格式');
  }
  const [ivHex, authTagHex, cipherText] = parts;
  const userKey = getUserSpecificKey();
  const key = crypto.createHash('sha256').update(userKey).digest();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(cipherText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function getUserSpecificKey(): string {
  const unique = process.env.USERNAME || process.env.USER || process.env.HOME || 'default';
  return `todoquant-aes-fallback-${unique}`;
}
