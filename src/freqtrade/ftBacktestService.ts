
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { LogService } from '../services/logService.ts';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from '../services/errorMonitor.ts';
import { ftProcessManager, FT_USER_DATA_DIR } from './ftProcessManager.ts';
import { getWritableDataPath } from '../lib/getAppPath.ts';
import type {
  FtDownloadDataOpts,
  FtDownloadResult,
  FtBacktestRunOpts,
  FtBacktestResult,
  FtBacktestResultDetail,
  FtBacktestResultSummary,
  FtBacktestTrade,
  FtDailyStats,
  FreqtradeTimeframe,
} from '../types/freqtrade.ts';

const BACKTEST_TIMEOUT_MS = 300_000;

const DOWNLOAD_TIMEOUT_MS = 600_000;

const FT_CONFIGS_DIR = 'ft-configs';

function generateDownloadConfig(opts: FtDownloadDataOpts, tradingMode: 'futures' | 'spot' = 'futures'): object {
  return {
    trading_mode: tradingMode,
    margin_mode: tradingMode === 'futures' ? 'isolated' : '',
    stake_currency: 'USDT',
    stake_amount: 100,
    dry_run: true,
    dry_run_wallet: 1000,
    max_open_trades: 3,
    exchange: {
      name: opts.exchange,
      key: '',
      secret: '',
      pair_whitelist: opts.pairWhitelist,
    },
    user_data_dir: FT_USER_DATA_DIR,
  };
}

function generateBacktestConfig(opts: FtBacktestRunOpts): object {
  const tradingMode = opts.tradingMode ?? 'futures';
  return {
    trading_mode: tradingMode,
    margin_mode: tradingMode === 'futures' ? 'isolated' : '',
    stake_currency: 'USDT',
    stake_amount: opts.stakeAmount ?? 100,
    dry_run: true,
    dry_run_wallet: opts.dryRunWallet ?? 10000,
    max_open_trades: opts.maxOpenTrades ?? 3,
    timeframe: opts.timeframe,
    exchange: {
      name: opts.exchange,
      key: '',
      secret: '',
      pair_whitelist: opts.pairWhitelist,
    },
    pairlists: [
      { method: 'StaticPairList' },
    ],
    entry_pricing: {
      price_side: 'other',
      use_order_book: true,
      order_book_top: 1,
    },
    exit_pricing: {
      price_side: 'other',
      use_order_book: true,
      order_book_top: 1,
    },
    bot_name: `TodoQuant_BT_${opts.strategyName}`,
    user_data_dir: FT_USER_DATA_DIR,
  };
}

function ensureConfigDir(): string {
  const baseDir = path.join(getWritableDataPath(), FT_CONFIGS_DIR);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return baseDir;
}

function writeTempConfig(prefix: string, config: object): string {
  const dir = ensureConfigDir();
  const filename = `${prefix}_${Date.now()}.json`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  return filePath;
}

function removeTempConfig(configPath: string): void {
  try {
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  } catch {
  }
}

