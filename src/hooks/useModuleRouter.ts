
import { useState, useEffect, useCallback } from 'react';
import { safeStorageGet, safeStorageSet } from '../lib/safeStorage.ts';
import { getTabShortcuts, extractShortcutKey, isFocusEditable } from '../lib/tabShortcuts.ts';
import type { AppConfig } from '../types/core.ts';

export const VALID_MODULE_IDS = new Set([
  'market', 'monitor', 'positions', 'place', 'amend', 'cancel',
  'close', 'margin', 'diy', 'apikeys', 'settings', 'contact',
]);

const STORAGE_KEY = 'active-module';
const DEFAULT_MODULE = 'market';

export function useModuleRouter(config: Partial<AppConfig>) {
  const [activeModule, setActiveModule] = useState<string>(() => {
    const saved = safeStorageGet<string>(STORAGE_KEY, DEFAULT_MODULE);
    return VALID_MODULE_IDS.has(saved) ? saved : DEFAULT_MODULE;
  });

  const handleSetActiveModule = useCallback((moduleId: string) => {
    if (!VALID_MODULE_IDS.has(moduleId)) return;
    setActiveModule(moduleId);
    safeStorageSet(STORAGE_KEY, moduleId);
  }, []);

  const handleNavigateToModule = useCallback((moduleKey: string, _configId?: string, action?: 'edit' | 'new') => {
    if (!VALID_MODULE_IDS.has(moduleKey)) return;
    setActiveModule(moduleKey);
    safeStorageSet(STORAGE_KEY, moduleKey);
    if (action) {
      window.dispatchEvent(new CustomEvent('open-config-modal', {
        detail: { action, configId: _configId, moduleKey },
      }));
    }
  }, []);

  useEffect(() => {
    const shortcuts = getTabShortcuts(config as AppConfig | undefined | null);

    const onKeyDown = (e: KeyboardEvent) => {
      if (isFocusEditable()) return;

      const key = extractShortcutKey(e);
      if (!key) return;

      const matchedId = Object.entries(shortcuts).find(([, v]) => v === key)?.[0];
      if (!matchedId || !VALID_MODULE_IDS.has(matchedId)) return;

      e.preventDefault();
      setActiveModule(matchedId);
      safeStorageSet(STORAGE_KEY, matchedId);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [config]);

  return { activeModule, setActiveModule, handleSetActiveModule, handleNavigateToModule };
}
