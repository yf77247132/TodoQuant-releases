import type { Application } from 'express';
import { ErrorCategory, ErrorLevel, ErrorMonitor } from '../../services/errorMonitor.ts';
import { LogService } from '../../services/logService.ts';
import { AccountMonitor } from '../../services/AccountMonitor.ts';
import type { ApiRoutesConfig } from './types.ts';

export function registerErrorRoutes(app: Application, config: ApiRoutesConfig): void {
  app.get("/api/debug/ws-data", (_req, res) => {
    res.json({ ok: true, data: config.wsManager.getLatestWsData() });
  });

  app.get("/api/debug/monitor-state", (_req, res) => {
    const monitor = AccountMonitor.getInstance();
    const accountsObj = (monitor as any).accounts || {};
    res.json({
      ok: true,
      accounts: accountsObj,
      accountsKeys: Object.keys(accountsObj),
      accountsIdx1Type: typeof accountsObj[1],
      accountsIdx1Value: accountsObj[1] === undefined ? 'undefined' : accountsObj[1],
      servicesKeys: Object.keys((monitor as any).services || {}),
      timersKeys: Object.keys((monitor as any).timers || {}),
      activeMonitors: Array.from((monitor as any).activeMonitors || []),
    });
  });

  app.get("/api/debug/logs", (_req, res) => {
    res.json({ ok: true, logs: LogService.getHistory() });
  });

  app.get("/api/errors", (_req, res) => {
    try {
      const errors = ErrorMonitor.getAllErrors();
      res.json({ ok: true, data: errors });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/errors/stats", (_req, res) => {
    try {
      const stats = ErrorMonitor.getStats();
      const trend = ErrorMonitor.getErrorTrend(24);
      const frequentErrors = ErrorMonitor.getFrequentErrors(10);
      const todayCount = ErrorMonitor.getTodayErrorCount();

      res.json({
        ok: true,
        data: {
          ...stats,
          trend,
          stats: frequentErrors,
          total: todayCount
        }
      });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/errors/recent", (req, res) => {
    try {
      const count = parseInt(req.query.count as string) || 50;
      const errors = ErrorMonitor.getRecentErrors(count);
      res.json({ ok: true, data: errors });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/errors/level/:level", (req, res) => {
    try {
      const { level } = req.params;
      if (!['critical', 'high', 'medium', 'low', 'info'].includes(level)) {
        return res.status(400).json({ ok: false, error: 'Invalid error level' });
      }
      const errors = ErrorMonitor.getErrorsByLevel(level as any);
      res.json({ ok: true, data: errors });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/errors/category/:category", (req, res) => {
    try {
      const { category } = req.params;
      const errors = ErrorMonitor.getErrorsByCategory(category as any);
      res.json({ ok: true, data: errors });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/errors/unresolved", (_req, res) => {
    try {
      const errors = ErrorMonitor.getUnresolvedErrors();
      res.json({ ok: true, data: errors });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put("/api/errors/:id/resolve", (req, res) => {
    try {
      const { id } = req.params;
      const success = ErrorMonitor.resolveError(id);
      if (success) {
        res.json({ ok: true });
      } else {
        res.status(404).json({ ok: false, error: 'Error not found' });
      }
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.delete("/api/errors", (_req, res) => {
    try {
      ErrorMonitor.clearErrors();
      res.json({ ok: true });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/errors/report", (req, res) => {
    try {
      const { errors } = req.body;

      const errorList = Array.isArray(errors) ? errors : [req.body];

      errorList.forEach((err: { type?: string; level?: string; message?: string; stack?: string; url?: string; userAgent?: string; details?: Record<string, unknown>; errorClass?: 'USER' | 'SYSTEM' | 'API' }) => {
        const { type, level, message, url, userAgent, details, errorClass } = err;
        const category = type === 'unhandled' ? ErrorCategory.SYSTEM :
          type === 'react' ? ErrorCategory.SYSTEM :
            type === 'resource' ? ErrorCategory.NETWORK :
              type === 'performance' ? ErrorCategory.SYSTEM : ErrorCategory.SYSTEM;

        const errorLevel = level === 'critical' ? ErrorLevel.CRITICAL :
          level === 'high' ? ErrorLevel.HIGH :
            level === 'medium' ? ErrorLevel.MEDIUM :
              level === 'low' ? ErrorLevel.LOW : ErrorLevel.INFO;

        const errorDetails = {
          ...details,
          errorClass,
          url,
          userAgent,
          source: 'frontend'
        };

        ErrorMonitor.captureError(
          new Error(message),
          errorLevel,
          category,
          errorDetails
        );
      });

      res.json({ ok: true });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  const performanceMetrics: {
    fps: number;
    memory: number;
    memoryLimit: number;
    timestamp: number;
  } = {
    fps: 60,
    memory: 0,
    memoryLimit: 0,
    timestamp: Date.now()
  };

  app.get("/api/errors/performance", (_req, res) => {
    try {
      res.json({
        ok: true,
        metrics: performanceMetrics
      });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/errors/performance", (req, res) => {
    try {
      const { fps, memory, memoryLimit } = req.body;

      performanceMetrics.fps = fps || performanceMetrics.fps;
      performanceMetrics.memory = memory || performanceMetrics.memory;
      performanceMetrics.memoryLimit = memoryLimit || performanceMetrics.memoryLimit;
      performanceMetrics.timestamp = Date.now();

      res.json({ ok: true });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.delete("/api/errors/resolved", (_req, res) => {
    try {
      ErrorMonitor.clearResolvedErrors();
      res.json({ ok: true });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}
