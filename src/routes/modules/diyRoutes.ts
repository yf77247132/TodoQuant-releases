import type { Application } from 'express';
import { LogService } from '../../services/logService.ts';
import { DiyEngine } from '../../engine/diy/DiyEngine.ts';
import { saveConfigToFile } from '../../services/configService.ts';
import { dbService } from '../../services/dbService.ts';
import { safeJsonParse } from '../../lib/safeJsonParse.ts';
import { registerDuplicateRoute, sendError, toError } from './shared.ts';

export function registerDiyRoutes(app: Application): void {
  app.get('/api/diy/conditions/configs', (req, res) => {
    try {
      const raw = dbService.getConfig('diy_conditions');
      const configs = safeJsonParse(raw, []);
      res.json({ ok: true, data: configs });
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.post('/api/diy/conditions/configs', (req, res) => {
    try {
      const configs = safeJsonParse(dbService.getConfig('diy_conditions'), []);
      const newConfig = { ...req.body, id: Date.now().toString(), createdAt: Date.now(), name: req.body.name || `#${Date.now().toString(16).slice(-4).toUpperCase()}` };
      configs.push(newConfig);
      if (saveConfigToFile({ diy_conditions: configs })) {
        res.json({ ok: true, data: newConfig });
      } else {
        res.status(500).json({ ok: false, error: "保存配置失败" });
      }
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.put('/api/diy/conditions/configs/:id', (req, res) => {
    try {
      const configs = safeJsonParse(dbService.getConfig('diy_conditions'), []);
      const index = configs.findIndex((c: any) => c.id === req.params.id);
      if (index === -1) return res.status(404).json({ ok: false, error: '未找到配置' });
      configs[index] = { ...configs[index], ...req.body, updatedAt: Date.now() };
      if (saveConfigToFile({ diy_conditions: configs })) {
        DiyEngine.getInstance().reloadStrategies();
        res.json({ ok: true, data: configs[index] });
      } else {
        res.status(500).json({ ok: false, error: "保存配置失败" });
      }
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.delete('/api/diy/conditions/configs/:id', (req, res) => {
    try {
      const configs = safeJsonParse(dbService.getConfig('diy_conditions'), []);
      const filtered = configs.filter((c: any) => c.id !== req.params.id);
      if (saveConfigToFile({ diy_conditions: filtered })) {
        DiyEngine.getInstance().reloadStrategies();
        res.json({ ok: true });
      } else {
        res.status(500).json({ ok: false, error: "删除配置失败" });
      }
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.post('/api/diy/conditions/configs/:id/pin', (req, res) => {
    try {
      const configs = safeJsonParse(dbService.getConfig('diy_conditions'), []);
      const idx = configs.findIndex((c: any) => c.id === req.params.id);

      if (idx === -1) {
        return res.status(404).json({ ok: false, error: '未找到条件模板' });
      }

      const [config] = configs.splice(idx, 1);
      configs.unshift(config);

      if (saveConfigToFile({ diy_conditions: configs })) {
        res.json({ ok: true });
      } else {
        res.status(500).json({ ok: false, error: '置顶失败' });
      }
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.get('/api/diy/strategies/configs', (req, res) => {
    try {
      const raw = dbService.getConfig('diy_strategies');
      const parsed = safeJsonParse<any[]>(raw, []);
      const diyEngine = DiyEngine.getInstance();
      const runningIds = diyEngine.getRunningStrategyIds();
      for (const c of parsed) {
        c.running = runningIds.has(c.id);
        c.liveStates = diyEngine.getLiveStates(c.id);
      }
      res.json({ ok: true, data: parsed });
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.post('/api/diy/strategies/configs', async (req, res) => {
    try {
      const configs = safeJsonParse(dbService.getConfig('diy_strategies'), []);
      const newConfig = { ...req.body, id: Date.now().toString(), createdAt: Date.now(), running: false, name: req.body.name || `#${Date.now().toString(16).slice(-4).toUpperCase()}` };
      configs.push(newConfig);
      if (saveConfigToFile({ diy_strategies: configs })) {
        await DiyEngine.getInstance().reloadStrategies();
        res.json({ ok: true, data: newConfig });
      } else {
        res.status(500).json({ ok: false, error: "保存策略失败" });
      }
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.put('/api/diy/strategies/configs/:id', (req, res) => {
    try {
      const configs = safeJsonParse(dbService.getConfig('diy_strategies'), []);
      const index = configs.findIndex((c: any) => c.id === req.params.id);
      if (index === -1) return res.status(404).json({ ok: false, error: '未找到策略' });
      configs[index] = { ...configs[index], ...req.body, updatedAt: Date.now() };
      if (saveConfigToFile({ diy_strategies: configs })) {
        DiyEngine.getInstance().reloadStrategies();
        res.json({ ok: true, data: configs[index] });
      } else {
        res.status(500).json({ ok: false, error: "保存策略失败" });
      }
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.delete('/api/diy/strategies/configs/:id', (req, res) => {
    try {
      const configs = safeJsonParse(dbService.getConfig('diy_strategies'), []);
      const filtered = configs.filter((c: any) => c.id !== req.params.id);
      if (saveConfigToFile({ diy_strategies: filtered })) {
        DiyEngine.getInstance().reloadStrategies();
        res.json({ ok: true });
      } else {
        res.status(500).json({ ok: false, error: "删除策略失败" });
      }
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.post('/api/diy/strategies/start/:id', (req, res) => {
    try {
      const configs = safeJsonParse(dbService.getConfig('diy_strategies'), []);
      const index = configs.findIndex((c: any) => c.id === req.params.id);
      if (index === -1) return res.status(404).json({ ok: false, error: '未找到策略' });
      
      DiyEngine.getInstance().startStrategy(req.params.id);
      res.json({ ok: true });
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.post('/api/diy/strategies/stop/:id', (req, res) => {
    try {
      const configs = safeJsonParse(dbService.getConfig('diy_strategies'), []);
      const index = configs.findIndex((c: any) => c.id === req.params.id);
      if (index === -1) return res.status(404).json({ ok: false, error: '未找到策略' });
      
      DiyEngine.getInstance().stopStrategy(req.params.id);
      res.json({ ok: true });
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.post('/api/diy/strategies/configs/:id/pin', (req, res) => {
    try {
      const configs = safeJsonParse(dbService.getConfig('diy_strategies'), []);
      const idx = configs.findIndex((c: any) => c.id === req.params.id);

      if (idx === -1) {
        return res.status(404).json({ ok: false, error: '未找到策略' });
      }

      const [config] = configs.splice(idx, 1);
      configs.unshift(config);

      if (saveConfigToFile({ diy_strategies: configs })) {
        res.json({ ok: true });
      } else {
        res.status(500).json({ ok: false, error: '置顶失败' });
      }
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  registerDuplicateRoute(app, "/api/diy/conditions/configs/:id/duplicate", "diy_conditions",
    () => safeJsonParse(dbService.getConfig('diy_conditions'), []));

  registerDuplicateRoute(app, "/api/diy/strategies/configs/:id/duplicate", "diy_strategies",
    () => safeJsonParse(dbService.getConfig('diy_strategies'), []));
}
