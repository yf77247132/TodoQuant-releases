
const PROBE_KEY = '__todoquant_storage_probe__';

function canUseLocalStorage(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.setItem(PROBE_KEY, '1');
    window.localStorage.removeItem(PROBE_KEY);
    return true;
  } catch (e: unknown) {
    console.debug('[safeStorage] localStorage 不可用:', e instanceof Error ? e.message : String(e));
    return false;
  }
}

const _storageAvailable = canUseLocalStorage();

export function safeStorageGet<T>(key: string, fallback: T): T {
  if (!_storageAvailable) return fallback;
  try {
    const saved = localStorage.getItem(key);
    if (saved === null) return fallback;
    return JSON.parse(saved) as T;
  } catch (e: unknown) {
    console.debug(`[safeStorage] 读取 ${key} 失败:`, e instanceof Error ? e.message : String(e));
    return fallback;
  }
}

export function safeStorageSet<T>(key: string, value: T): boolean {
  if (!_storageAvailable) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e: unknown) {
    console.debug(`[safeStorage] 写入 ${key} 失败:`, e instanceof Error ? e.message : String(e));
    return false;
  }
}

export function safeStorageRemove(key: string): boolean {
  if (!_storageAvailable) return false;
  try {
    localStorage.removeItem(key);
    return true;
  } catch (e: unknown) {
    console.debug(`[safeStorage] 删除 ${key} 失败:`, e instanceof Error ? e.message : String(e));
    return false;
  }
}

export function safeStorageClear(): boolean {
  if (!_storageAvailable) return false;
  try {
    localStorage.clear();
    return true;
  } catch (e: unknown) {
    console.debug('[safeStorage] 清空 localStorage 失败:', e instanceof Error ? e.message : String(e));
    return false;
  }
}

export const storageAvailable = _storageAvailable;
