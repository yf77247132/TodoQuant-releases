import type { Application, Request, Response } from 'express';
import { DiyEngine } from '../../engine/diy/DiyEngine.ts';
import { dbService } from '../../services/dbService.ts';
import { LogService } from '../../services/logService.ts';
import { safeJsonParse } from '../../lib/safeJsonParse.ts';
import { sendError, toError, asyncHandler } from './shared.ts';
import { parseFtPayload, handleFtSignal } from '../../freqtrade/signalHandler.ts';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from '../../services/errorMonitor.ts';

export function registerWebhookRoutes(app: Application): void {
  app.post('/api/webhooks/tradingview', (req, res) => {
    handleTradingViewWebhook(req, res);
  });

  app.post('/api/webhook/tradingview', (req, res) => {
    handleTradingViewWebhook(req, res);
  });

  app.post('/api/webhook/freqtrade', asyncHandler(async (req: Request, res: Response) => {
    const strategyId = String(req.query.strategy_id || '').trim();
    if (!strategyId) {
      return res.status(400).json({ ok: false, error: '缺少 strategy_id' });
    }

    const exchange = String(req.query.exchange || 'okx').trim().toLowerCase();
    if (exchange !== 'okx' && exchange !== 'binance') {
      return res.status(400).json({ ok: false, error: 'exchange 参数仅支持 okx 或 binance' });
    }

    const body = req.body;
    if (!body || typeof body !== 'object') {
      LogService.logKey('freqtrade', 'webhook.bodyEmpty', {}, 'error');
      return res.status(400).json({ ok: false, error: 'Empty body' });
    }

    const signal = parseFtPayload(strategyId, body);

    const accepted = await handleFtSignal(signal);
    const localPort = (req.socket as any).localPort as number | undefined;
    const webhookUrl = `http://127.0.0.1:${localPort ?? 3000}/api/webhook/freqtrade?strategy_id=${strategyId}`;
    res.json({ ok: accepted, message: accepted ? 'Signal accepted' : 'Strategy inactive', url: webhookUrl });
  }));

  function handleTradingViewWebhook(req: any, res: any) {
    const rawBody = req.body;

    try {
      if (!rawBody || (typeof rawBody === 'string' && rawBody.trim() === '')) {
        LogService.logKey('diy', 'webhook.bodyEmpty', {}, 'error');
        return res.status(400).json({ ok: false, error: 'Empty body' });
      }

      let data: any;
      if (typeof rawBody === 'string') {
        data = safeJsonParse(rawBody, null, { context: 'webhook-tradingview' });
        if (data === null) {
          LogService.logKey('diy', 'webhook.jsonParseFailed', { raw: String(rawBody).slice(0, 100) }, 'error');
          return res.status(400).json({ ok: false, error: 'Invalid JSON format' });
        }
      } else {
        data = rawBody;
      }

      const strategyId = String(data.strategyId || '').trim();
      const secret = String(data.secret || '').trim();
      const signal = data.signal || data.action || 'default';

      if (!strategyId) {
        LogService.logKey('diy', 'webhook.noStrategyId', {}, 'warn');
        return res.status(400).json({ ok: false, error: 'Missing strategyId' });
      }

      const strategiesRaw = dbService.getConfig('diy_strategies');
      const strategies = safeJsonParse<any[]>(strategiesRaw, []);
      const st = strategies.find((s: any) => String(s.id).trim() === strategyId);

      if (!st) {
        LogService.logKey('diy', 'webhook.strategyNotFound', { id: strategyId }, 'warn');
        return res.status(404).json({ ok: false, error: 'Strategy not found' });
      }

      const templatesRaw = dbService.getConfig('diy_conditions');
      const templates = safeJsonParse<any[]>(templatesRaw, []);
      const template = templates.find((t: any) => String(t.id) === String(st.conditionTemplateId));

      const tvCondition = template?.conditions?.find((c: any) => c.type === 'tv_signal');
      const expectedSecret = String(tvCondition?.params?.secret || '').trim();

      if (tvCondition && !expectedSecret) {
        LogService.logKey('diy', 'webhook.noSecret', { strategyId, name: st.name }, 'warn');
      }

      if (expectedSecret && secret !== expectedSecret) {
        LogService.logKey('diy', 'webhook.secretMismatch', { name: st.name }, 'error', String(st.id));
        return res.status(403).json({ ok: false, error: 'Invalid secret' });
      }

      const diyEngine = DiyEngine.getInstance();
      const ok = diyEngine.pushSignal(strategyId, { signal, ...data });

      if (!ok) {
        LogService.logKey('diy', 'webhook.strategy.notRunning', { name: st.name }, 'warn', String(st.id));
      }

      res.json({ ok, message: ok ? 'Signal accepted' : 'Strategy inactive' });

    } catch (err: unknown) {
      const error = toError(err);
      LogService.logKey('diy', 'webhook.internal.error', { msg: error.message }, 'error');
      sendError(res, err);
    }
  }

}
