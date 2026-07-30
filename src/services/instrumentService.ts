import { dbService } from './dbService.ts';
import { getWritableDataPath } from '../lib/getAppPath.ts';
import path from 'path';
import fs from 'fs';
import { LogService } from './logService.ts';

export interface Instrument {
  instId: string;
  instType: string;
  baseCcy: string;
  quoteCcy: string;
  state: string;
}

interface OkxInstrumentItem {
  instId: string;
  instType: string;
  baseCcy?: string;
  quoteCcy?: string;
  state?: string;
}

interface OkxInstrumentsResponse {
  code?: string;
  data?: OkxInstrumentItem[];
}

export class InstrumentService {
  private static isFetching = false;
  private static cache: Instrument[] = [];
  private static refreshInterval: NodeJS.Timeout | null = null;

  static async init() {
    this.loadFromDb();
    await this.fetchAndStoreInstruments();
    this.refreshInterval = setInterval(() => this.fetchAndStoreInstruments(), 12 * 60 * 60 * 1000);
  }

  static destroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private static loadFromDb() {
    try {
      let rows: Instrument[] = [];
      const CONFIG_DIR = getWritableDataPath();
      const file = path.join(CONFIG_DIR, 'instruments.json');
      if (fs.existsSync(file)) {
        try {
          rows = JSON.parse(fs.readFileSync(file, 'utf-8')) as Instrument[];
        } catch {
          console.debug('[instrumentService] 交易对缓存文件解析失败，搜索功能可能不完整');
        }
      }
      if (!rows || rows.length === 0) {
        try {
          rows = dbService.getAll<Instrument>('SELECT * FROM instruments');
          if (rows && rows.length > 0) {
            fs.writeFileSync(file, JSON.stringify(rows), 'utf-8');
          }
        } catch {
          LogService.warn('system', '[instrumentService] 交易对数据库加载失败，搜索功能可能不完整');
        }
      }
      if (rows?.length > 0) {
        this.cache = rows;
        LogService.logKey('Instrument', 'instrument.loaded', { count: rows.length });
      }
    } catch (error) {
      LogService.logKey('Instrument', 'instrument.loadFailed', { msg: String(error) }, 'error');
    }
  }

  static async fetchAndStoreInstruments() {
    if (this.isFetching) return;
    this.isFetching = true;

    try {
      const instTypes = ['MARGIN', 'SPOT', 'SWAP'];
      const allInstruments: Instrument[] = [];

      for (const type of instTypes) {
        const url = `https://www.okx.com/api/v5/public/instruments?instType=${type}`;
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) {
          throw new Error(`OKX instruments request failed (${type}): HTTP ${response.status}`);
        }
        const data = (await response.json()) as OkxInstrumentsResponse;

        if (data.code === '0' && data.data) {
          data.data.forEach((item) => {
            allInstruments.push({
              instId: item.instId,
              instType: item.instType,
              baseCcy: item.baseCcy || '',
              quoteCcy: item.quoteCcy || '',
              state: item.state || ''
            });
          });
        }
      }

      if (allInstruments.length > 0) {
        const unique = Array.from(new Map(allInstruments.map(i => [i.instId, i])).values());

        try {
          try {
            const CONFIG_DIR = getWritableDataPath();
            const file = path.join(CONFIG_DIR, 'instruments.json');
            fs.writeFile(file, JSON.stringify(unique), 'utf-8', (err) => {
              if (err) LogService.logKey('Instrument', 'instrument.cacheSaveFailed', { msg: err.message }, 'error');
            });
          } catch {}
          this.cache = unique;
          LogService.logKey('Instrument', 'instrument.fetched', { count: unique.length });
        } catch (e) {
          throw e;
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const isTimeout = errMsg.includes('fetch failed') || errMsg.includes('ECONNREFUSED') || errMsg.includes('ETIMEDOUT');
      if (isTimeout) {
        LogService.logKey('Instrument', 'instrument.fetchFailed.timeout', {}, 'warn');
      } else {
        LogService.logKey('Instrument', 'instrument.fetchFailed', { msg: errMsg }, 'error');
      }
    } finally {
      this.isFetching = false;
    }
  }

  static searchInstruments(query: string, limit: number = 20): Instrument[] {
    if (!query) return [];
    const q = query.toLowerCase();
    return this.cache
      .filter(i => i.instId.toLowerCase().includes(q))
      .sort((a, b) => {
        const aId = a.instId.toLowerCase();
        const bId = b.instId.toLowerCase();
        if (aId === q) return -1;
        if (bId === q) return 1;
        if (aId.startsWith(q) && !bId.startsWith(q)) return -1;
        if (!aId.startsWith(q) && bId.startsWith(q)) return 1;
        return aId.localeCompare(bId);
      })
      .slice(0, limit);
  }
}
