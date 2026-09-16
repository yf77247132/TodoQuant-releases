
import https from 'https';
import crypto from 'crypto';
import { dbService } from './dbService.ts';
import { dpapiDecrypt } from '../lib/dpapi.ts';
import { LogService } from './logService.ts';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from './errorMonitor.ts';

const BOT_TOKEN_KEY = 'telegram_bot_token';
const BOT_USERNAME_KEY = 'telegram_bot_username';
const CHAT_ID_KEY = 'telegram_chat_id';
const BOUND_KEY = 'telegram_bound';
const BINDING_CODE_KEY = 'telegram_binding_code';

const BINDING_TIMEOUT_MS = 5 * 60 * 1000;

interface TelegramApiResult {
  ok: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
}

interface TelegramMessage {
  message_id: number;
  from?: { id: number };
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

function callApi<T = unknown>(token: string, method: string, payload?: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : '';
    const urlObj = new URL(`https://api.telegram.org/bot${token}/${method}`);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data) as TelegramApiResult;
          if (json.ok) resolve(json.result as T);
          else reject(new Error(`Telegram API ${json.error_code}: ${json.description || '未知错误'}`));
        } catch (e) {
          reject(new Error(`Telegram 响应解析失败: ${(e as Error).message}`));
        }
      });
    });
    req.on('error', (e) => reject(e));
    if (body) req.write(body);
    req.end();
  });
}

function getBotToken(): string | null {
  const enc = dbService.getConfig(BOT_TOKEN_KEY);
  if (!enc) {
    return null;
  }
  try {
    return dpapiDecrypt(enc);
  } catch (e) {
    LogService.logKey('TELEGRAM', 'telegram.tokenDecryptFailed', { msg: (e as Error).message }, 'warn');
    return null;
  }
}

let pollTimer: NodeJS.Timeout | null = null;
let bindingDeadline = 0;
let expectedCode: string | null = null;
let lastUpdateId = 0;

function stopPolling(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  expectedCode = null;
}

function pollLoop(): void {
  if (!expectedCode) return;
  if (Date.now() > bindingDeadline) {
    LogService.logKey('TELEGRAM', 'telegram.pollTimeout', {}, 'info');
    stopPolling();
    return;
  }
  const token = getBotToken();
  if (!token) {
    LogService.logKey('TELEGRAM', 'telegram.pollNoToken', {}, 'warn');
    stopPolling();
    return;
  }
  const offset = lastUpdateId + 1;
  LogService.logKey('TELEGRAM', 'telegram.pollOffset', { offset }, 'info');
  const urlObj = new URL(`https://api.telegram.org/bot${token}/getUpdates?timeout=30&offset=${offset}`);
  const req = https.request({
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
  }, (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      try {
        const json = JSON.parse(data) as TelegramApiResult & { result?: TelegramUpdate[] };
        if (json.ok && Array.isArray(json.result)) {
          LogService.logKey('TELEGRAM', 'telegram.pollReceived', { count: json.result.length }, 'info');
          for (const u of json.result) {
            lastUpdateId = Math.max(lastUpdateId, u.update_id);
            const text = u.message?.text || '';
            LogService.logKey('TELEGRAM', 'telegram.pollMessage', { text, fromId: u.message?.from?.id ?? 0 }, 'info');
            const startMatch = text.match(/^\/start\s+(.+)$/);
            const codeMatch = expectedCode && text.includes(expectedCode);
            if ((startMatch && startMatch[1] === expectedCode) || (codeMatch && u.message?.from?.id)) {
              const chatId = String(u.message.from.id);
              dbService.setConfig(CHAT_ID_KEY, chatId);
              dbService.setConfig(BOUND_KEY, 'true');
              dbService.setConfig(BINDING_CODE_KEY, '');
              LogService.logKey('TELEGRAM', 'telegram.bound', { chatId }, 'info');
              stopPolling();
              return;
            }
          }
        } else if (!json.ok) {
          LogService.logKey('TELEGRAM', 'telegram.getUpdatesError', { detail: JSON.stringify(json) }, 'warn');
        }
      } catch (e) {
        LogService.logKey('TELEGRAM', 'telegram.getUpdatesParseFailed', { msg: (e as Error).message, data: (data || '').slice(0, 200) }, 'warn');
      }
      if (expectedCode) pollTimer = setTimeout(pollLoop, 1000);
    });
  });
  req.on('error', (e) => {
    LogService.logKey('TELEGRAM', 'telegram.getUpdatesNetworkError', { msg: e.message }, 'warn');
    if (expectedCode) pollTimer = setTimeout(pollLoop, 3000);
  });
  req.on('timeout', () => {
    LogService.logKey('TELEGRAM', 'telegram.getUpdatesTimeout', {}, 'warn');
    req.destroy();
    if (expectedCode) pollTimer = setTimeout(pollLoop, 3000);
  });
  req.end();
}