function parseBacktestResult(raw: Record<string, unknown>, dryRunWalletParam: number = 10000): FtBacktestResultDetail {

  let strategyName = 'unknown';
  let strategyData = raw as Record<string, unknown>;

  if (raw.strategy && typeof raw.strategy === 'object' && !Array.isArray(raw.strategy)) {
    const strategyObj = raw.strategy as Record<string, unknown>;
    const strategyKeys = Object.keys(strategyObj);
    if (strategyKeys.length > 0) {
      strategyName = strategyKeys[0];
      strategyData = strategyObj[strategyName] as Record<string, unknown>;
    }
  } else if (typeof raw.strategy === 'string') {
    strategyName = raw.strategy;
    strategyData = (raw[strategyName] || raw) as Record<string, unknown>;
  }

  const summary: FtBacktestResultSummary = {
    strategy: strategyName,
    profitTotal: Number(strategyData.profit_total ?? strategyData.profitTotal ?? 0),
    profitTotalAbs: Number(strategyData.profit_total_abs ?? strategyData.profitTotalAbs ?? 0),
    tradeCount: Number(strategyData.total_trades ?? strategyData.tradeCount ?? strategyData.trades ?? 0),
    winningTrades: Number(strategyData.winning_trades ?? strategyData.wins ?? 0),
    losingTrades: Number(strategyData.losing_trades ?? strategyData.losses ?? 0),
    winRate: 0,
    maxDrawdown: Number(strategyData.max_drawdown_account ?? strategyData.max_drawdown ?? strategyData.maxDrawdown ?? 0),
    maxDrawdownAbs: Number(strategyData.max_drawdown_abs ?? strategyData.maxDrawdownAbs ?? 0),
    drawdownStart: String(strategyData.drawdown_start ?? ''),
    drawdownEnd: String(strategyData.drawdown_end ?? ''),
    avgProfit: Number(strategyData.avg_profit ?? strategyData.avgProfit ?? 0),
    avgDuration: (() => {
      const holdingAvg = strategyData.holding_avg ?? strategyData.holdingAvg;
      const holdingAvgS = strategyData.holding_avg_s ?? strategyData.holdingAvgS;
      if (holdingAvg != null) {
        if (typeof holdingAvg === 'number') {
          const totalMin = holdingAvg;
          const h = Math.floor(totalMin / 60);
          const m = Math.round(totalMin % 60);
          return h > 0 ? `${h}h${m}m` : `${m}m`;
        }
        const match = String(holdingAvg).match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
        if (match) {
          const h = parseInt(match[1], 10);
          const m = parseInt(match[2], 10);
          return h > 0 ? `${h}h${m}m` : `${m}m`;
        }
        return String(holdingAvg);
      }
      if (holdingAvgS != null) {
        const totalSec = Number(holdingAvgS);
        const h = Math.floor(totalSec / 3600);
        const m = Math.round((totalSec % 3600) / 60);
        return h > 0 ? `${h}h${m}m` : `${m}m`;
      }
      return '-';
    })(),
    sharpe: strategyData.sharpe != null ? Number(strategyData.sharpe) : undefined,
    sortino: strategyData.sortino != null ? Number(strategyData.sortino) : undefined,
    calmar: strategyData.calmar != null ? Number(strategyData.calmar) : undefined,
    sqn: strategyData.sqn != null ? Number(strategyData.sqn) : undefined,
    profitFactor: strategyData.profit_factor != null ? Number(strategyData.profit_factor) : undefined,
    expectancy: strategyData.expectancy != null ? Number(strategyData.expectancy) : undefined,
    startingBalance: strategyData.starting_balance != null ? Number(strategyData.starting_balance) : (strategyData.dry_run_wallet != null ? Number(strategyData.dry_run_wallet) : undefined),
    finalBalance: strategyData.final_balance != null ? Number(strategyData.final_balance) : undefined,
    cagr: strategyData.cagr != null ? Number(strategyData.cagr) : undefined,
    tradeCountLong: strategyData.trade_count_long != null ? Number(strategyData.trade_count_long) : undefined,
    tradeCountShort: strategyData.trade_count_short != null ? Number(strategyData.trade_count_short) : undefined,
    profitMean: strategyData.profit_mean != null ? Number(strategyData.profit_mean) : undefined,
    backtestStart: String(strategyData.backtest_start ?? ''),
    backtestEnd: String(strategyData.backtest_end ?? ''),
  };

  if (summary.tradeCount > 0) {
    summary.winRate = summary.winningTrades / summary.tradeCount;
  } else if (strategyData.win_rate != null || strategyData.winRate != null) {
    summary.winRate = Number(strategyData.win_rate ?? strategyData.winRate ?? 0);
  }

  const rawTrades = (strategyData.trades ?? raw.trades ?? []) as Record<string, unknown>[];
  const trades: FtBacktestTrade[] = rawTrades.map((t: Record<string, unknown>) => ({
    pair: String(t.pair ?? ''),
    direction: (() => {
      if (t.direction != null) {
        const d = String(t.direction).toLowerCase();
        if (d === 'short') return 'short' as const;
        if (d === 'long') return 'long' as const;
      }
      const isShort = t.is_short;
      if (isShort === true || isShort === 1 || String(isShort).toLowerCase() === 'true') return 'short' as const;
      return 'long' as const;
    })(),
    openDate: String(t.open_date ?? t.openDate ?? ''),
    closeDate: String(t.close_date ?? t.closeDate ?? ''),
    openRate: Number(t.open_rate ?? t.openRate ?? 0),
    closeRate: Number(t.close_rate ?? t.closeRate ?? 0),
    profit: Number(t.profit_abs ?? t.profit ?? 0),
    profitRatio: Number(t.profit_ratio ?? t.profitRatio ?? 0),
    exitReason: String(t.exit_reason ?? t.exitReason ?? ''),
    stakeAmount: Number(t.stake_amount ?? t.stakeAmount ?? 0),
    duration: (() => {
      const rawDur = t.trade_duration ?? t.duration;
      if (rawDur == null || rawDur === '') return '-';
      if (typeof rawDur === 'number') {
        const totalMin = rawDur;
        const h = Math.floor(totalMin / 60);
        const m = Math.round(totalMin % 60);
        return h > 0 ? `${h}h${m}m` : `${m}m`;
      }
      return String(rawDur);
    })(),
    leverage: t.leverage != null ? Number(t.leverage) : undefined,
    enterTag: String(t.enter_tag ?? ''),
    exitTag: String(t.exit_tag ?? ''),
  }));

  let dailyStats: FtDailyStats[] = [];
  const rawDailyProfit = (strategyData.daily_profit ?? raw.daily_profit) as Array<[string, number]> | undefined;
  const rawDailyStats = (raw.daily_stats ?? raw.dailyStats ?? strategyData.daily_stats ?? strategyData.dailyStats) as Record<string, unknown>[] | undefined;

  if (rawDailyProfit && Array.isArray(rawDailyProfit) && rawDailyProfit.length > 0) {
    let cumulativeBalance = Number(dryRunWalletParam ?? 10000);
    dailyStats = rawDailyProfit.map(([date, profit]) => {
      cumulativeBalance += profit;
      return {
        date,
        profit,
        profitRatio: cumulativeBalance > 0 ? profit / (cumulativeBalance - profit) : 0,
        openTradeCount: 0,
        balance: cumulativeBalance,
      };
    });
  } else if (rawDailyStats && Array.isArray(rawDailyStats) && rawDailyStats.length > 0) {
    dailyStats = (rawDailyStats as Record<string, unknown>[]).map((d: Record<string, unknown>) => ({
      date: String(d.date ?? ''),
      profit: Number(d.abs_profit ?? d.profit ?? 0),
      profitRatio: Number(d.profit ?? d.profitRatio ?? 0),
      openTradeCount: Number(d.open_trade_count ?? d.openTradeCount ?? 0),
      balance: Number(d.balance ?? 0),
    }));
  }

  return { strategy: strategyName, summary, trades, dailyStats: dailyStats.length > 0 ? dailyStats : undefined };
}

