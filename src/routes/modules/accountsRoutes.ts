import crypto from 'crypto';
import type { Application } from 'express';
import { AccountMonitor } from '../../services/AccountMonitor.ts';
import { loadSavedConfig, saveConfigToFile } from '../../services/configService.ts';
import { dbService } from '../../services/dbService.ts';
import { LogService } from '../../services/logService.ts';
import { ValidationError, validateAccountCreateMiddleware, validateColor, validateEnum, validateStringLength } from '../../middleware/inputValidation.ts';
import type { Exchange, ExchangeAccount } from '../../types/index.ts';
import { requireMasterKeyMatch, findAccountById, sendError, toError } from './shared.ts';
import type { ApiRoutesConfig } from './types.ts';
import { BINANCE_YELLOW } from '../../constants/colors.ts';

interface AccountWithDecryptionFlag extends ExchangeAccount {
  _decryptionFailed?: boolean;
}

interface WsManagerInternals {
  reconnectTimers?: Record<number, NodeJS.Timeout>;
  createOkxWs(apiKey: string, secretKey: string, passphrase: string, accountIdx: number): void;
}

export function registerAccountsRoutes(app: Application, config: ApiRoutesConfig): void {
  const maskKey = (key: string): string => {
    if (!key || key.length <= 8) return key;
    const len = key.length;
    const dots = '•'.repeat(len - 8);
    return key.substring(0, 4) + dots + key.substring(len - 4);
  };

  const restartAccountMonitoring = (opts: { syncTime?: boolean } = {}) => {
    if (opts.syncTime) {
      config.wsManager?.broadcast({ type: 'accounts_changed' });
    }
    config.wsManager?.stopAll();
    AccountMonitor.stopAll();
    config.ordersCache?.reset();
    config.savingsPoller?.reset();
    if (opts.syncTime) {
      void config.wsManager?.syncGlobalTime();
      void config.startAccountMonitoring().then(() => {
        config.wsManager?.broadcast({ type: 'accounts_changed' });
      }).catch((err: unknown) => {
        const e = err instanceof Error ? err : new Error(String(err));
        LogService.logKey('SYSTEM', 'pin.restartFailed', { msg: e.message }, 'error');
      });
    } else {
      config.startAccountMonitoring();
      config.wsManager?.broadcast({ type: 'accounts_changed' });
    }
  };

  app.get("/api/accounts", (_req, res) => {
    try {
      const configData = loadSavedConfig();
      const safeAccounts = (configData.accounts || []).map(acc => ({
        id: acc.id,
        name: acc.name,
        exchange: acc.exchange,
        color: acc.color,
        apiKey: (acc as AccountWithDecryptionFlag)._decryptionFailed ? '[解密失败]' : maskKey(acc.apiKey),
        secretKey: (acc as AccountWithDecryptionFlag)._decryptionFailed ? '[解密失败]' : maskKey(acc.secretKey),
        passphrase: (acc as AccountWithDecryptionFlag)._decryptionFailed ? '[解密失败]' : (acc.passphrase ? maskKey(acc.passphrase) : undefined),
        createdAt: acc.createdAt,
        updatedAt: acc.updatedAt
      }));
      res.json({ ok: true, data: safeAccounts });
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SERVER', 'route.account.loadFailed', { msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.post("/api/accounts", validateAccountCreateMiddleware, (req, res) => {
    try {
    const { name, exchange, apiKey, secretKey, passphrase, color } = req.body;

    const configData = loadSavedConfig();
    const newAccount: ExchangeAccount = {
      id: crypto.randomBytes(16).toString('hex'),
      name,
      exchange: exchange as Exchange,
      color: color || BINANCE_YELLOW,
      apiKey: apiKey.trim(),
      secretKey: secretKey.trim(),
      passphrase: passphrase ? passphrase.trim() : undefined,
      isEncrypted: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    configData.accounts.push(newAccount);

    const accountNames: Record<number, string> = { ...configData.accountNames };
    const accountColors: Record<number, string> = { ...configData.accountColors };
    const newIdx = configData.accounts.length - 1;
    accountNames[newIdx] = newAccount.name;
    accountColors[newIdx] = newAccount.color || BINANCE_YELLOW;

    const accountOrder = [...(configData.accountOrder || []), newAccount.id];

    if (saveConfigToFile({ accounts: configData.accounts, accountNames, accountColors, accountOrder })) {
      restartAccountMonitoring();

      res.json({ ok: true, data: { id: newAccount.id, name: newAccount.name } });
    } else {
      res.status(500).json({ ok: false, error: "Failed to save account" });
    }
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.delete("/api/accounts/:id", (req, res) => {
    try {
    const { id } = req.params;
    const configData = loadSavedConfig();

    const deletedIdx = configData.accounts.findIndex(acc => acc.id === id);
    if (deletedIdx === -1) {
      return res.status(404).json({ ok: false, error: "Account not found" });
    }

    dbService.deleteAccount(id);

    configData.accounts = configData.accounts.filter(acc => acc.id !== id);

    const accountNames: Record<number, string> = {};
    const accountColors: Record<number, string> = {};
    configData.accounts.forEach((acc, idx) => {
      accountNames[idx] = acc.name;
      accountColors[idx] = acc.color || BINANCE_YELLOW;
    });

    const accountOrder = (configData.accountOrder || []).filter(accId => accId !== id);

    if (saveConfigToFile({ accounts: configData.accounts, accountNames, accountColors, accountOrder })) {
      restartAccountMonitoring();

      res.json({ ok: true, deletedIndex: deletedIdx });
    } else {
      res.status(500).json({ ok: false, error: "Failed to delete account" });
    }
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.post("/api/ws/reconnect/:accountId", (req, res) => {
    try {
    const { accountId } = req.params;

    if (!accountId) {
      return res.status(400).json({ ok: false, error: "缺少 accountId" });
    }

    const found = findAccountById(accountId);
    if (!found) {
      return res.status(404).json({ ok: false, error: "账户不存在" });
    }

    const { accountIdx, account } = found;

    if ((account as AccountWithDecryptionFlag)._decryptionFailed) {
      return res.status(400).json({ ok: false, error: "凭证解密失败，请检查主密钥是否正确" });
    }

    if (!account.apiKey || !account.secretKey || !account.passphrase) {
      return res.status(400).json({ ok: false, error: "账户凭证不完整，请重新编辑账户" });
    }

    config.wsManager.resetPermanentlyStopped(accountIdx);

    const monitor = AccountMonitor.getInstance();
    void monitor.startMonitoring(accountIdx);

    const wsManagerInternals = config.wsManager as unknown as WsManagerInternals;
    if (wsManagerInternals.reconnectTimers?.[accountIdx]) {
      clearTimeout(wsManagerInternals.reconnectTimers[accountIdx]);
      delete wsManagerInternals.reconnectTimers[accountIdx];
    }

    LogService.logKey('SYSTEM', 'route.account.reconnecting', { name: account.name });

    wsManagerInternals.createOkxWs(account.apiKey, account.secretKey, account.passphrase, accountIdx);

    res.json({ ok: true, message: `账户 ${account.name} 重新连接中...` });
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.post("/api/accounts/:id/reveal", (req, res) => {
    try {
    if (!requireMasterKeyMatch(req, res, { allowUnlockedSession: true })) return;

    const { id } = req.params;
    const configData = loadSavedConfig();
    const account = configData.accounts.find(acc => acc.id === id);

    if (!account) {
      return res.status(404).json({ ok: false, error: "Account not found" });
    }

    if ((account as AccountWithDecryptionFlag)._decryptionFailed) {
      return res.status(400).json({ ok: false, error: "解密失败，请检查主密钥" });
    }

    res.json({
      ok: true,
      data: {
        apiKey: account.apiKey,
        secretKey: account.secretKey,
        passphrase: account.passphrase
      }
    });
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.put("/api/accounts/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { name, exchange, apiKey, secretKey, passphrase, color } = req.body;

      if (!/^[a-f0-9]{32}$/.test(id)) {
        return res.status(400).json({ ok: false, error: "Invalid account ID" });
      }

      const configData = loadSavedConfig();
      const idx = configData.accounts.findIndex(acc => acc.id === id);

      if (idx === -1) {
        return res.status(404).json({ ok: false, error: "Account not found" });
      }

      const current = configData.accounts[idx];
      const isDecryptionFailed = (current as AccountWithDecryptionFlag)._decryptionFailed;

      if (name !== undefined) {
        validateStringLength(name, 'name', 1, 50, true);
        current.name = name;
      }

      if (exchange !== undefined) {
        validateEnum(exchange, 'exchange', ['OKX', 'BINANCE'], true);
        current.exchange = exchange;
      }

      if (color !== undefined) {
        validateColor(color, 'color');
        current.color = color;
      }

      let keysUpdated = false;

      if (apiKey && !apiKey.includes('••')) {
        validateStringLength(apiKey, 'apiKey', 16, 64, true);
        current.apiKey = apiKey.replace(/[\u200B-\u200D\uFEFF\s]/g, '');
        keysUpdated = true;
      }
      if (secretKey && secretKey.trim() !== '' && !secretKey.includes('••')) {
        validateStringLength(secretKey, 'secretKey', 16, 64, true);
        current.secretKey = secretKey.replace(/[\u200B-\u200D\uFEFF\s]/g, '');
        keysUpdated = true;
      }
      if (passphrase && passphrase.trim() !== '' && !passphrase.includes('••')) {
        validateStringLength(passphrase, 'passphrase', 1, 64, false);
        current.passphrase = passphrase.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
        keysUpdated = true;
      }

      current.updatedAt = Date.now();

      if (!isDecryptionFailed || keysUpdated) {
        current.isEncrypted = false;
      }

      const accountNames: Record<number, string> = { ...configData.accountNames };
      const accountColors: Record<number, string> = { ...configData.accountColors };
      accountNames[idx] = current.name;
      accountColors[idx] = current.color || BINANCE_YELLOW;

      if (saveConfigToFile({ accounts: configData.accounts, accountNames, accountColors })) {
        restartAccountMonitoring();

        res.json({ ok: true, data: { id: current.id, name: current.name } });
      } else {
        res.status(500).json({ ok: false, error: "Failed to update account" });
      }
    } catch (e: unknown) {
      if (e instanceof ValidationError) {
        return res.status(400).json({
          ok: false,
          error: `[USER] ${e.message}`,
          category: 'USER',
          details: { field: e.field, message: e.message }
        });
      }

      sendError(res, e);
    }
  });

  app.post("/api/accounts/:id/pin", (req, res) => {
    try {
      const { id } = req.params;
      const configData = loadSavedConfig();

      if (!configData.accounts.some(acc => acc.id === id)) {
        return res.status(404).json({ ok: false, error: "Account not found" });
      }

      const accountOrder = [...(configData.accountOrder || configData.accounts.map(acc => acc.id))];
      const idx = accountOrder.findIndex(accId => accId === id);
      if (idx === -1) {
        return res.status(404).json({ ok: false, error: "Account not found" });
      }
      const [accountId] = accountOrder.splice(idx, 1);
      accountOrder.unshift(accountId);

      const accountNames: Record<number, string> = {};
      const accountColors: Record<number, string> = {};
      configData.accounts.forEach((acc) => {
        const newIdx = accountOrder.indexOf(acc.id);
        if (newIdx !== -1) {
          accountNames[newIdx] = acc.name;
          accountColors[newIdx] = acc.color || BINANCE_YELLOW;
        }
      });

      if (saveConfigToFile({ accountOrder, accountNames, accountColors })) {
        restartAccountMonitoring({ syncTime: true });

        res.json({ ok: true });
      } else {
        res.status(500).json({ ok: false, error: "Failed to pin account" });
      }
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });
}
