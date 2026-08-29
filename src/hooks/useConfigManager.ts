import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import i18next from 'i18next';
import { safeStorageGet, safeStorageSet } from '../lib/safeStorage.ts';

const i18n = (key: string, params?: Record<string, string | number | boolean>) => i18next.t(key, params) || key;

export interface BaseConfigItem {
  id: string;
  running?: boolean;
}

interface UseConfigManagerOptions<T extends BaseConfigItem> {
  moduleName: string;
  apiPrefix: string;
  pollInterval?: number;
  toRequestBody: (formData: Partial<T>, editingId: string | null) => Record<string, string | number | boolean | null>;
  onShowToast?: (message: string, type: 'success' | 'error') => void;
  onStartSuccess?: (configId: string) => void;
}

interface UseConfigManagerReturn<T extends BaseConfigItem> {
  configs: T[];
  isLoading: boolean;

  runningMap: Record<string, boolean>;
  hasAnyRunning: boolean;

  selectedConfigId: string | null;
  setSelectedConfigId: (id: string | null) => void;

  getFilteredLogs: <L extends { configId?: string }>(allLogs: L[]) => L[];

  toast: { message: string; type: 'success' | 'error' } | null;

  fetchConfigs: () => Promise<void>;
  handleSave: (formData: Partial<T>, editingId: string | null) => Promise<{ id?: string }>;
  handleDelete: (id: string) => Promise<void>;
  handlePin: (id: string) => Promise<void>;
  handleDuplicate: (id: string) => Promise<void>;

  handleStart: (configId: string) => Promise<boolean>;
  handleStop: (configId: string) => Promise<boolean>;

  batchMode: boolean;
  setBatchMode: (mode: boolean) => void;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  handleBatchStart: () => Promise<void>;
  handleBatchStop: () => Promise<void>;

  showToast: (message: string, type: 'success' | 'error') => void;
}

const configPollRegistry = new Map<string, {
  timer: ReturnType<typeof setInterval>;
  intervalMs: number;
  refCount: number;
}>();

function acquireConfigPoll(moduleName: string, intervalMs: number, onTick: () => void): () => void {
  const existing = configPollRegistry.get(moduleName);
  if (existing) {
    existing.refCount++;
    if (intervalMs < existing.intervalMs) {
      clearInterval(existing.timer);
      existing.timer = setInterval(onTick, intervalMs);
      existing.intervalMs = intervalMs;
    }
  } else {
    const timer = setInterval(onTick, intervalMs);
    configPollRegistry.set(moduleName, { timer, intervalMs, refCount: 1 });
  }

  return () => {
    const entry = configPollRegistry.get(moduleName);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0) {
      clearInterval(entry.timer);
      configPollRegistry.delete(moduleName);
    }
  };
}

