import type { Application } from 'express';
import { AccountMonitor } from '../../services/AccountMonitor.ts';
import { LogService } from '../../services/logService.ts';
import { clearMemoryMasterKey, getEffectiveMasterKey, loadSavedConfig, saveConfigToFile, setMemoryMasterKey } from '../../services/configService.ts';
import { DiyEngine } from '../../engine/diy/DiyEngine.ts';
import { validateMasterKeyMiddleware } from '../../middleware/inputValidation.ts';
import { redactSensitive, getConfigArray, sendError, toError } from './shared.ts';
import { getTabShortcuts, TAB_IDS } from '../../lib/tabShortcuts.ts';
import type { ApiRoutesConfig } from './types.ts';

const CONFIG_ARRAY_KEYS = ['place_configs', 'amend_configs', 'cancel_configs', 'close_configs', 'margin_configs', 'diy_strategies'] as const;

const TAB_LABELS: Record<string, string> = {
  market: 'nav.market',
  positions: 'nav.positions',
  place: 'nav.place',
  amend: 'nav.amend',
  cancel: 'nav.cancel',
  close: 'nav.close',
  margin: 'nav.margin',
  diy: 'nav.diy',
  apikeys: 'nav.apikeys',
  settings: 'nav.settings',
  contact: 'nav.contact',
};

const MODULE_LABELS: Record<string, string> = {
  place_configs: 'nav.place',
  amend_configs: 'nav.amend',
  cancel_configs: 'nav.cancel',
  close_configs: 'nav.close',
  margin_configs: 'nav.margin',
  diy_strategies: 'nav.diy',
};

export function registerConfigRoutes(app: Application, config: ApiRoutesConfig): void {
  app.get("/api/env-status", (_req, res) => {
    const configData = loadSavedConfig();
    const accounts = configData.accounts || [];

    res.json({
      ok: true,
      accounts: accounts.map((acc, idx) => ({
        index: idx,
        name: acc.name,
        exchange: acc.exchange,
        hasCredentials: !!(acc.apiKey && acc.secretKey && acc.passphrase) && !(acc as any)._decryptionFailed,
        isEncrypted: acc.isEncrypted,
        decryptionFailed: !!(acc as any)._decryptionFailed
      })),
      masterKeySet: !!getEffectiveMasterKey()
    });
  });

  app.get("/api/master-key/status", (_req, res) => {
    const configData = loadSavedConfig();
    const isSet = !!configData.masterKey || !!getEffectiveMasterKey();
    const hasAccounts = configData.accounts && configData.accounts.length > 0;
    const allEncrypted = hasAccounts && configData.accounts.every(acc => acc.isEncrypted);

    res.json({
      ok: true,
      isSet,
      hasAccounts,
      allEncrypted,
      isMemory: !!getEffectiveMasterKey() && !configData.masterKey,
      isPersistent: !!configData.masterKey
    });
  });

  app.post("/api/master-key", validateMasterKeyMiddleware, (req, res) => {
    const { key } = req.body;

    if (saveConfigToFile({ masterKey: key })) {
      setMemoryMasterKey(key);
      config.startAccountMonitoring();
      res.json({ ok: true });
    } else {
      res.status(500).json({ ok: false, error: "Failed to save Master Key" });
    }
  });

  app.post("/api/master-key/lock", (_req, res) => {
    clearMemoryMasterKey();
    saveConfigToFile({ masterKey: "" });
    AccountMonitor.stopAll();
    res.json({ ok: true });
  });

  app.get("/api/config", (_req, res) => {
    try {
      const cfg = loadSavedConfig();
      if (cfg.accounts) {
        const maskedAccounts = cfg.accounts.map(acc => ({
          ...acc,
          apiKey: "************",
          secretKey: "************",
          passphrase: acc.passphrase ? "************" : undefined
        }));
        res.json({ ...cfg, accounts: maskedAccounts });
      } else {
        res.json(cfg);
      }
    } catch (e: unknown) {
      const error = toError(e);
      LogService.systemError('SERVER', `加载配置失败: ${error.message}`);
      sendError(res, e);
    }
  });

  app.post("/api/config", (req, res) => {
    const redactedBody = redactSensitive(req.body);
    LogService.logKey('SERVER', 'server.config.received', { body: JSON.stringify(redactedBody).substring(0, 500) }, 'info');
    try {
      const dataToSave = { ...req.body };
      if (dataToSave.accounts) delete dataToSave.accounts;
      if (dataToSave.masterKey === '************') delete dataToSave.masterKey;

      if (saveConfigToFile(dataToSave)) {
        const currentConfig = loadSavedConfig();
        LogService.logKey('SERVER', 'server.config.saved', { cfg: JSON.stringify(currentConfig).substring(0, 100) }, 'info');
        
        if (dataToSave.timezone !== undefined) {
          const newTz = dataToSave.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
          config.wsManager.broadcast({ type: 'system_info', timezone: newTz });
          LogService.setTimezone(newTz);
          DiyEngine.getInstance().reloadStrategies();
        }
        
        res.json({ ok: true });
      } else {
        LogService.systemError('SERVER', '保存配置失败');
        res.status(500).json({ ok: false, error: "保存配置失败" });
      }
    } catch (e: unknown) {
      const error = toError(e);
      LogService.systemError('SERVER', `保存配置时出错: ${error.message}`);
      sendError(res, e);
    }
  });

  app.get("/api/config/shortcut-conflicts", (req, res) => {
    try {
      const shortcutKey = String(req.query.shortcut_key || '').trim().toLowerCase();
      const excludeConfigId = req.query.exclude_config_id ? String(req.query.exclude_config_id) : undefined;
      const excludeTabId = req.query.exclude_tab_id ? String(req.query.exclude_tab_id) : undefined;

      if (!shortcutKey) {
        return res.status(400).json({ ok: false, error: '[USER] shortcut_key 参数不能为空' });
      }

      const configData = loadSavedConfig();
      const conflicts: Array<{ type: 'tab'; label: string } | { type: 'config'; module: string; configName: string }> = [];

      const tabShortcuts = getTabShortcuts(configData);
      for (const tabId of TAB_IDS) {
        if (excludeTabId && tabId === excludeTabId) continue;
        const tabKey = tabShortcuts[tabId];
        if (tabKey && tabKey.toLowerCase() === shortcutKey) {
          conflicts.push({ type: 'tab', label: TAB_LABELS[tabId] || tabId });
        }
      }

      for (const arrayKey of CONFIG_ARRAY_KEYS) {
        const configs = getConfigArray<Record<string, unknown>>(configData[arrayKey]);
        for (const cfg of configs) {
          if (excludeConfigId && cfg.id === excludeConfigId) continue;

          const cfgKey = cfg.shortcut_key;
          if (typeof cfgKey === 'string' && cfgKey.trim().toLowerCase() === shortcutKey) {
            conflicts.push({
              type: 'config',
              module: MODULE_LABELS[arrayKey] || arrayKey,
              configName: String(cfg.name || cfg.id || '未命名'),
            });
          }
        }
      }

      res.json({ ok: true, conflicts });
    } catch (e: unknown) {
      const err = toError(e);
      LogService.systemError('SERVER', `快捷键冲突检测失败: ${err.message}`);
      sendError(res, e);
    }
  });

  app.get("/api/logs", (_req, res) => res.json(LogService.getHistory()));

  app.get("/api/server-logs", (_req, res) => {
    try {
      res.json({ logs: LogService.getHistory() });
    } catch (e: unknown) {
      sendError(res, e);
    }
  });
}
