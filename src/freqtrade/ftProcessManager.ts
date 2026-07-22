
import { ChildProcess, spawn, execFileSync, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { LogService } from '../services/logService.ts';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from '../services/errorMonitor.ts';
import { getWritableDataPath } from '../lib/getAppPath.ts';
import { generateStrategyFile } from './strategyGenerator.ts';
import { ftBacktestService } from './ftBacktestService.ts';
import type {
  FtProcessSpec,
  FtProcessInfo,
  FtDetectionResult,
  FtStartResult,
  FtLiveConfigOpts,
  FtConfigJson,
  FreqtradeStrategySpec,
} from '../types/freqtrade.ts';

const FT_START_TIMEOUT_MS = 60_000;

const FT_API_PORT_BASE = 8081;

const allocatedPorts = new Map<string, number>();

const FT_VENV_DIR = '.venv';

const FT_CONFIGS_DIR = 'ft-configs';

const GEN_STRATEGY_PREFIX = 'GenStrategy_';

export const FT_DATA_BASE = path.join(getWritableDataPath(), 'freqtrade-data');

export const FT_USER_DATA_DIR = path.join(FT_DATA_BASE, 'user_data');

const MIN_DRYRUN_DB_FILES = 3;
const DRYRUN_DB_TTL_MS = 24 * 60 * 60 * 1000;

function cleanupOldDryRunDBs(strategyId: string): void {
  try {
    if (!fs.existsSync(FT_USER_DATA_DIR)) return;
    const prefix = `tradesv3_${strategyId}_`;
    const now = Date.now();
    const allFiles = fs.readdirSync(FT_USER_DATA_DIR)
      .filter(f => f.startsWith(prefix) && f.endsWith('.dryrun.sqlite'))
      .map(f => path.join(FT_USER_DATA_DIR, f))
      .filter(f => fs.existsSync(f))
      .sort((a, b) => {
        try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
      });

    const keepFiles = new Set(allFiles.slice(0, MIN_DRYRUN_DB_FILES));
    const toDelete = allFiles.filter(f => {
      if (keepFiles.has(f)) return false;
      try { return now - fs.statSync(f).mtimeMs > DRYRUN_DB_TTL_MS; } catch { return false; }
    });

    if (toDelete.length === 0) return;

    for (const dbFile of toDelete) {
      try {
        fs.unlinkSync(dbFile);
        for (const suffix of ['-shm', '-wal']) {
          const extra = dbFile + suffix;
          if (fs.existsSync(extra)) fs.unlinkSync(extra);
        }
      } catch {  }
    }
    LogService.logKey('freqtrade', 'ft.dbCleaned', { count: toDelete.length });
  } catch {  }
}

function generateLiveConfig(opts: FtLiveConfigOpts, apiPort: number): FtConfigJson {
  const webhookUrl = `http://127.0.0.1:${opts.oktsPort}/api/webhook/freqtrade?strategy_id=${opts.strategyId}`;
  const dbUrl = `sqlite:///${FT_USER_DATA_DIR.replace(/\\/g, '/')}/tradesv3_${opts.strategyId}_${Date.now()}.dryrun.sqlite`;

  const tradingMode = opts.tradingMode || 'futures';
  const marginMode = tradingMode === 'futures' ? 'isolated' : 'cross';

  return {
    trading_mode: tradingMode,
    margin_mode: marginMode,
    max_open_trades: opts.maxOpenTrades,
    stake_currency: opts.stakeCurrency,
    stake_amount: opts.stakeAmount,
    dry_run: true,
    dry_run_wallet: opts.dryRunWallet,
    cancel_open_orders_on_exit: true,
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
    webhook: {
      enabled: true,
      url: webhookUrl,
      format: 'json',
      retries: 2,
      entry: {
        value1: '{pair}',
        value2: '{direction}',
        value3: '{current_rate}',
      },
      exit: {
        value1: '{pair}',
        value2: '{exit_reason}',
        value3: '{profit_ratio}',
      },
    },
    api_server: {
      enabled: true,
      listen_ip_address: '127.0.0.1',
      listen_port: apiPort,
      username: 'okts',
      password: 'REPLACE',
      jwt_secret_key: 'REPLACE',
    },
    bot_name: `TodoQuant_FT_${opts.strategyId}`,
    user_data_dir: FT_USER_DATA_DIR,
    db_url: dbUrl,
  };
}

function ensureConfigDir(): string {
  const baseDir = path.join(getWritableDataPath(), FT_CONFIGS_DIR);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return baseDir;
}

export function getStrategyFilePath(strategyId: string): string {
  const safeId = strategyId.replace(/[^a-zA-Z0-9]/g, '_');
  const strategiesDir = path.join(FT_USER_DATA_DIR, 'strategies');
  if (!fs.existsSync(strategiesDir)) {
    fs.mkdirSync(strategiesDir, { recursive: true });
  }
  return path.join(strategiesDir, `GenStrategy_${safeId}.py`);
}

export function writeStrategyFile(spec: FreqtradeStrategySpec, mainPair?: string): string {
  const code = generateStrategyFile(spec, mainPair);
  const filePath = getStrategyFilePath(spec.id);
  fs.writeFileSync(filePath, code, 'utf-8');
  LogService.logKey('freqtrade', 'ft.strategyFileWritten', { path: filePath });
  return filePath;
}

function writeConfigFile(strategyId: string, mode: 'live' | 'backtest', config: object): string {
  const dir = ensureConfigDir();
  const filename = `${mode}_${strategyId}.json`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  return filePath;
}

function removeConfigFile(configPath: string): void {
  try {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  } catch {
  }
}

function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', timeout: 5000 });
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        process.kill(pid, 'SIGTERM');
      }
    }
  } catch {
  }
}

