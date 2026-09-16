import type { Application } from 'express';
import { marketScanner } from '../../services/MarketScanner.ts';

export function registerMarketRoutes(app: Application): void {
  app.get('/api/market/tickers', (req, res) => {
    const exchange = String(req.query.exchange || 'okx');
    const sortBy = String(req.query.sortBy || 'change24h');
    const order = String(req.query.order || 'desc');
    const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 999);
    const search = String(req.query.search || '').trim().toUpperCase();

    if (!marketScanner.isRunning()) {
      res.json({ ok: false, error: 'MarketScanner not running', data: [] });
      return;
    }

    let tickers = marketScanner.getTopTickers(exchange, sortBy as 'change24h' | 'changeToday', order as 'desc' | 'asc', limit);

    if (search) {
      tickers = tickers.filter(t => t.instId.toUpperCase().includes(search));
    }

    res.json({
      ok: true,
      data: tickers,
      total: marketScanner.getAllTickers(exchange).length,
      fetchedAt: marketScanner.getLastFetchTime(exchange),
    });
  });

  app.get('/api/market/tickers/all', (req, res) => {
    const exchange = String(req.query.exchange || 'okx');
    if (!marketScanner.isRunning()) {
      res.json({ ok: false, error: 'MarketScanner not running', data: {}, total: 0 });
      return;
    }
    const all = marketScanner.getAllTickers(exchange);
    const map: Record<string, { change24h: number; changeToday: number }> = {};
    for (const t of all) {
      map[t.instId] = { change24h: t.change24h, changeToday: t.changeToday };
    }
    res.json({
      ok: true,
      data: map,
      total: all.length,
      fetchedAt: marketScanner.getLastFetchTime(exchange),
    });
  });
}
