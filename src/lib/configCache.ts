import type { PartialAppConfig } from '../types/index.ts';
import { safeStorageGet, safeStorageSet, safeStorageRemove, storageAvailable } from './safeStorage.ts';

const CONFIG_CACHE_KEY = 'todoquant_config_cache';

function clearConfigCache(): void {
  safeStorageRemove(CONFIG_CACHE_KEY);
}

export const configCache = {
  get: () => {
    if (!storageAvailable) return null;
    const cached = safeStorageGet<PartialAppConfig | null>(CONFIG_CACHE_KEY, null);
    return cached;
  },
  set: (cfg: PartialAppConfig): boolean => {
    if (!storageAvailable) return false;
    const existing = configCache.get() || {};
    const merged = { ...existing, ...cfg };
    return safeStorageSet(CONFIG_CACHE_KEY, merged);
  }
};
