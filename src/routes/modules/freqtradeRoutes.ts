
import type { Application } from 'express';
import { asyncHandler, sendError } from './shared.ts';
import { ftBacktestService } from '../../freqtrade/ftBacktestService.ts';
import { ftProcessManager, getStrategyFilePath } from '../../freqtrade/ftProcessManager.ts';
import { buildSpecFromConditions } from '../../freqtrade/buildSpecFromConditions.ts';
import { okxPairToFtPair, generateStrategyFile } from '../../freqtrade/strategyGenerator.ts';
import { LogService } from '../../services/logService.ts';
import { dbService } from '../../services/dbService.ts';
import fs from 'fs';
import type {
  FtDownloadDataOpts,
  FtBacktestRunOpts,
  FreqtradeTimeframe,
  FreqtradeStrategySpec,
  FtProcessSpec,
} from '../../types/freqtrade.ts';

export function registerFreqtradeRoutes(app: Application): void {

  app.get('/api/freqtrade/detect', asyncHandler(async (_req, res) => {
    const result = await ftProcessManager.detectFreqtrade();
    res.json({ ok: true, ...result });
  }));

  app.post('/api/freqtrade/download-data', asyncHandler(async (req, res) => {
    const { exchange, pairWhitelist, timeframes, days, fromDate, toDate, tradingMode } = req.body || {};

    if (!exchange || !['okx', 'binance'].includes(exchange)) {
      return res.status(400).json({ ok: false, error: 'exchange 必须为 okx 或 binance' });
    }
    if (!Array.isArray(pairWhitelist) || pairWhitelist.length === 0) {
      return res.status(400).json({ ok: false, error: 'pairWhitelist 不能为空' });
    }
    if (!Array.isArray(timeframes) || timeframes.length === 0) {
      return res.status(400).json({ ok: false, error: 'timeframes 不能为空' });
    }
    if ((!days || days <= 0) && (!fromDate || !toDate)) {
      return res.status(400).json({ ok: false, error: 'days 必须大于 0（或提供 fromDate/toDate）' });
    }

    const opts: FtDownloadDataOpts = {
      exchange,
      pairWhitelist,
      timeframes: timeframes as FreqtradeTimeframe[],
      days: days && days > 0 ? Number(days) : calculateDays(fromDate, toDate),
      tradingMode: tradingMode === 'spot' ? 'spot' : 'futures',
    };

    const result = await ftBacktestService.downloadData(opts);
    res.json(result);
  }));

  app.post('/api/freqtrade/backtest/start', asyncHandler(async (req, res) => {
    const {
      exchange,
      pairWhitelist,
      strategyName,
      timeframe,
      fromDate,
      toDate,
      stakeAmount,
      maxOpenTrades,
      enableProtections,
      strategySpec,
      dryRunWallet,
      contractSize,
      ctVal,
      isFutures,
      timezone,
      tradingDirection,
      skipDownload,
    } = req.body || {};

    if (!exchange || !['okx', 'binance'].includes(exchange)) {
      return res.status(400).json({ ok: false, error: 'exchange 必须为 okx 或 binance' });
    }
    if (!Array.isArray(pairWhitelist) || pairWhitelist.length === 0) {
      return res.status(400).json({ ok: false, error: 'pairWhitelist 不能为空' });
    }
    if (!strategyName) {
      return res.status(400).json({ ok: false, error: 'strategyName 不能为空' });
    }
    if (!timeframe) {
      return res.status(400).json({ ok: false, error: 'timeframe 不能为空' });
    }
    if (!fromDate || !toDate) {
      return res.status(400).json({ ok: false, error: 'fromDate 和 toDate 不能为空' });
    }

    if (strategySpec) {
      try {
        const spec = strategySpec as FreqtradeStrategySpec;
        if (tradingDirection) spec.tradingDirection = tradingDirection as 'long' | 'short';
        const pythonCode = generateStrategyFile(spec, undefined, 'backtest');
        const filePath = getStrategyFilePath(spec.id);
        fs.writeFileSync(filePath, pythonCode, 'utf-8');
        LogService.logKey('freqtrade', 'ft.backtestFileWritten', { name: strategyName, mode: 'backtest' });
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        return res.status(500).json({ ok: false, error: `策略文件写入失败: ${err.message}` });
      }
    }

    const timerange = `${fromDate}-${toDate}`;

    LogService.logKey('freqtrade', 'ft.backtestStartReq', { name: strategyName, timerange });

    let finalStakeAmount = Number(stakeAmount) || 100;
    if (contractSize && Number(contractSize) > 0) {
      try {
        const { fetchMarketPrice } = await import('../../lib/marketPrice.ts');
        const mainPairRaw = pairWhitelist[0] || '';
        const price = await fetchMarketPrice(mainPairRaw);
        if (price && price > 0) {
          finalStakeAmount = calcStakeAmount(
            Number(contractSize), price, ctVal ? Number(ctVal) : undefined, isFutures !== false
          );
          LogService.logKey('freqtrade', 'ft.stakeAmountConverted', { contractSize: String(contractSize), price: String(price), amount: finalStakeAmount.toFixed(2) });
        }
      } catch {
        LogService.logKey('freqtrade', 'ft.marketPriceFailed');
      }
    }

    const tradingMode = (strategySpec as FreqtradeStrategySpec)?.tradingMode ?? 'futures';

    if (!skipDownload) {
      LogService.logKey('freqtrade', 'ft.btPhaseDownloading');
      const downloadResult = await ftBacktestService.downloadData({
        exchange,
        pairWhitelist,
        timeframes: [timeframe as FreqtradeTimeframe],
        days: calculateDays(fromDate, toDate),
        tradingMode,
      });

      if (!downloadResult.ok) {
        return res.json({ ok: false, error: `K 线数据下载失败: ${downloadResult.error}` });
      }
    }
    LogService.logKey('freqtrade', 'ft.btPhaseRunning');

    const btOpts: FtBacktestRunOpts = {
      exchange,
      pairWhitelist,
      strategyName,
      timeframe: timeframe as FreqtradeTimeframe,
      timerange,
      maxOpenTrades: Number(maxOpenTrades) || 3,
      stakeAmount: finalStakeAmount,
      enableProtections: Boolean(enableProtections),
      dryRunWallet: Number(dryRunWallet) || 10000,
      tradingMode,
    };

    const btResult = await ftBacktestService.runBacktest(btOpts);
    res.json(btResult);
  }));

  app.post('/api/freqtrade/live/start', asyncHandler(async (req, res) => {
    const { processSpec, strategySpec, oktsPort, _conditions, timezone } = req.body || {};

    if (!processSpec) {
      return res.status(400).json({ ok: false, error: 'processSpec 不能为空' });
    }
    if (!strategySpec) {
      return res.status(400).json({ ok: false, error: 'strategySpec 不能为空' });
    }
    if (!oktsPort) {
      return res.status(400).json({ ok: false, error: 'oktsPort 不能为空' });
    }

    let finalSpec = strategySpec as FreqtradeStrategySpec;
    let cleanProcSpec = processSpec as FtProcessSpec;
    if (_conditions && Array.isArray(_conditions) && _conditions.length > 0) {
      const mainPair = (processSpec as any).pairWhitelist?.[0];
      LogService.logKey('freqtrade', 'ft.rebuildSpec', { count: _conditions.length, pair: mainPair || '' });
      const rebuilt = buildSpecFromConditions(
        finalSpec.id, finalSpec.name, _conditions, finalSpec.timeframe || '1m', undefined, mainPair, timezone
      );
      if (rebuilt) {
        finalSpec = rebuilt;
        const mainPairRaw = (processSpec as any).pairWhitelist?.[0] as string | undefined;
        const whitelist = mainPairRaw ? [okxPairToFtPair(mainPairRaw)] : [];
        cleanProcSpec = { ...cleanProcSpec, pairWhitelist: whitelist };
        LogService.logKey('freqtrade', 'ft.specRebuilt', { indicator: rebuilt.entry.children[0]?.indicator || '', pair: mainPairRaw || '(none)', whitelist });
      }
    }

    const result = await ftProcessManager.startLiveStrategy(
      cleanProcSpec,
      finalSpec,
      Number(oktsPort),
    );

    const strategyFilePath = getStrategyFilePath(strategySpec.id);

    res.json({ ...result, strategyFilePath });
  }));

  app.post('/api/freqtrade/live/stop', asyncHandler(async (req, res) => {
    const { strategyId } = req.body || {};

    if (!strategyId) {
      return res.status(400).json({ ok: false, error: 'strategyId 不能为空' });
    }

    LogService.logKey('freqtrade', 'ft.stopLive', { id: strategyId });

    await ftProcessManager.stopStrategy(strategyId);
    res.json({ ok: true });
  }));

  app.get('/api/freqtrade/live/list', asyncHandler(async (_req, res) => {
    const processes = ftProcessManager.getRunningProcesses();
    res.json({
      ok: true,
      count: processes.length,
      processes: processes.map((p) => ({
        strategyId: p.strategyId,
        mode: p.mode,
        pid: p.pid,
        startedAt: p.startedAt,
      })),
    });
  }));

  app.post('/api/freqtrade/backtest/save', asyncHandler(async (req, res) => {
    const { strategyId, result } = req.body || {};
    if (!strategyId || !result) return res.status(400).json({ ok: false, error: 'Missing strategyId or result' });
    dbService.saveBacktestResult(String(strategyId), result);
    res.json({ ok: true });
  }));

  app.get('/api/freqtrade/backtest/last/:strategyId', asyncHandler(async (req, res) => {
    const { strategyId } = req.params;
    if (!strategyId) return res.status(400).json({ ok: false, error: 'Missing strategyId' });
    const data = dbService.getBacktestResult(strategyId);
    res.json({ ok: true, data });
  }));
}

function calcStakeAmount(
  contractSize: number,
  marketPrice: number,
  ctVal?: number,
  isFutures = true,
): number {
  if (isFutures && ctVal) {
    return contractSize * ctVal * marketPrice;
  }
  return contractSize * marketPrice;
}

function calculateDays(fromDate: string, toDate: string): number {
  try {
    const normalize = (s: string) => s.length === 8
      ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
      : s;
    const from = new Date(normalize(fromDate));
    const to = new Date(normalize(toDate));
    const days = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(days, 1);
  } catch {
    return 30;
  }
}