class FtProcessManager {
  private processes: Map<string, FtProcessInfo> = new Map();

  private cancelledStartIds = new Set<string>();

  private ftPathCache: string | null = null;

  private ftVersionCache: string | null = null;

  async detectFreqtrade(): Promise<FtDetectionResult> {
    if (this.ftPathCache && this.ftVersionCache) {
      return { found: true, path: this.ftPathCache, version: this.ftVersionCache };
    }

    const candidates = this.getFreqtradeCandidates();

    for (const cmd of candidates) {
      try {
        const versionOutput = execFileSync(cmd, ['--version'], {
          stdio: 'pipe',
          timeout: 10000,
          encoding: 'utf-8',
        });
        const fullOutput = versionOutput.trim();
        const ftLine = fullOutput.split('\n').find(l => l.startsWith('Freqtrade Version')) || fullOutput;
        this.ftPathCache = cmd;
        this.ftVersionCache = ftLine.trim();
        LogService.logKey('freqtrade', 'ft.detected', { line: ftLine.trim() });
        return { found: true, path: cmd, version: ftLine.trim() };
      } catch {
        continue;
      }
    }

    LogService.logKey('freqtrade', 'ft.exeNotFound', {}, 'warn');
    return { found: false };
  }

  private async killOrphanFreqtradePorts(): Promise<void> {
    if (process.platform !== 'win32') return;
    try {
      const out = execSync('netstat -ano', { timeout: 5000, encoding: 'utf8' });
      const killed = new Set<string>();
      for (const line of out.split('\n')) {
        const match = line.match(/:(\d{4,5})\s+.*LISTENING\s+(\d+)/);
        if (!match) continue;
        const port = parseInt(match[1], 10);
        const pid = match[2];
        if (port >= 8080 && port <= 8090 && pid && pid !== '0' && !killed.has(pid)) {
          try {
            execSync(`taskkill /F /PID ${pid}`, { timeout: 5000, stdio: 'ignore' });
            killed.add(pid);
            LogService.logKey('freqtrade', 'ft.portReleased', { port, pid });
          } catch {  }
        }
      }
    } catch {  }
  }

