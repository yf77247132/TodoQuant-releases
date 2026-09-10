import type { Application, Request, Response } from 'express';
import { LogService } from '../../services/logService.ts';
import { DiyEngine } from '../../engine/diy/DiyEngine.ts';
import { saveConfigToFile } from '../../services/configService.ts';
import { dbService } from '../../services/dbService.ts';
import { safeJsonParse } from '../../lib/safeJsonParse.ts';
import { registerDuplicateRoute, sendError, toError } from './shared.ts';

function withDiyConfigs(
  configKey: string,
  fn: (req: Request, res: Response, configs: any[], save: (failMsg: string, list?: any[]) => boolean) => unknown,
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response) => {
    try {
      const configs = safeJsonParse<any[]>(dbService.getConfig(configKey), []);
      await fn(req, res, configs, (failMsg: string, list?: any[]) => {
        if (saveConfigToFile({ [configKey]: list ?? configs })) return true;
        res.status(500).json({ ok: false, error: failMsg });
        return false;
      });
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  };
}

export function registerDiyRoutes(app: Application): void {
  app.get('/api/diy/conditions/configs', withDiyConfigs('diy_conditions', (_req, res, configs) => {
    res.json({ ok: true, data: configs });
  }));

  app.post('/api/diy/conditions/configs', withDiyConfigs('diy_conditions', (req, res, configs, save) => {
    const newConfig = { ...req.body, id: Date.now().toString(), createdAt: Date.now(), name: req.body.name || `#${Date.now().toString(16).slice(-4).toUpperCase()}` };
    configs.push(newConfig);
    if (save("保存配置失败")) {
      res.json({ ok: true, data: newConfig });
    }
  }));

  app.put('/api/diy/conditions/configs/:id', withDiyConfigs('diy_conditions', (req, res, configs, save) => {
    const index = configs.findIndex((c: any) => c.id === req.params.id);
    if (index === -1) return res.status(404).json({ ok: false, error: '未找到配置' });
    const { id: _ignored, ...rest } = req.body;
    configs[index] = { ...configs[index], ...rest, updatedAt: Date.now() };
    if (save("保存配置失败")) {
      DiyEngine.getInstance().reloadStrategies();
      res.json({ ok: true, data: configs[index] });
    }
  }));

  app.delete('/api/diy/conditions/configs/:id', withDiyConfigs('diy_conditions', (req, res, configs, save) => {
    const filtered = configs.filter((c: any) => c.id !== req.params.id);
    if (save("删除配置失败", filtered)) {
      DiyEngine.getInstance().reloadStrategies();
      res.json({ ok: true });
    }
  }));

  app.post('/api/diy/conditions/configs/:id/pin', withDiyConfigs('diy_conditions', (req, res, configs, save) => {
    const idx = configs.findIndex((c: any) => c.id === req.params.id);

    if (idx === -1) {
      return res.status(404).json({ ok: false, error: '未找到条件模板' });
    }

    const [config] = configs.splice(idx, 1);
    configs.unshift(config);

    if (save('置顶失败')) {
      res.json({ ok: true });
    }
  }));

  app.get('/api/diy/strategies/configs', withDiyConfigs('diy_strategies', (_req, res, configs) => {
    const diyEngine = DiyEngine.getInstance();
    const runningIds = diyEngine.getRunningStrategyIds();
    for (const c of configs) {
      c.running = runningIds.has(c.id);
      c.liveStates = diyEngine.getLiveStates(c.id);
    }
    res.json({ ok: true, data: configs });
  }));

  app.post('/api/diy/strategies/configs', withDiyConfigs('diy_strategies', async (req, res, configs, save) => {
    const newConfig = { ...req.body, id: Date.now().toString(), createdAt: Date.now(), running: false, name: req.body.name || `#${Date.now().toString(16).slice(-4).toUpperCase()}` };
    configs.push(newConfig);
    if (save("保存策略失败")) {
      await DiyEngine.getInstance().reloadStrategies();
      res.json({ ok: true, data: newConfig });
    }
  }));

  app.put('/api/diy/strategies/configs/:id', withDiyConfigs('diy_strategies', (req, res, configs, save) => {
    const index = configs.findIndex((c: any) => c.id === req.params.id);
    if (index === -1) return res.status(404).json({ ok: false, error: '未找到策略' });
    const { id: _ignored, ...rest } = req.body;
    configs[index] = { ...configs[index], ...rest, updatedAt: Date.now() };
    if (save("保存策略失败")) {
      DiyEngine.getInstance().reloadStrategies();
      res.json({ ok: true, data: configs[index] });
    }
  }));

  app.delete('/api/diy/strategies/configs/:id', withDiyConfigs('diy_strategies', (req, res, configs, save) => {
    const filtered = configs.filter((c: any) => c.id !== req.params.id);
    if (save("删除策略失败", filtered)) {
      DiyEngine.getInstance().reloadStrategies();
      res.json({ ok: true });
    }
  }));

  app.post('/api/diy/strategies/start/:id', withDiyConfigs('diy_strategies', (req, res, configs) => {
    if (!configs.some((c: any) => c.id === req.params.id)) return res.status(404).json({ ok: false, error: '未找到策略' });

    DiyEngine.getInstance().startStrategy(req.params.id);
    res.json({ ok: true });
  }));

  app.post('/api/diy/strategies/stop/:id', withDiyConfigs('diy_strategies', (req, res, configs) => {
    if (!configs.some((c: any) => c.id === req.params.id)) return res.status(404).json({ ok: false, error: '未找到策略' });

    DiyEngine.getInstance().stopStrategy(req.params.id);
    res.json({ ok: true });
  }));

  app.post('/api/diy/strategies/configs/:id/pin', withDiyConfigs('diy_strategies', (req, res, configs, save) => {
    const idx = configs.findIndex((c: any) => c.id === req.params.id);

    if (idx === -1) {
      return res.status(404).json({ ok: false, error: '未找到策略' });
    }

    const [config] = configs.splice(idx, 1);
    configs.unshift(config);

    if (save('置顶失败')) {
      res.json({ ok: true });
    }
  }));

  registerDuplicateRoute(app, "/api/diy/conditions/configs/:id/duplicate", "diy_conditions",
    () => safeJsonParse(dbService.getConfig('diy_conditions'), []));

  registerDuplicateRoute(app, "/api/diy/strategies/configs/:id/duplicate", "diy_strategies",
    () => safeJsonParse(dbService.getConfig('diy_strategies'), []));
}
