
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { LogService } from './logService.ts';
import type { ExchangeAccount } from '../types/index.ts';
import { getWritableDbPath, getBackupPath, getBackupDirPath, getCorruptedDirPath } from '../lib/getAppPath.ts';

const require = createRequire(import.meta.url || path.join(process.cwd(), '_'));
let Database: any;

try {
  Database = require('better-sqlite3');
} catch (e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e));
  const errMsg = err.message;
  const errCode = (err as any).code;
  if (errCode === 'ERR_DLOPEN_FAILED' || errMsg.includes('NODE_MODULE_VERSION') || errMsg.includes('better-sqlite3.node')) {
    console.error('\n========================================================================');
    console.error('[FATAL] better-sqlite3 原生模块与当前 Node.js/Electron 运行环境的 ABI 版本不匹配！');
    console.error(`具体错误: ${errMsg}`);
    console.error('------------------------------------------------------------------------');
    console.error('【修复方法】:');
    console.error('1. 如果您在运行/打包 Electron 桌面客户端模式，请在项目根目录运行:');
    console.error('   npx @electron/rebuild -f -w better-sqlite3');
    console.error('2. 如果您在运行本地 dev 网页服务，请在项目根目录运行:');
    console.error('   npm rebuild better-sqlite3');
    console.error('========================================================================\n');
    throw new Error(`better-sqlite3 ABI mismatch: ${errMsg}`);
  }
  throw err;
}

const DB_PATH = getWritableDbPath();
const BACKUP_PATH = getBackupPath();

let db: any;

let _ready = false;

let autoBackupTimer: NodeJS.Timeout | null = null;

function isReady(): boolean {
  if (_ready) return true;
  console.warn('[DB] Database not ready yet, operation skipped.');
  return false;
}

function saveDb() {
}