function extractFatalError(stderr: string): string | null {
  const lines = stderr.split('\n');
  const errorLines: string[] = [];
  let collecting = false;

  for (const line of lines) {
    if (/^\s*Traceback/.test(line) || /\bError:/i.test(line) || /\bException:/i.test(line)) {
      collecting = true;
    }
    if (collecting) {
      errorLines.push(line);
      if (line.trim() === '' && errorLines.length > 1) {
        collecting = false;
      }
    }
  }

  return errorLines.length > 0 ? errorLines.join('\n').trim() : null;
}

const BACKTEST_RESULTS_DIR = path.join(FT_USER_DATA_DIR, 'backtest_results');

function cleanupBacktestResults(): void {
  try {
    if (!fs.existsSync(BACKTEST_RESULTS_DIR)) return;
    const files = fs.readdirSync(BACKTEST_RESULTS_DIR)
      .filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        fs.unlinkSync(path.join(BACKTEST_RESULTS_DIR, f));
      } catch {  }
    }
  } catch {  }
}

function readLatestBacktestResult(): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(BACKTEST_RESULTS_DIR)) return null;

    const lastResultPath = path.join(BACKTEST_RESULTS_DIR, '.last_result.json');
    if (!fs.existsSync(lastResultPath)) return null;

    const lastResultContent = fs.readFileSync(lastResultPath, 'utf-8');
    const lastResult = JSON.parse(lastResultContent) as { latest_backtest?: string };
    const zipFileName = lastResult.latest_backtest;

    if (!zipFileName) return null;

    const zipPath = path.join(BACKTEST_RESULTS_DIR, zipFileName);
    if (!fs.existsSync(zipPath)) return null;

    const jsonResult = extractJsonFromZip(zipPath);

    return jsonResult;
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    LogService.logKey('freqtrade', 'ft.btReadResultFailed', { msg: err.message });
    return null;
  }
}

