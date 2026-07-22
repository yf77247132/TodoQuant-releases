
import type { AppConfig } from '../types/core.ts';

export const TAB_IDS = [
  'market', 'positions', 'place', 'amend', 'cancel',
  'close', 'margin', 'diy', 'apikeys', 'settings', 'contact',
] as const;

export const DEFAULT_TAB_SHORTCUTS: Record<string, string> = {
  market: '1',
  positions: '2',
  place: '3',
  amend: '4',
  cancel: '5',
  close: '6',
  margin: '7',
  diy: '8',
  apikeys: '9',
  settings: '0',
  contact: '-',
};

export function getTabShortcuts(config: AppConfig | undefined | null): Record<string, string> {
  const stored = config?.tab_shortcuts;
  if (!stored || typeof stored !== 'object') {
    return { ...DEFAULT_TAB_SHORTCUTS };
  }
  const result: Record<string, string> = {};
  for (const tabId of TAB_IDS) {
    const v = (stored as Record<string, unknown>)[tabId];
    result[tabId] = typeof v === 'string' ? v : DEFAULT_TAB_SHORTCUTS[tabId];
  }
  return result;
}

export function extractShortcutKey(e: KeyboardEvent): string | null {
  if (e.key.length === 1 && e.key !== ' ') {
    return e.key;
  }
  return null;
}

export function isFocusEditable(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}