function initDatabase() {
  try {
    const backupDir = getBackupDirPath();
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    if (!fs.existsSync(DB_PATH) || fs.statSync(DB_PATH).size === 0) {
      if (fs.existsSync(BACKUP_PATH) && fs.statSync(BACKUP_PATH).size > 0) {
        console.log(`[DB] 数据库文件缺失或为空，正在从备份恢复: ${BACKUP_PATH} -> ${DB_PATH}`);
        fs.copyFileSync(BACKUP_PATH, DB_PATH);
        console.log('[DB] 数据库恢复成功。');
      } else {
        console.log('[DB] 数据库文件缺失且无可用备份，将创建新数据库。');
      }
    }

    try {
      db = new Database(DB_PATH, { timeout: 5000 });
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('foreign_keys = ON');
      
      db.pragma('cache_size = -16000');
      db.pragma('temp_store = MEMORY');
      db.pragma('mmap_size = 268435456');
      
      db.prepare('SELECT name FROM sqlite_master LIMIT 1').get();
    } catch (dbError: any) {
      console.error(`[DB] 数据库打开或验证失败: ${dbError}`);
      
      if (dbError.code === 'SQLITE_BUSY' || dbError.message.includes('busy') || dbError.message.includes('locked')) {
        LogService.logKey('DB', 'system.db.locked', {}, 'error');
        throw dbError; 
      }

      const shmPath = `${DB_PATH}-shm`;
      const walPath = `${DB_PATH}-wal`;
      if (fs.existsSync(shmPath) || fs.existsSync(walPath)) {
        console.log('[DB] 检测到历史残留文件，尝试静默重新加载...');
        try {
          if (db) { try { db.close(); } catch (e: unknown) {
            const err = e instanceof Error ? e : new Error(String(e));
            LogService.warn("db", `db.close() 失败（恢复重试前）: ${err.message}`);
          } }
          
          db = new Database(DB_PATH, { timeout: 5000 });
          db.pragma('journal_mode = WAL');
          db.pragma('synchronous = NORMAL');
          db.pragma('foreign_keys = ON');
          db.prepare('SELECT name FROM sqlite_master LIMIT 1').get();
          console.log('[DB] 旧状态恢复成功。');
          _ready = true;
          createTables();
          return;
        } catch (retryError) {
          console.error(`[DB] 恢复旧状态重试依然失败: ${retryError}`);
        }
      }

      if (fs.existsSync(BACKUP_PATH) && fs.statSync(BACKUP_PATH).size > 0) {
        console.log(`[DB] 尝试从备份恢复损坏的数据库: ${BACKUP_PATH} -> ${DB_PATH}`);
        const corruptedPath = path.join(getCorruptedDirPath(), `trading.db.${Date.now()}.corrupted`);
        const corruptedDir = path.dirname(corruptedPath);
        if (!fs.existsSync(corruptedDir)) fs.mkdirSync(corruptedDir, { recursive: true });
        fs.copyFileSync(DB_PATH, corruptedPath);
        
        if (db) { try { db.close(); } catch (e: unknown) {
          const err = e instanceof Error ? e : new Error(String(e));
          LogService.warn("db", `db.close() 失败（备份恢复前）: ${err.message}`);
        } }
        fs.copyFileSync(BACKUP_PATH, DB_PATH);
        db = new Database(DB_PATH, { timeout: 5000 });
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('foreign_keys = ON');
        db.prepare('SELECT name FROM sqlite_master LIMIT 1').get();
        console.log('[DB] 数据库已从备份恢复并重新打开。');
      } else {
        console.error('[DB] 数据库可能已损坏且无可用备份，正在尝试重置数据库以恢复服务...');
        const corruptedPath = path.join(getCorruptedDirPath(), `trading.db.${Date.now()}.corrupted`);
        const corruptedDir = path.dirname(corruptedPath);
        if (!fs.existsSync(corruptedDir)) fs.mkdirSync(corruptedDir, { recursive: true });
        
        if (fs.existsSync(DB_PATH)) {
          try {
            fs.renameSync(DB_PATH, corruptedPath);
          } catch {
            try {
              fs.copyFileSync(DB_PATH, corruptedPath);
              fs.unlinkSync(DB_PATH);
            } catch (unlinkErr) {
              console.warn(`[DB] 无法备份损坏文件: ${unlinkErr}`);
            }
          }
        }
        
        db = new Database(DB_PATH, { timeout: 5000 });
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('foreign_keys = ON');
        console.log('[DB] 数据库已重置。');
      }
    }

    _ready = true;
    LogService.logKey('DB', 'bootstrap.db.init', {}, 'info');
    createTables();
  } catch (error) {
    LogService.logKey('DB', 'system.db.initFailed', { msg: String(error) }, 'error');
    throw error;
  }
}

function run(sql: string, params: unknown[] = []) {
  if (!isReady()) return { changes: 0 };
  const stmt = db.prepare(sql);
  const result = stmt.run(...params);
  return { changes: result.changes };
}

function getOne<T>(sql: string, params: unknown[] = []): T | undefined {
  if (!isReady()) return undefined;
  const stmt = db.prepare(sql);
  return stmt.get(...params) as T | undefined;
}

function getAll<T>(sql: string, params: unknown[] = []): T[] {
  if (!isReady()) return [];
  const stmt = db.prepare(sql);
  return stmt.all(...params) as T[];
}

function createTables() {
  if (!isReady()) return;
  const tables = [
    `CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)`,
    `CREATE TABLE IF NOT EXISTS exchange_accounts (id TEXT PRIMARY KEY, name TEXT, exchange TEXT, color TEXT, apiKey TEXT, secretKey TEXT, passphrase TEXT, isEncrypted INTEGER DEFAULT 1, createdAt INTEGER, updatedAt INTEGER)`,
    `CREATE TABLE IF NOT EXISTS errors (id TEXT PRIMARY KEY, level TEXT, category TEXT, message TEXT, stack TEXT, details TEXT, script TEXT, timestamp INTEGER, resolved INTEGER DEFAULT 0, userId TEXT)`,
    `CREATE TABLE IF NOT EXISTS instruments (instId TEXT PRIMARY KEY, instType TEXT, baseCcy TEXT, quoteCcy TEXT, state TEXT)`,
    `CREATE TABLE IF NOT EXISTS backtest_results (strategyId TEXT PRIMARY KEY, data TEXT, updatedAt INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_backtest_updated ON backtest_results (updatedAt DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_errors_timestamp ON errors (timestamp DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_errors_level ON errors (level)`,
    `CREATE INDEX IF NOT EXISTS idx_errors_category ON errors (category)`,
    `CREATE INDEX IF NOT EXISTS idx_errors_resolved ON errors (resolved)`,
  ];
  for (const sql of tables) db.exec(sql);
  LogService.logKey('DB', 'bootstrap.db.tables', {}, 'info');
}