function extractJsonFromZip(zipPath: string): Record<string, unknown> | null {
  try {
    const pythonExe = process.platform === 'win32' ? 'py' : 'python3';
    const pythonCmd = `${pythonExe} -c "import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); names=[n for n in z.namelist() if n.endswith('.json') and 'meta' not in n]; data=json.loads(z.read(names[0]) if names else '{}'); sys.stdout.write(json.dumps(data))" "${zipPath}"`;

    const result = execSync(pythonCmd, {
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
    });

    if (!result || result.trim() === '{}') return null;
    return JSON.parse(result) as Record<string, unknown>;
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    LogService.logKey('freqtrade', 'ft.btUnzipFailed', { msg: err.message });

    try {
      const baseName = path.basename(zipPath, '.zip');
      const jsonPath = path.join(BACKTEST_RESULTS_DIR, `${baseName}.json`);
      if (fs.existsSync(jsonPath)) {
        const content = fs.readFileSync(jsonPath, 'utf-8');
        return JSON.parse(content) as Record<string, unknown>;
      }
    } catch {  }

    return null;
  }
}

class FtBacktestService {

  async downloadData(opts: FtDownloadDataOpts): Promise<FtDownloadResult> {
    const detection = await ftProcessManager.detectFreqtrade();
    if (!detection.found || !detection.path) {
      const msg = '未找到 freqtrade，请先安装或配置 venv';
      LogService.logKey('freqtrade', 'ft.exeNotFound');
      return { ok: false, error: msg };
    }

    const tradingMode = opts.tradingMode ?? 'futures';
    const config = generateDownloadConfig(opts, tradingMode);
    const configPath = writeTempConfig('download', config);

    const timeframes = opts.timeframes.join(' ');
    const pairs = opts.pairWhitelist.join(' ');

    LogService.logKey('freqtrade', 'ft.btDownloadKline', { exchange: opts.exchange, pairs, timeframes, days: opts.days });

    return new Promise<FtDownloadResult>((resolve) => {
      let stderr = '';
      const resolved = { value: false };

      try {
        const args = [
          'download-data',
          '-c', configPath,
          '-p', ...opts.pairWhitelist,
          '-t', ...opts.timeframes,
          '--days', String(opts.days),
          '--trading-mode', tradingMode,
        ];

        let child: ReturnType<typeof spawn>;
        if (process.platform === 'win32') {
          child = spawn(`"${detection.path}"`, args, {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
            windowsHide: true,
            shell: true,
          });
        } else {
          child = spawn(detection.path, args, {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
          });
        }

        child.stderr?.on('data', (d: Buffer) => {
          stderr += d.toString();
        });

        child.on('exit', (code) => {
          if (resolved.value) return;
          resolved.value = true;
          removeTempConfig(configPath);

          if (code === 0) {
            LogService.logKey('freqtrade', 'ft.btDownloadDone');
            resolve({ ok: true });
          } else {
            const errorMsg = stderr.trim() || `进程退出码: ${code}`;
            LogService.logKey('freqtrade', 'ft.btDownloadFailed', { msg: errorMsg });
            resolve({ ok: false, error: errorMsg });
          }
        });

        child.on('error', (err: Error) => {
          if (resolved.value) return;
          resolved.value = true;
          removeTempConfig(configPath);
          LogService.logKey('freqtrade', 'ft.btDownloadFailed', { msg: err.message });
          ErrorMonitor.captureError(err, ErrorLevel.HIGH, ErrorCategory.SYSTEM);
          resolve({ ok: false, error: err.message });
        });

        setTimeout(() => {
          if (resolved.value) return;
          resolved.value = true;
          child.kill();
          removeTempConfig(configPath);
          LogService.logKey('freqtrade', 'ft.btTimeout', { seconds: DOWNLOAD_TIMEOUT_MS / 1000 });
          resolve({ ok: false, error: '下载超时（10 分钟）' });
        }, DOWNLOAD_TIMEOUT_MS);

      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        removeTempConfig(configPath);
        LogService.logKey('freqtrade', 'ft.btDownloadFailed', { msg: err.message });
        ErrorMonitor.captureError(err, ErrorLevel.HIGH, ErrorCategory.SYSTEM);
        resolve({ ok: false, error: err.message });
      }
    });
  }

