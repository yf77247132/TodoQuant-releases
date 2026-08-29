import { useState, useCallback } from 'react';
import type { TFunction } from 'i18next';

export function useShortcutKeyConflict(t: TFunction) {
  const [conflictMsg, setConflictMsg] = useState('');

  const checkConflict = useCallback(async (shortcutKey: string, excludeConfigId?: string, excludeTabId?: string): Promise<string> => {
    if (!shortcutKey) {
      setConflictMsg('');
      return '';
    }
    try {
      const params = new URLSearchParams({ shortcut_key: shortcutKey });
      if (excludeConfigId) params.set('exclude_config_id', excludeConfigId);
      if (excludeTabId) params.set('exclude_tab_id', excludeTabId);
      const res = await fetch(`/api/config/shortcut-conflicts?${params}`);
      const data = await res.json();
      if (data.ok && data.conflicts.length > 0) {
        const labels = data.conflicts.map((c: { type: string; label?: string; module?: string; configName?: string }) => {
          if (c.type === 'tab') {
            return c.label ? t(c.label) : 'TAB';
          }
          const moduleLabel = c.module ? t(c.module) : '';
          return moduleLabel && c.configName ? `${moduleLabel}:${c.configName}` : moduleLabel || c.configName || t('common.unknown');
        });
        const locale = t.language || 'zh-CN';
        const separator = locale.startsWith('zh') ? '、' : ', ';
        const msg = t('common.shortcutKeyConflictWith', { labels: labels.join(separator) });
        setConflictMsg(msg);
        return msg;
      } else {
        setConflictMsg('');
        return '';
      }
    } catch {
      return '';
    }
  }, [t]);

  const clearConflict = useCallback(() => setConflictMsg(''), []);

  return { conflictMsg, checkConflict, clearConflict };
}