export function generateBindingCode(): string {
  return `TQ-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export const TelegramService = {

  isTokenConfigured(): boolean {
    return !!dbService.getConfig(BOT_TOKEN_KEY);
  },

  ensureDefaultToken(): boolean {
    return !!getBotToken();
  },

  getBotUsername(): string {
    return dbService.getConfig(BOT_USERNAME_KEY) || '';
  },

  isBound(): boolean {
    return dbService.getConfig(BOUND_KEY) === 'true';
  },

  getBoundChatId(): string | null {
    return dbService.getConfig(CHAT_ID_KEY) || null;
  },

  startBinding(): { ok: boolean; error?: string; code?: string; deepLink?: string; tgLink?: string } {
    if (!this.ensureDefaultToken()) return { ok: false, error: 'Bot Token 未配置' };
    const username = this.getBotUsername();
    if (!username) return { ok: false, error: '无法获取 Bot 用户名' };
    const code = generateBindingCode();
    stopPolling();
    expectedCode = code;
    dbService.setConfig(BINDING_CODE_KEY, code);
    bindingDeadline = Date.now() + BINDING_TIMEOUT_MS;
    lastUpdateId = 0;
    pollTimer = setTimeout(pollLoop, 500);
    const deepLink = `https://t.me/${username}?start=${code}`;
    const tgLink = `tg://resolve?domain=${username}&start=${code}`;
    LogService.logKey('TELEGRAM', 'telegram.bindStart', { code }, 'info');
    return { ok: true, code, deepLink, tgLink };
  },

  cancelBinding(): void {
    stopPolling();
  },

  unbind(): void {
    stopPolling();
    dbService.setConfig(CHAT_ID_KEY, '');
    dbService.setConfig(BOUND_KEY, 'false');
    dbService.setConfig(BINDING_CODE_KEY, '');
    LogService.logKey('TELEGRAM', 'telegram.unbound', {}, 'info');
  },

  async sendMessage(chatId: string, text: string): Promise<boolean> {
    const token = getBotToken();
    if (!token) {
      LogService.logKey('TELEGRAM', 'telegram.noTokenSend', {}, 'warn');
      return false;
    }
    try {
      await callApi(token, 'sendMessage', { chat_id: chatId, text: text.slice(0, 4000) });
      return true;
    } catch (e) {
      LogService.logKey('TELEGRAM', 'telegram.sendFailed', { msg: (e as Error).message }, 'error');
      ErrorMonitor.captureError(e as Error, ErrorLevel.MEDIUM, ErrorCategory.SYSTEM);
      return false;
    }
  },

  async sendTest(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isBound()) return { ok: false, error: '尚未绑定 Telegram' };
    const chatId = this.getBoundChatId();
    if (!chatId) return { ok: false, error: '未找到绑定的 chat_id' };
    const ok = await this.sendMessage(chatId, '✅ TodoQuant Telegram connected');
    return ok ? { ok: true } : { ok: false, error: '发送失败，请检查 Token 与网络' };
  },

  async notifyStrategy(content: string): Promise<boolean> {
    const chatId = this.getBoundChatId();
    if (!chatId) {
      LogService.logKey('TELEGRAM', 'telegram.notBound', {}, 'error');
      return false;
    }
    return this.sendMessage(chatId, content);
  },

  getStatus(): {
    configured: boolean;
    bound: boolean;
    username: string;
    chatId: string | null;
    binding: boolean;
  } {
    this.ensureDefaultToken();
    return {
      configured: this.isTokenConfigured(),
      bound: this.isBound(),
      username: this.getBotUsername(),
      chatId: this.getBoundChatId(),
      binding: !!expectedCode,
    };
  },
};
