import { useState, useEffect, useRef } from 'react';
import { LogEntry } from '../types/logs.ts';
import type { ModuleConfig } from '../types/strategy.ts';

export function useModuleState(
  config: ModuleConfig,
  logs: LogEntry[],
  setRunning: (v: boolean) => void,
  running?: boolean,
  moduleType?: string
) {
  const [localConfig, setLocalConfig] = useState<ModuleConfig>(config);
  const [autoScroll, setAutoScroll] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const isDirty = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isDirty.current) {
      setLocalConfig(config);
    }
  }, [config]);

  useEffect(() => {
    if (statusMsg) {
      const timer = setTimeout(() => setStatusMsg(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [statusMsg]);

  useEffect(() => {
    if (!moduleType) return;

    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/${moduleType}/status`);
        const data = await res.json();
        if (data.running !== running) {
          setRunning(data.running);
        }
      } catch (e) {
      }
    };

    if (running) {
      pollTimerRef.current = setInterval(pollStatus, 30000);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [running, moduleType, setRunning]);

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const updateField = (field: string, value: any) => {
    isDirty.current = true;
    setLocalConfig((prev: ModuleConfig) => ({ ...prev, [field]: value }));
  };

  const resetDirty = () => {
    isDirty.current = false;
  };

  return {
    localConfig,
    setLocalConfig,
    autoScroll,
    setAutoScroll,
    statusMsg,
    setStatusMsg,
    logEndRef,
    updateField,
    resetDirty,
  };
}