  private getFreqtradeCandidates(): string[] {
    const candidates: string[] = [];

    try {
      // @ts-ignore — Electron-only global
      const rp: string | undefined = process.resourcesPath;
      if (rp && typeof rp === 'string') {
        if (process.platform === 'win32') {
          const ftCmd = path.join(rp, 'freqtrade', 'freqtrade.cmd');
          if (fs.existsSync(ftCmd)) candidates.push(ftCmd);
        } else {
          const pyBin = path.join(rp, 'freqtrade', 'bin', 'python3');
          if (fs.existsSync(pyBin)) candidates.push(pyBin);
        }
      }
    } catch {  }

    const ftDirEnv = process.env.FT_DIR;
    if (ftDirEnv && fs.existsSync(ftDirEnv)) {
      const venvDir = path.join(ftDirEnv, FT_VENV_DIR);
      if (process.platform === 'win32') {
        const ftExe = path.join(venvDir, 'Scripts', 'freqtrade.exe');
        if (fs.existsSync(ftExe)) candidates.push(ftExe);
      } else {
        const ftBin = path.join(venvDir, 'bin', 'freqtrade');
        if (fs.existsSync(ftBin)) candidates.push(ftBin);
      }
    }

    const userHome = process.env.USERPROFILE || process.env.HOME || '';
    const knownPath = path.resolve(userHome, 'freqtrade');
    if (process.platform === 'win32' && fs.existsSync(knownPath)) {
      const ftExe = path.join(knownPath, FT_VENV_DIR, 'Scripts', 'freqtrade.exe');
      if (fs.existsSync(ftExe)) candidates.push(ftExe);
    }

    const projectRoot = process.cwd();
    const venvDir = path.join(projectRoot, FT_VENV_DIR);
    if (process.platform === 'win32') {
      const ftExe = path.join(venvDir, 'Scripts', 'freqtrade.exe');
      if (fs.existsSync(ftExe)) candidates.push(ftExe);
    } else {
      const ftBin = path.join(venvDir, 'bin', 'freqtrade');
      if (fs.existsSync(ftBin)) candidates.push(ftBin);
    }

    candidates.push('freqtrade');

    return candidates;
  }