async function backupTo(destPath: string): Promise<void> {
  if (!isReady()) throw new Error('DB not ready');
  await db.backup(destPath);
}

function closeDb() {
  if (db) db.close();
}

function scheduleAutoBackup() {
  autoBackupTimer = setInterval(async () => {
    try {
      if (isReady()) {
        const backupDir = path.dirname(BACKUP_PATH);
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }
        
        await db.backup(BACKUP_PATH);
      }
    } catch (error) {
      console.error('[DB] 自动备份失败:', error);
    }
  }, 10 * 60 * 1000);
}

function stopAutoBackup() {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
}

function reloadDb() {
  if (db) db.close();
  _ready = false;
  initDatabase();
  LogService.info('DB', '数据库已从磁盘重新加载。');
}

export { initDatabase, createTables, isReady, saveDb, backupTo, closeDb, reloadDb, scheduleAutoBackup };

initDatabase();
scheduleAutoBackup();
backupTo(BACKUP_PATH).then(() => {
}).catch((e) => console.error('[DB] 启动备份失败:', e));
export const ready = Promise.resolve();

export const dbService = {
  run,
  getOne,
  getAll,
  getConfig: (key: string): string | null => {
    const row = getOne<{ value: string }>('SELECT value FROM app_config WHERE key = ?', [key]);
    return row ? row.value : null;
  },

  getAllConfigs: (): Record<string, unknown> => {
    const rows = getAll<{ key: string; value: string }>('SELECT * FROM app_config');
    const configs: Record<string, unknown> = {};
    for (const row of rows) {
      try { configs[row.key] = JSON.parse(row.value); }
      catch { configs[row.key] = row.value; }
    }
    return configs;
  },

  setConfig: (key: string, value: unknown) => {
    const valStr = typeof value === 'string' ? value : JSON.stringify(value);
    run('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)', [key, valStr]);
  },

  setConfigs: (configs: Record<string, unknown>) => {
    const stmt = db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)');
    const insertMany = db.transaction((entries: [string, string][]) => {
      for (const [key, valStr] of entries) stmt.run(key, valStr);
    });
    insertMany(Object.entries(configs).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  },

  getAccounts: (): ExchangeAccount[] => {
    return getAll<ExchangeAccount>('SELECT * FROM exchange_accounts ORDER BY createdAt ASC');
  },

  saveAccount: (account: ExchangeAccount & { isEncrypted?: boolean | number }) => {
    run(
      `INSERT OR REPLACE INTO exchange_accounts (id, name, exchange, color, apiKey, secretKey, passphrase, isEncrypted, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [account.id, account.name, account.exchange, account.color, account.apiKey, account.secretKey, account.passphrase,
       typeof account.isEncrypted === 'number' ? account.isEncrypted : (account.isEncrypted ? 1 : 0),
       account.createdAt || Date.now(), Date.now()]
    );
  },

  deleteAccount: (id: string) => { run('DELETE FROM exchange_accounts WHERE id = ?', [id]); },

  clearAll: () => { run('DELETE FROM app_config'); run('DELETE FROM exchange_accounts'); },

  saveError: (error: { id: string; level: string; category: string; message: string; stack?: string; details?: Record<string, unknown>; script?: string; timestamp: number; resolved?: boolean; userId?: string; }) => {
    try {
      run(
        `INSERT OR REPLACE INTO errors (id, level, category, message, stack, details, script, timestamp, resolved, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [error.id, error.level, error.category, error.message, error.stack || null,
         error.details ? JSON.stringify(error.details) : null, error.script || null,
         error.timestamp, error.resolved ? 1 : 0, error.userId || null]
      );
    } catch (e) {
      console.error('[DB] 保存错误记录失败:', (e as Error).message);
    }
  },

  getErrors: (limit?: number, offset?: number) => {
    if (limit !== undefined) return getAll('SELECT * FROM errors ORDER BY timestamp DESC LIMIT ? OFFSET ?', [limit, offset || 0]);
    return getAll('SELECT * FROM errors ORDER BY timestamp DESC');
  },

  getErrorsByLevel: (level: string, limit?: number) => {
    if (limit !== undefined) return getAll('SELECT * FROM errors WHERE level = ? ORDER BY timestamp DESC LIMIT ?', [level, limit]);
    return getAll('SELECT * FROM errors WHERE level = ? ORDER BY timestamp DESC', [level]);
  },

  getErrorsByCategory: (category: string, limit?: number) => {
    if (limit !== undefined) return getAll('SELECT * FROM errors WHERE category = ? ORDER BY timestamp DESC LIMIT ?', [category, limit]);
    return getAll('SELECT * FROM errors WHERE category = ? ORDER BY timestamp DESC', [category]);
  },

  getRecentErrors: (count: number = 50) => getAll('SELECT * FROM errors ORDER BY timestamp DESC LIMIT ?', [count]),
  getUnresolvedErrors: () => getAll('SELECT * FROM errors WHERE resolved = 0 ORDER BY timestamp DESC'),

  resolveError: (id: string): boolean => {
    const result = run('UPDATE errors SET resolved = 1 WHERE id = ?', [id]);
    return result.changes > 0;
  },

  getErrorStats: () => {
    const total = (getOne<{ count: number }>('SELECT COUNT(*) as count FROM errors') as { count: number } | undefined)?.count ?? 0;
    const byLevel = getAll<{ level: string; count: number }>('SELECT level, COUNT(*) as count FROM errors GROUP BY level');
    const byCategory = getAll<{ category: string; count: number }>('SELECT category, COUNT(*) as count FROM errors GROUP BY category');
    const byScript = getAll<{ script: string; count: number }>('SELECT script, COUNT(*) as count FROM errors WHERE script IS NOT NULL GROUP BY script');
    const criticalCount = (getOne<{ count: number }>("SELECT COUNT(*) as count FROM errors WHERE level = 'critical'") as { count: number } | undefined)?.count ?? 0;
    const highCount = (getOne<{ count: number }>("SELECT COUNT(*) as count FROM errors WHERE level = 'high'") as { count: number } | undefined)?.count ?? 0;
    return {
      total,
      byLevel: byLevel.reduce((acc, row) => ({ ...acc, [row.level]: row.count }), {} as Record<string, number>),
      byCategory: byCategory.reduce((acc, row) => ({ ...acc, [row.category]: row.count }), {} as Record<string, number>),
      byScript: byScript.reduce((acc, row) => ({ ...acc, [row.script]: row.count }), {} as Record<string, number>),
      criticalCount, highCount
    };
  },

  getErrorTrend: (hours: number = 24) => {
    const startTime = Date.now() - hours * 60 * 60 * 1000;
    const trend = getAll<{ hourOffset: number; errorCount: number; warnCount: number }>(
      `SELECT CAST((timestamp - ?) / 3600000 AS INTEGER) as hourOffset, SUM(CASE WHEN level IN ('critical', 'high') THEN 1 ELSE 0 END) as errorCount, SUM(CASE WHEN level = 'medium' THEN 1 ELSE 0 END) as warnCount FROM errors WHERE timestamp >= ? GROUP BY hourOffset ORDER BY hourOffset DESC`,
      [startTime, startTime]
    );
    return trend.map(t => ({ hour: Math.abs(t.hourOffset), errorCount: t.errorCount, warnCount: t.warnCount }));
  },

  getFrequentErrors: (limit: number = 10) => getAll<{ message: string; count: number; lastSeen: number; level: 'error' | 'warn' }>(
    `SELECT message, COUNT(*) as count, MAX(timestamp) as lastSeen, CASE WHEN level IN ('critical', 'high') THEN 'error' ELSE 'warn' END as level FROM errors GROUP BY message ORDER BY count DESC LIMIT ?`, [limit]
  ),

  getTodayErrorCount: () => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    return (getOne<{ count: number }>('SELECT COUNT(*) as count FROM errors WHERE timestamp >= ?', [todayStart.getTime()]) as { count: number } | undefined)?.count ?? 0;
  },

  clearErrors: () => { run('DELETE FROM errors'); },
  clearResolvedErrors: () => { run('DELETE FROM errors WHERE resolved = 1'); },

  deleteOldErrorsByLevel: (level: string, maxRecords: number) => {
    const total = (getOne<{ count: number }>('SELECT COUNT(*) as count FROM errors WHERE level = ?', [level]) as { count: number } | undefined)?.count ?? 0;
    if (total <= maxRecords) return;
    const keepRecord = getOne<{ timestamp: number }>('SELECT timestamp FROM errors WHERE level = ? ORDER BY timestamp DESC LIMIT 1 OFFSET ?', [level, maxRecords - 1]);
    if (!keepRecord) return;
    const result = run('DELETE FROM errors WHERE level = ? AND timestamp < ?', [level, keepRecord.timestamp]);
    LogService.info('DB', `Cleaned up ${result.changes} old ${level} records (kept ${maxRecords})`);
  },

  deleteOldErrors: (maxRecords: number = 1000) => {
    const total = (getOne<{ count: number }>('SELECT COUNT(*) as count FROM errors') as { count: number } | undefined)?.count ?? 0;
    if (total <= maxRecords) return;
    const keepRecord = getOne<{ timestamp: number }>('SELECT timestamp FROM errors ORDER BY timestamp DESC LIMIT 1 OFFSET ?', [maxRecords - 1]);
    if (!keepRecord) return;
    const result = run('DELETE FROM errors WHERE timestamp < ?', [keepRecord.timestamp]);
    LogService.info('DB', `已清理 ${result.changes} 条旧的错误记录（保留 ${maxRecords} 条）`);
  },

  deleteOldLogsOnly: (maxRecords: number = 1000) => {
    const totalLogs = (getOne<{ count: number }>("SELECT COUNT(*) as count FROM errors WHERE level IN ('info', 'low')") as { count: number } | undefined)?.count ?? 0;
    if (totalLogs <= maxRecords) return;
    const keepRecord = getOne<{ timestamp: number }>("SELECT timestamp FROM errors WHERE level IN ('info', 'low') ORDER BY timestamp DESC LIMIT 1 OFFSET ?", [maxRecords - 1]);
    if (!keepRecord) return;
    const result = run("DELETE FROM errors WHERE level IN ('info', 'low') AND timestamp < ?", [keepRecord.timestamp]);
    LogService.info('DB', `已清理 ${result.changes} 条旧的日志记录（保留 ${maxRecords} 条）`);
  },

  saveInstruments: (instruments: any[]) => {
    if (!isReady()) return;
    const stmt = db.prepare('INSERT OR REPLACE INTO instruments (instId, instType, baseCcy, quoteCcy, state) VALUES (?, ?, ?, ?, ?)');
    const insertMany = db.transaction((data: any[]) => {
      db.prepare('DELETE FROM instruments').run();
      for (const inst of data) {
        stmt.run(inst.instId, inst.instType, inst.baseCcy, inst.quoteCcy, inst.state);
      }
    });
    insertMany(instruments);
  },

  stopAutoBackup,
  closeDb,

  saveBacktestResult(strategyId: string, data: unknown) {
    return run(
      'INSERT OR REPLACE INTO backtest_results (strategyId, data, updatedAt) VALUES (?, ?, ?)',
      [strategyId, JSON.stringify(data), Date.now()],
    );
  },
  getBacktestResult(strategyId: string): unknown | null {
    const row = getOne<{ data: string }>(
      'SELECT data FROM backtest_results WHERE strategyId = ? ORDER BY updatedAt DESC LIMIT 1',
      [strategyId],
    );
    if (!row) return null;
    try { return JSON.parse(row.data); } catch { return null; }
  },
};
