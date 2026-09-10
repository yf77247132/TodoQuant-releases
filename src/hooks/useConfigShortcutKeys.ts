import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { isFocusEditable } from '../lib/tabShortcuts.ts';
import { parseShortcutKey } from '../ui/ShortcutKeyInput.tsx';
import type { AppConfig } from '../types/core.ts';

interface ShortcutConfirmModal {
  isOpen: boolean;
  moduleId: string;
  configName: string;
  configId: string;
  moduleApiPrefix: string;
  configKey: string;
}

export function useConfigShortcutKeys(
  config: Partial<AppConfig>,
  showToast: (msg: string, type: 'success' | 'error') => void,
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmModal, setConfirmModal] = useState<ShortcutConfirmModal | null>(null);

  const MODULE_DEFS = useMemo(() => [
    { key: 'place_configs', module: 'place', i18nKey: 'nav.place', apiPrefix: '/api/trader' },
    { key: 'cancel_configs', module: 'cancel', i18nKey: 'nav.cancel', apiPrefix: '/api/cancel' },
    { key: 'amend_configs', module: 'amend', i18nKey: 'nav.amend', apiPrefix: '/api/amend' },
    { key: 'close_configs', module: 'close', i18nKey: 'nav.close', apiPrefix: '/api/close' },
    { key: 'margin_configs', module: 'margin', i18nKey: 'nav.margin', apiPrefix: '/api/margin' },
    { key: 'diy_strategies', module: 'diy', i18nKey: 'nav.diy', apiPrefix: '/api/diy/strategies' },
  ], []);

  const shortcutMap = useMemo(() => {
    const map: Record<string, { moduleId: string; configId: string; configName: string; apiPrefix: string; i18nKey: string; configKey: string }> = {};

    for (const mod of MODULE_DEFS) {
      const configs = (config as Record<string, unknown>)[mod.key];
      if (!Array.isArray(configs)) continue;
      for (const cfg of configs) {
        const c = cfg as Record<string, unknown>;
        if (!c.shortcut_key || typeof c.shortcut_key !== 'string') continue;
        const key = (c.shortcut_key as string).toLowerCase();
        if (key) {
          map[key] = {
            moduleId: mod.module,
            configId: String(c.id || ''),
            configName: String(c.name || ''),
            apiPrefix: mod.apiPrefix,
            i18nKey: mod.i18nKey,
            configKey: mod.key,
          };
        }
      }
    }
    return map;
  }, [config, MODULE_DEFS]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isFocusEditable()) return;

      if (confirmModal?.isOpen) return;

      const key = parseShortcutKey(e);
      if (!key) return;

      const match = shortcutMap[key.toLowerCase()];
      if (!match) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      setConfirmModal({
        isOpen: true,
        moduleId: match.moduleId,
        configName: match.configName,
        configId: match.configId,
        moduleApiPrefix: match.apiPrefix,
        configKey: match.configKey,
      });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcutMap, confirmModal?.isOpen]);

  const handleConfirmStart = useCallback(async () => {
    if (!confirmModal) return;
    try {
      const res = await fetch(`${confirmModal.moduleApiPrefix}/start/${confirmModal.configId}`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        const QUERY_MODULE_BY_CONFIG_KEY: Record<string, string> = {
          place_configs: 'place',
          cancel_configs: 'cancel',
          amend_configs: 'amend',
          close_configs: 'close',
          margin_configs: 'margin',
          diy_strategies: 'diy_strategies',
        };
        const moduleName = QUERY_MODULE_BY_CONFIG_KEY[confirmModal.configKey] ?? confirmModal.configKey;
        queryClient.setQueryData<Record<string, unknown>[]>([moduleName, 'configs'], (prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map(c => c.id === confirmModal.configId ? { ...c, running: true } : c);
        });
        queryClient.setQueryData<Record<string, unknown>>(['config'], (prev: Record<string, unknown> | undefined) => {
          if (!prev) return prev;
          const list = prev[confirmModal.configKey] as Record<string, unknown>[] | undefined;
          if (Array.isArray(list)) {
            return {
              ...prev,
              [confirmModal.configKey]: list.map(c => c.id === confirmModal.configId ? { ...c, running: true } : c),
            };
          }
          return prev;
        });
        showToast(t('shortcut.configStarted', { name: confirmModal.configName }), 'success');
      } else {
        showToast(data.error || t('shortcut.startFailed'), 'error');
      }
    } catch {
      showToast(t('shortcut.networkError'), 'error');
    }
    setConfirmModal(null);
  }, [confirmModal, showToast, t, queryClient]);

  const handleCancelConfirm = useCallback(() => {
    setConfirmModal(null);
  }, []);

  return {
    shortcutConfirmModal: confirmModal,
    handleConfirmStart,
    handleCancelConfirm,
  };
}