  async startLiveStrategy(
    spec: FtProcessSpec,
    strategySpec: FreqtradeStrategySpec,
    oktsPort: number,
  ): Promise<FtStartResult> {
    if (this.processes.has(spec.id)) {
      LogService.logKey('freqtrade', 'ft.alreadyRunning', { id: spec.id, pid: this.processes.get(spec.id)!.pid });
      return { ok: true, pid: this.processes.get(spec.id)!.pid };
    }

    await this.killOrphanFreqtradePorts();

    cleanupOldDryRunDBs(spec.id);

    let strategyFilePath = '';
    try {
      strategyFilePath = writeStrategyFile(strategySpec, spec.pairWhitelist[0]);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      LogService.logKey('freqtrade', 'ft.strategyFileWriteFailed', { msg: err.message }, 'error');
      return { ok: false, error: `策略文件写入失败: ${err.message}` };
    }

    if (spec.pairWhitelist.length > 0) {
      try {
        const dlResult = await ftBacktestService.downloadData({
          exchange: spec.exchange,
          pairWhitelist: spec.pairWhitelist,
          timeframes: [spec.timeframe],
          days: 7,
          tradingMode: strategySpec.tradingMode || 'futures',
        });
        if (!dlResult.ok) {
          LogService.logKey('freqtrade', 'ft.klineDownloadWarn', { msg: dlResult.error }, 'warn');
        }
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        LogService.logKey('freqtrade', 'ft.klineDownloadErr', { msg: err.message }, 'warn');
      }
    } else {
      LogService.logKey('freqtrade', 'ft.klineDownloadSkip', { id: spec.id }, 'warn');
    }

    if (this.cancelledStartIds.has(spec.id)) {
      this.cancelledStartIds.delete(spec.id);
      LogService.logKey('freqtrade', 'ft.startCancelled', { id: spec.id });
      return { ok: false, error: '策略已停止' };
    }

    const detection = await this.detectFreqtrade();
    if (!detection.found || !detection.path) {
      const msg = '未找到 freqtrade，请先安装 (pip install freqtrade) 或配置 venv';
      LogService.error('freqtrade', msg);
      LogService.logKey('freqtrade', 'ft.strategyFileDumpedNoStart', { path: strategyFilePath }, 'error');
      return { ok: false, error: msg };
    }

    const configOpts: FtLiveConfigOpts = {
      strategyId: spec.id,
      oktsPort,
      exchange: spec.exchange,
      pairWhitelist: spec.pairWhitelist,
      timeframe: spec.timeframe,
      stakeAmount: spec.stakeAmount,
      maxOpenTrades: spec.maxOpenTrades,
      stakeCurrency: spec.stakeCurrency,
      dryRunWallet: spec.dryRunWallet,
      tradingMode: strategySpec.tradingMode || 'futures',
    };

    let apiPort = allocatedPorts.get(spec.id);
    if (!apiPort) {
      const usedPorts = new Set(allocatedPorts.values());
      apiPort = FT_API_PORT_BASE;
      while (usedPorts.has(apiPort)) apiPort++;
      allocatedPorts.set(spec.id, apiPort);
    }

    const config = generateLiveConfig(configOpts, apiPort);
    const configPath = writeConfigFile(spec.id, 'live', config);
    const strategyName = `${GEN_STRATEGY_PREFIX}${spec.id}`;

    LogService.logKey('freqtrade', 'ft.start', { name: spec.name, id: spec.id });

    return new Promise<FtStartResult>((resolve) => {
      let child: ChildProcess;
      const resolved = { value: false };

      const timeout = setTimeout(() => {
        if (resolved.value) return;
        resolved.value = true;
        LogService.logKey('freqtrade', 'ft.startTimeout', { id: spec.id, secs: FT_START_TIMEOUT_MS / 1000 }, 'error');
        this.forceStopByStrategyId(spec.id);
        resolve({ ok: false, error: `启动超时（${FT_START_TIMEOUT_MS / 1000}秒）` });
      }, FT_START_TIMEOUT_MS);

      try {
        const args = ['trade', '-c', configPath, '-s', strategyName, '--dry-run'];

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

        const info: FtProcessInfo = {
          strategyId: spec.id,
          process: child,
          mode: 'live',
          configPath,
          startedAt: Date.now(),
          pid: child.pid ?? 0,
        };

        LogService.logKey('freqtrade', 'ft.spawnOk', { pid: child.pid, strategy: strategyName });

        this.processes.set(spec.id, info);

        child.stdout?.on('data', (d: Buffer) => {
          const output = d.toString();
          if (!resolved.value && (output.includes('Bot started') || output.includes('dry_run'))) {
            resolved.value = true;
            clearTimeout(timeout);
            this.cancelledStartIds.delete(spec.id);
            LogService.logKey('freqtrade', 'ft.startSuccess', { id: spec.id, pid: child.pid });
            resolve({ ok: true, pid: child.pid ?? undefined });
          }
        });

        child.stderr?.on('data', (d: Buffer) => {
          const errMsg = d.toString();
          if (errMsg.trim()) {
            for (const line of errMsg.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              if (line.includes(' - WARNING') || line.includes(' - ERROR') || line.includes(' - CRITICAL')) {
                LogService.warn('freqtrade', trimmed.length > 500 ? trimmed.slice(0, 500) + '…' : trimmed);
              }
            }
            if (!resolved.value && this.isFatalError(errMsg)) {
              resolved.value = true;
              clearTimeout(timeout);
              LogService.logKey('freqtrade', 'ft.startFailed', { id: spec.id, err: errMsg.trim() }, 'error');
              this.processes.delete(spec.id);
              allocatedPorts.delete(spec.id);
              removeConfigFile(configPath);
              resolve({ ok: false, error: errMsg.trim() });
            }
          }
        });

        child.on('exit', (code, signal) => {
          if (!resolved.value) {
            resolved.value = true;
            clearTimeout(timeout);
            const msg = code !== null
              ? `进程退出，退出码: ${code}`
              : `进程被信号终止: ${signal}`;
            LogService.logKey('freqtrade', 'ft.exit', { id: spec.id, msg }, 'warn');
            this.processes.delete(spec.id);
            allocatedPorts.delete(spec.id);
            removeConfigFile(configPath);
            resolve({ ok: false, error: msg });
          } else {
            this.processes.delete(spec.id);
            allocatedPorts.delete(spec.id);
            removeConfigFile(configPath);
            if (code !== 0) {
              LogService.logKey('freqtrade', 'ft.abnormalExit', { id: spec.id, code }, 'warn');
            }
          }
        });

        child.on('error', (err: Error) => {
          if (!resolved.value) {
            resolved.value = true;
            clearTimeout(timeout);
            LogService.logKey('freqtrade', 'ft.spawnErr', { id: spec.id, msg: err.message }, 'error');
            this.processes.delete(spec.id);
            allocatedPorts.delete(spec.id);
            removeConfigFile(configPath);
            ErrorMonitor.captureError(err, ErrorLevel.HIGH, ErrorCategory.SYSTEM);
            resolve({ ok: false, error: err.message });
          }
        });

        const pollAndStart = async () => {
          const auth = Buffer.from('okts:okts').toString('base64');
          const startTime = Date.now();
          const maxWait = 30_000;
          const apiUrl = `http://127.0.0.1:${apiPort}`;

          while (Date.now() - startTime < maxWait) {
            if (resolved.value) return;
            try {
              const resp = await fetch(`${apiUrl}/api/v1/show_config`, {
                headers: { 'Authorization': `Basic ${auth}` },
                signal: AbortSignal.timeout(2000),
              });
              if (resp.ok) break;
            } catch {  }
            await new Promise(r => setTimeout(r, 300));
          }

          if (!resolved.value && this.processes.has(spec.id)) {
            resolved.value = true;
            clearTimeout(timeout);
            const elapsed = Date.now() - startTime;
            LogService.logKey('freqtrade', 'ft.apiReady', { id: spec.id, pid: child.pid, secs: (elapsed / 1000).toFixed(1) });
            resolve({ ok: true, pid: child.pid ?? undefined });

            await new Promise(r => setTimeout(r, 1000));
            try {
              const r = await fetch(`${apiUrl}/api/v1/start`, {
                method: 'POST',
                headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
              });
              if (r.ok) {
                LogService.logKey('freqtrade', 'ft.botStarted', {});
              } else {
                LogService.logKey('freqtrade', 'ft.startFailedStatus', { status: r.status, text: r.statusText }, 'warn');
              }
            } catch (e) {
              LogService.logKey('freqtrade', 'ft.startApiErr', { msg: e instanceof Error ? e.message : String(e) }, 'warn');
            }
          }
        };
        void pollAndStart();

      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        clearTimeout(timeout);
        LogService.logKey('freqtrade', 'ft.spawnAbnormal', { id: spec.id, msg: err.message }, 'error');
        ErrorMonitor.captureError(err, ErrorLevel.HIGH, ErrorCategory.SYSTEM);
        resolve({ ok: false, error: err.message });
      }
    });
  }

