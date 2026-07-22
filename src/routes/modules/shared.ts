import type { Request, Response } from 'express';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from '../../services/errorMonitor.ts';
import { loadSavedConfig, saveConfigToFile, getEffectiveMasterKey } from '../../services/configService.ts';
import type { ExchangeAccount } from '../../types/index.ts';

const SENSITIVE_FIELDS = new Set(['masterKey', 'apiKey', 'secretKey', 'passphrase', 'key']);

export function getConfigArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return [];
}

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
      out[k] = SENSITIVE_FIELDS.has(k) ? '[REDACTED]' : redactSensitive(v);
    });
    return out;
  }
  return value;
}

interface RequireMasterKeyOptions {
  allowUnlockedSession?: boolean;
}

export function requireMasterKeyMatch(req: Request, res: Response, options?: RequireMasterKeyOptions): boolean {
  const effectiveMasterKey = getEffectiveMasterKey();
  if (!effectiveMasterKey) {
    res.status(401).json({ ok: false, error: 'Master key not unlocked' });
    return false;
  }

  const headerKey = req.header('x-master-key');
  const bodyKey = typeof req.body?.key === 'string' ? req.body.key : null;
  const providedKey = headerKey || bodyKey;
  if (!providedKey && options?.allowUnlockedSession) {
    return true;
  }
  if (!providedKey || providedKey !== effectiveMasterKey) {
    res.status(403).json({ ok: false, error: 'Master key validation failed' });
    return false;
  }
  return true;
}

export function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

export function sendError(res: Response, e: unknown, status = 500): void {
  const error = toError(e);
  ErrorMonitor.captureError(error, ErrorLevel.MEDIUM, ErrorCategory.SYSTEM);
  res.status(status).json({ ok: false, error: error.message });
}

export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e: unknown) {
      sendError(res, e);
    }
  };
}

export interface AccountLookupResult {
  configData: ReturnType<typeof loadSavedConfig>;
  accountIdx: number;
  account: ExchangeAccount;
}

export function findAccountById(accountId: string): AccountLookupResult | null {
  const configData = loadSavedConfig();
  const accounts = configData.accounts || [];
  const accountIdx = accounts.findIndex(acc => acc.id === accountId);
  if (accountIdx === -1) return null;
  return { configData, accountIdx, account: accounts[accountIdx] as ExchangeAccount };
}

export function resolveAccountFromRequest(req: Request, res: Response): AccountLookupResult | null {
  const accountId = req.body?.accountId || req.params?.accountId;
  if (!accountId) {
    res.status(400).json({ ok: false, error: '缺少 accountId' });
    return null;
  }
  const result = findAccountById(accountId);
  if (!result) {
    res.status(404).json({ ok: false, error: '账户不存在' });
    return null;
  }
  return result;
}

export function registerDuplicateRoute(
  app: any,
  path: string,
  configKey: string,
  loadConfigs?: () => any[],
) {
  app.post(path, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const configs = loadConfigs
        ? [...loadConfigs()]
        : getConfigArray<Record<string, any>>(loadSavedConfig()[configKey]);
      const idx = configs.findIndex((c) => c.id === id);

      if (idx === -1) {
        return res.status(404).json({ ok: false, error: "配置不存在" });
      }

      const source = configs[idx];
      const newId = `cfg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const duplicated = {
        ...source,
        id: newId,
        name: `${source.name || ''} copy`,
        running: false,
      };

      configs.splice(idx + 1, 0, duplicated);

      if (saveConfigToFile({ [configKey]: configs })) {
        res.json({ ok: true, data: duplicated });
      } else {
        res.status(500).json({ ok: false, error: "保存配置失败" });
      }
    } catch (e: unknown) {
      sendError(res, e);
    }
  });
}
