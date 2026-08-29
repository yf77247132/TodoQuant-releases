
import path from 'path';
import { LogService } from '../services/logService.ts';

export const getWritableDataPath = (): string => {
  if (process.env.ELECTRON_USER_DATA_PATH) {
    return process.env.ELECTRON_USER_DATA_PATH;
  }
  
  if (!process.versions?.electron) {
    return process.cwd();
  }
  
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    if (electron?.app) {
      return electron.app.getPath('userData');
    }
  } catch (e: unknown) {
    LogService.addLog('getAppPath', `获取 Electron userData 路径失败，回退到 cwd: ${e instanceof Error ? e.message : String(e)}`, 'debug');
  }
  
  return process.cwd();
};

export const getWritableDbPath = (): string => {
  return path.join(getWritableDataPath(), 'trading.db');
};

export const getBackupDirPath = (): string => {
  return path.join(getWritableDataPath(), 'backups');
};

export const getBackupPath = (): string => {
  return path.join(getBackupDirPath(), 'trading.db.bak');
};

export const getCorruptedDirPath = (): string => {
  return path.join(getBackupDirPath(), 'corrupted');
};