  async runBacktest(opts: FtBacktestRunOpts): Promise<FtBacktestResult> {
    try {
      const detection = await ftProcessManager.detectFreqtrade();
      if (!detection.found || !detection.path) {
        const msg = '未找到 freqtrade，请先安装或配置 venv';
        LogService.logKey('freqtrade', 'ft.exeNotFound');
        return { ok: false, status: 'error', error: msg };
      }

      const config = generateBacktestConfig(opts);
      const configPath = writeTempConfig('backtest', config);

      cleanupBacktestResults();

      LogService.logKey('freqtrade', 'ft.btLaunch', { name: opts.strategyName, timerange: opts.timerange });

      return new Promise<FtBacktestResult>((resolve) => {
        let stderr = '';
        const resolved = { value: false };

        const timeout = setTimeout(() => {
          if (resolved.value) return;
          resolved.value = true;
          removeTempConfig(configPath);
          LogService.logKey('freqtrade', 'ft.btTimeout', { seconds: BACKTEST_TIMEOUT_MS / 1000 });
          resolve({ ok: false, status: 'error', error: `回测超时（${BACKTEST_TIMEOUT_MS / 1000}秒）` });
        }, BACKTEST_TIMEOUT_MS);

        try {
          const args = [
            'backtesting',
            '-c', configPath,
            '-s', opts.strategyName,
            '--timerange', opts.timerange,
            '--stake-amount', String(opts.stakeAmount ?? 100),
            '--max-open-trades', String(opts.maxOpenTrades ?? 3),
            '--dry-run-wallet', String(opts.dryRunWallet ?? 10000),
            '--export', 'trades',
          ];

          if (opts.enableProtections) {
            args.push('--enable-protections');
          }

          let child: ReturnType<typeof spawn>;
          if (process.platform === 'win32') {
            child = spawn(`"${detection.path}"`, args, {
              cwd: process.cwd(),
              stdio: ['ignore', 'pipe', 'pipe'],
              env: { ...process.env },
              windowsHide: true,
              shell: true,
            });
          } else {
            child = spawn(detection.path, args, {
              cwd: process.cwd(),
              stdio: ['ignore', 'pipe', 'pipe'],
              env: { ...process.env },
            });
          }

          child.stderr?.on('data', (d: Buffer) => {
            stderr += d.toString();
          });

          child.on('exit', (code) => {
            if (resolved.value) return;
            resolved.value = true;
            clearTimeout(timeout);
            removeTempConfig(configPath);

            if (code !== 0) {
              const errorMsg = extractFatalError(stderr) || `进程退出码: ${code}`;
              LogService.logKey('freqtrade', 'ft.btExecFailed', { msg: errorMsg });
              resolve({ ok: false, status: 'error', error: errorMsg });
              return;
            }

            const jsonResult = readLatestBacktestResult();
            if (!jsonResult) {
              const errorMsg = 'i18n:backtest.btTimeRangeTooLong';
              LogService.logKey('freqtrade', 'ft.btReadResultFailed', { msg: 'timeRangeTooLong' });
              resolve({ ok: false, status: 'error', error: errorMsg });
              return;
            }

            try {
              const parsed = parseBacktestResult(jsonResult, opts.dryRunWallet ?? 10000);
              LogService.logKey('freqtrade', 'ft.btDone', {
                trades: parsed.summary.tradeCount,
                winRate: (parsed.summary.winRate * 100).toFixed(1),
                profit: (parsed.summary.profitTotal * 100).toFixed(2),
              });
              resolve({
                ok: true,
                status: 'stopped',
                result: parsed,
              });
            } catch (e: unknown) {
              const err = e instanceof Error ? e : new Error(String(e));
              LogService.logKey('freqtrade', 'ft.btResultParseError', { msg: err.message });
              resolve({ ok: false, status: 'error', error: `回测结果解析失败: ${err.message}` });
            }
          });

          child.on('error', (err: Error) => {
            if (resolved.value) return;
            resolved.value = true;
            clearTimeout(timeout);
            removeTempConfig(configPath);
            LogService.logKey('freqtrade', 'ft.btExecFailed', { msg: err.message });
            ErrorMonitor.captureError(err, ErrorLevel.HIGH, ErrorCategory.SYSTEM);
            resolve({ ok: false, status: 'error', error: err.message });
          });

        } catch (e: unknown) {
          const err = e instanceof Error ? e : new Error(String(e));
          clearTimeout(timeout);
          removeTempConfig(configPath);
          LogService.logKey('freqtrade', 'ft.btExecFailed', { msg: err.message });
          ErrorMonitor.captureError(err, ErrorLevel.HIGH, ErrorCategory.SYSTEM);
          resolve({ ok: false, status: 'error', error: err.message });
        }
      });

    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      LogService.logKey('freqtrade', 'ft.btExecFailed', { msg: err.message });
      ErrorMonitor.captureError(err, ErrorLevel.HIGH, ErrorCategory.SYSTEM);
      return { ok: false, status: 'error', error: err.message };
    }
  }
}

export const ftBacktestService = new FtBacktestService();

export const _internal = {
  parseBacktestResult,
  readLatestBacktestResult,
  extractJsonFromZip,
  extractFatalError,
};