export function useConfigManager<T extends BaseConfigItem>(
  options: UseConfigManagerOptions<T>
): UseConfigManagerReturn<T> {
  const { moduleName, apiPrefix, pollInterval = 10000, toRequestBody, onShowToast, onStartSuccess } = options;
  const queryClient = useQueryClient();

  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [localToast, setLocalToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    if (onShowToast) {
      onShowToast(message, type);
    } else {
      setLocalToast({ message, type });
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = setTimeout(() => setLocalToast(null), 3000);
    }
  }, [onShowToast]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const { data: configs = [], isLoading, refetch } = useQuery<T[]>({
    queryKey: [moduleName, 'configs'],
    queryFn: async () => {
      const res = await fetch(`${apiPrefix}/configs`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      return data.data;
    },
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const runningMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    configs.forEach((cfg) => {
      map[cfg.id] = cfg.running || false;
    });
    return map;
  }, [configs]);

  const hasAnyRunning = useMemo(() => Object.values(runningMap).some(Boolean), [runningMap]);

  useEffect(() => {
    if (!hasAnyRunning) return;
    const intervalMs = Math.max(pollInterval, 2000);
    return acquireConfigPoll(moduleName, intervalMs, () => {
      queryClient.invalidateQueries({ queryKey: [moduleName, 'configs'] });
    });
  }, [hasAnyRunning, moduleName, queryClient, pollInterval]);

  const getFilteredLogs = useCallback(<L extends { configId?: string }>(allLogs: L[]): L[] => {
    if (!selectedConfigId) return allLogs;
    return allLogs.filter((l: L) => l.configId === selectedConfigId);
  }, [selectedConfigId]);

  const handleSave = useCallback(async (formData: Partial<T>, editingId: string | null): Promise<{ id?: string }> => {
    if (saving) return { id: undefined };
    setSaving(true);

    const body = toRequestBody(formData, editingId);
    const previousConfigs = queryClient.getQueryData<T[]>([moduleName, 'configs']);

    if (editingId && previousConfigs) {
      queryClient.setQueryData<T[]>([moduleName, 'configs'],
        previousConfigs.map(c => c.id === editingId ? { ...c, ...formData } as T : c)
      );
    }

    try {
      const res = await fetch(editingId ? `${apiPrefix}/configs/${editingId}` : `${apiPrefix}/configs`, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      const newId = data.data?.id;

      queryClient.invalidateQueries({ queryKey: [moduleName, 'configs'] });
      queryClient.invalidateQueries({ queryKey: ['config'] });
      showToast(editingId ? i18n('common.configUpdated') : i18n('common.configCreated'), 'success');
      return { id: newId || editingId || undefined };
    } catch (e) {
      if (editingId && previousConfigs) {
        queryClient.setQueryData([moduleName, 'configs'], previousConfigs);
      }
      throw e;
    } finally {
      setSaving(false);
    }
  }, [apiPrefix, toRequestBody, queryClient, moduleName, showToast, saving]);

  const handleDelete = useCallback(async (id: string) => {
    const previousConfigs = queryClient.getQueryData<T[]>([moduleName, 'configs']);
    if (previousConfigs) {
      queryClient.setQueryData<T[]>([moduleName, 'configs'], previousConfigs.filter(c => c.id !== id));
    }
    if (selectedConfigId === id) setSelectedConfigId(null);
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });

    try {
      const res = await fetch(`${apiPrefix}/configs/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      await queryClient.invalidateQueries({ queryKey: [moduleName, 'configs'] });
      await queryClient.invalidateQueries({ queryKey: ['config'] });
    } catch (e) {
      if (previousConfigs) {
        queryClient.setQueryData([moduleName, 'configs'], previousConfigs);
      }
      showToast(i18n('config.deleteFailed'), 'error');
    }
  }, [apiPrefix, selectedConfigId, queryClient, moduleName, showToast]);

  const handlePin = useCallback(async (id: string) => {
    const previousConfigs = queryClient.getQueryData<T[]>([moduleName, 'configs']);
    if (!previousConfigs) return;

    const idx = previousConfigs.findIndex(c => c.id === id);
    if (idx === -1) return;
    const [config] = previousConfigs.splice(idx, 1);
    const newConfigs = [config, ...previousConfigs] as T[];
    queryClient.setQueryData<T[]>([moduleName, 'configs'], newConfigs);

    try {
      const res = await fetch(`${apiPrefix}/configs/${id}/pin`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
    } catch (e) {
      queryClient.setQueryData<T[]>([moduleName, 'configs'], previousConfigs);
      showToast(i18n('common.error'), 'error');
    }
  }, [apiPrefix, queryClient, moduleName, showToast]);

  const handleDuplicate = useCallback(async (id: string) => {
    const previousConfigs = queryClient.getQueryData<T[]>([moduleName, 'configs']);
    if (!previousConfigs) return;

    try {
      const res = await fetch(`${apiPrefix}/configs/${id}/duplicate`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      const newConfig = data.data as T;
      const sourceIdx = previousConfigs.findIndex(c => c.id === id);
      if (sourceIdx !== -1) {
        const newConfigs = [...previousConfigs];
        newConfigs.splice(sourceIdx + 1, 0, newConfig);
        queryClient.setQueryData<T[]>([moduleName, 'configs'], newConfigs);
      } else {
        queryClient.invalidateQueries({ queryKey: [moduleName, 'configs'] });
      }
      queryClient.invalidateQueries({ queryKey: ['config'] });
      showToast(i18n('common.configDuplicated'), 'success');
    } catch (e) {
      if (previousConfigs) {
        queryClient.setQueryData([moduleName, 'configs'], previousConfigs);
      }
      showToast(i18n('common.error'), 'error');
    }
  }, [apiPrefix, queryClient, moduleName, showToast]);

  const handleStart = useCallback(async (configId: string): Promise<boolean> => {
    const previousConfigs = queryClient.getQueryData<T[]>([moduleName, 'configs']);
    if (previousConfigs) {
      queryClient.setQueryData<T[]>(
        [moduleName, 'configs'],
        previousConfigs.map(c => {
          if (c.id === configId) {
            if (c.running === true) return c;
            return { ...c, running: true } as T;
          }
          return c;
        })
      );
    }
    try {
      const res = await fetch(`${apiPrefix}/start/${configId}`, { method: 'POST' });
      const data = await res.json();

      if (!data.ok) {
        if (previousConfigs) queryClient.setQueryData([moduleName, 'configs'], previousConfigs);
        showToast(data.error || i18n('config.startFailed'), 'error');
        return false;
      } else {
        queryClient.setQueryData<Record<string, unknown>>(['config'], (prev: Record<string, unknown> | undefined) => {
          if (!prev) return prev;
          const configListName = `${moduleName}_configs`;
          const list = prev[configListName] as T[] | undefined;
          if (Array.isArray(list)) {
            return {
              ...prev,
              [configListName]: list.map((c: T) => c.id === configId ? { ...c, running: true } : c)
            };
          }
          return prev;
        });
        onStartSuccess?.(configId);
        return true;
      }
    } catch {
      if (previousConfigs) queryClient.setQueryData([moduleName, 'configs'], previousConfigs);
      showToast(i18n('config.networkError'), 'error');
      return false;
    }
  }, [apiPrefix, queryClient, moduleName, showToast, onStartSuccess]);

  const handleStop = useCallback(async (configId: string): Promise<boolean> => {
    const previousConfigs = queryClient.getQueryData<T[]>([moduleName, 'configs']);
    if (previousConfigs) {
      queryClient.setQueryData<T[]>(
        [moduleName, 'configs'],
        previousConfigs.map(c => {
          if (c.id === configId) {
            if (c.running === false) return c;
            return { ...c, running: false } as T;
          }
          return c;
        })
      );
    }
    try {
      const res = await fetch(`${apiPrefix}/stop/${configId}`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) {
        if (previousConfigs) queryClient.setQueryData([moduleName, 'configs'], previousConfigs);
        showToast(data.error || i18n('config.stopFailed'), 'error');
        return false;
      } else {
        queryClient.setQueryData<Record<string, unknown>>(['config'], (prev: Record<string, unknown> | undefined) => {
          if (!prev) return prev;
          const configListName = `${moduleName}_configs`;
          const list = prev[configListName] as T[] | undefined;
          if (Array.isArray(list)) {
            return {
              ...prev,
              [configListName]: list.map((c: T) => c.id === configId ? { ...c, running: false } : c)
            };
          }
          return prev;
        });
        return true;
      }
    } catch {
      if (previousConfigs) queryClient.setQueryData([moduleName, 'configs'], previousConfigs);
      showToast(i18n('config.networkError'), 'error');
      return false;
    }
  }, [apiPrefix, queryClient, moduleName, showToast]);

  const storageKey = `batch_select_${moduleName}`;

  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => {
      try {
        return new Set(safeStorageGet<string[]>(storageKey, []));
      } catch {
        return new Set<string>();
      }
    }
  );

  useEffect(() => {
    safeStorageSet(storageKey, [...selectedIds]);
  }, [selectedIds, storageKey]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(configs.map(c => c.id)));
  }, [configs]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBatchStart = useCallback(async () => {
    const toStart = [...selectedIds].filter(id => !runningMap[id]);
    if (toStart.length === 0) {
      showToast(i18n('batch.allRunning'), 'success');
      return;
    }
    const skipped = selectedIds.size - toStart.length;
    const results = await Promise.allSettled(
      toStart.map(id => handleStart(id))
    );
    let succeeded = 0;
    let failed = 0;
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value === true) succeeded++;
      else failed++;
    });
    if (failed > 0) {
      showToast(i18n('batch.partialStart', { succeeded, failed }), 'error');
    } else if (skipped > 0) {
      showToast(i18n('batch.startedWithSkip', { count: succeeded, skipped }), 'success');
    } else {
      showToast(i18n('batch.started', { count: succeeded }), 'success');
    }
  }, [selectedIds, runningMap, handleStart, showToast]);

  const handleBatchStop = useCallback(async () => {
    const toStop = [...selectedIds].filter(id => runningMap[id]);
    if (toStop.length === 0) {
      showToast(i18n('batch.allStopped'), 'success');
      return;
    }
    const skipped = selectedIds.size - toStop.length;
    const results = await Promise.allSettled(
      toStop.map(id => handleStop(id))
    );
    let succeeded = 0;
    let failed = 0;
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value === true) succeeded++;
      else failed++;
    });
    if (failed > 0) {
      showToast(i18n('batch.partialStop', { succeeded, failed }), 'error');
    } else if (skipped > 0) {
      showToast(i18n('batch.stoppedWithSkip', { count: succeeded, skipped }), 'success');
    } else {
      showToast(i18n('batch.stopped', { count: succeeded }), 'success');
    }
  }, [selectedIds, runningMap, handleStop, showToast]);

  return {
    configs,
    isLoading,
    runningMap,
    hasAnyRunning,
    selectedConfigId,
    setSelectedConfigId,
    getFilteredLogs,
    toast: localToast,
    fetchConfigs: async () => { await refetch(); },
    handleSave,
    handleDelete,
    handlePin,
    handleDuplicate,
    handleStart,
    handleStop,
    batchMode,
    setBatchMode,
    selectedIds,
    toggleSelect,
    selectAll,
    deselectAll,
    handleBatchStart,
    handleBatchStop,
    showToast,
  };
}