  async stopStrategy(strategyId: string): Promise<void> {
    this.cancelledStartIds.add(strategyId);

    const info = this.processes.get(strategyId);
    if (!info) {
      LogService.logKey('freqtrade', 'ft.strategyNotRunning', { id: strategyId });
      return;
    }

    LogService.logKey('freqtrade', 'ft.stopStrategy', { id: strategyId, pid: info.pid });
    this.processes.delete(strategyId);
    killProcessTree(info.pid);
    removeConfigFile(info.configPath);
    this.cancelledStartIds.delete(strategyId);
    allocatedPorts.delete(strategyId);
  }

  async stopAll(): Promise<void> {
    LogService.logKey('freqtrade', 'ft.stopAll', { count: this.processes.size });

    for (const [strategyId, info] of this.processes) {
      try {
        killProcessTree(info.pid);
        removeConfigFile(info.configPath);
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        LogService.logKey('freqtrade', 'ft.stopFailed', { id: strategyId, msg: err.message }, 'warn');
      }
    }
    this.processes.clear();
  }

  getRunningProcesses(): FtProcessInfo[] {
    return Array.from(this.processes.values());
  }

  isHealthy(strategyId: string): boolean {
    const info = this.processes.get(strategyId);
    if (!info) return false;

    try {
      process.kill(info.pid, 0);
      return true;
    } catch {
      this.processes.delete(strategyId);
      removeConfigFile(info.configPath);
      return false;
    }
  }

  getRunningCount(): number {
    return this.processes.size;
  }

  private forceStopByStrategyId(strategyId: string): void {
    const info = this.processes.get(strategyId);
    if (info) {
      killProcessTree(info.pid);
      this.processes.delete(strategyId);
      allocatedPorts.delete(strategyId);
      removeConfigFile(info.configPath);
    }
  }

  private isFatalError(stderrLine: string): boolean {
    const fatalPatterns = [
      /Error:/i,
      /Exception:/i,
      /Traceback/i,
      /Could not load/i,
      /Invalid configuration/i,
      /UNHANDLED/i,
    ];

    const ignorePatterns = [
      /DeprecationWarning/i,
      /UserWarning/i,
      /INFO/i,
      /WARNING.*rate limit/i,
    ];

    if (ignorePatterns.some(p => p.test(stderrLine))) {
      return false;
    }

    return fatalPatterns.some(p => p.test(stderrLine));
  }
}

export const ftProcessManager = new FtProcessManager();

export const _internal = {
  generateLiveConfig,
  writeConfigFile,
  removeConfigFile,
  killProcessTree,
  ensureConfigDir,
};
