
import type { Application } from 'express';
import { StrategyEngine } from '../../engine/StrategyEngine.ts';
import { validateModuleConfig, validateModuleConfigMiddleware, ValidationError } from '../../middleware/inputValidation.ts';
import { loadSavedConfig, saveConfigToFile } from '../../services/configService.ts';
import { getConfigArray, registerDuplicateRoute, sendError } from './shared.ts';

export interface CrudConfigRecord {
  id: string;
  [key: string]: unknown;
}

export interface ModuleCrudOptions<T extends CrudConfigRecord> {
  module: string;
  basePath: string;
  configKey: string;
  createConfig: (body: any, id: string) => T;
  buildStartConfig: (cfg: T) => any;
  validatePut?: boolean;
}

export function registerCrudRoutes<T extends CrudConfigRecord>(
  app: Application,
  opts: ModuleCrudOptions<T>,
): void {
  const { module, basePath, configKey, createConfig, buildStartConfig, validatePut } = opts;
  const cfgPath = `/api/${basePath}/configs`;

  app.get(cfgPath, (_req, res) => {
    const configs = getConfigArray<T>((loadSavedConfig() as any)[configKey]).map((cfg) => ({
      ...cfg,
      running: StrategyEngine.getStatus(module, cfg.id)?.running || false,
    }));
    res.json({ ok: true, data: configs });
  });

  app.post(cfgPath, (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ ok: false, error: '请求体必须是配置对象' });
      }
      const { id: _clientIgnored, ...safeBody } = req.body;
      const id = `cfg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const newConfig = createConfig(safeBody, id);
      const configs = getConfigArray<T>((loadSavedConfig() as any)[configKey]);
      configs.push(newConfig);

      if (saveConfigToFile({ [configKey]: configs })) {
        res.json({ ok: true, data: newConfig });
      } else {
        res.status(500).json({ ok: false, error: "保存配置失败" });
      }
    } catch (e: unknown) {
      sendError(res, e);
    }
  });

  const updateHandler = (req: any, res: any) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        return res.status(400).json({ ok: false, error: '请求体必须是配置对象' });
      }
      const configs = getConfigArray<T>((loadSavedConfig() as any)[configKey]);
      const idx = configs.findIndex((c) => c.id === id);

      if (idx === -1) {
        return res.status(404).json({ ok: false, error: "配置不存在" });
      }

      const { id: _id, account_id, ...safeUpdates } = updates;
      if (account_id !== undefined) {
        safeUpdates.account_id = account_id;
      }
      configs[idx] = { ...configs[idx], ...safeUpdates };

      if (saveConfigToFile({ [configKey]: configs })) {
        res.json({ ok: true, data: configs[idx] });
      } else {
        res.status(500).json({ ok: false, error: "保存配置失败" });
      }
    } catch (e: unknown) {
      sendError(res, e);
    }
  };
  if (validatePut) {
    app.put(`${cfgPath}/:id`, validateModuleConfigMiddleware, updateHandler);
  } else {
    app.put(`${cfgPath}/:id`, updateHandler);
  }

  app.delete(`${cfgPath}/:id`, (req, res) => {
    try {
      const { id } = req.params;
      const configs = getConfigArray<T>((loadSavedConfig() as any)[configKey]);
      const idx = configs.findIndex((c) => c.id === id);

      if (idx === -1) {
        return res.status(404).json({ ok: false, error: "配置不存在" });
      }

      StrategyEngine.stop(module, undefined, id);

      configs.splice(idx, 1);

      if (saveConfigToFile({ [configKey]: configs })) {
        res.json({ ok: true });
      } else {
        res.status(500).json({ ok: false, error: "删除配置失败" });
      }
    } catch (e: unknown) {
      sendError(res, e);
    }
  });

  app.post(`/api/${basePath}/start/:configId`, (req, res) => {
    const { configId } = req.params;
    const configs = getConfigArray<T>((loadSavedConfig() as any)[configKey]);
    const cfg = configs.find((c) => c.id === configId);

    if (!cfg) {
      return res.status(404).json({ ok: false, error: "配置不存在" });
    }

    try {
      validateModuleConfig(cfg as unknown as Record<string, unknown>);
    } catch (e: unknown) {
      if (e instanceof ValidationError) {
        return res.status(400).json({
          ok: false,
          error: `[USER] ${e.message}`,
          category: 'USER',
          details: { field: e.field, message: e.message },
        });
      }
      return res.status(400).json({
        ok: false,
        error: '配置校验失败',
        details: e instanceof Error ? e.message : String(e),
      });
    }

    const moduleConfig = buildStartConfig(cfg);
    const ok = StrategyEngine.start(module, moduleConfig as any, configId);
    res.json({ ok, running: ok, ...StrategyEngine.getStatus(module, configId) });
  });

  app.post(`/api/${basePath}/stop/:configId`, (req, res) => {
    const { configId } = req.params;
    const ok = StrategyEngine.stop(module, undefined, configId);
    res.json({ ok: ok });
  });

  app.get(`/api/${basePath}/status`, (_req, res) => {
    res.json(StrategyEngine.getStatus(module));
  });

  app.post(`${cfgPath}/:id/pin`, (req, res) => {
    try {
      const { id } = req.params;
      const configs = getConfigArray<T>((loadSavedConfig() as any)[configKey]);
      const idx = configs.findIndex((c) => c.id === id);

      if (idx === -1) {
        return res.status(404).json({ ok: false, error: "配置不存在" });
      }

      const [config] = configs.splice(idx, 1);
      configs.unshift(config);

      if (saveConfigToFile({ [configKey]: configs })) {
        res.json({ ok: true });
      } else {
        res.status(500).json({ ok: false, error: "置顶失败" });
      }
    } catch (e: unknown) {
      sendError(res, e);
    }
  });

  registerDuplicateRoute(app, `${cfgPath}/:id/duplicate`, configKey);
}
