import { useEffect, useState } from 'react';

export type TunnelStatus = 'idle' | 'starting' | 'running' | 'error' | 'stopped';

interface TunnelState {
  url: string;
  status: TunnelStatus;
}

let apiBaseUrl: string | null = null;
export const getApiBase = async (): Promise<string> => {
  if (apiBaseUrl !== null) return apiBaseUrl;
  if (window.electronAPI) {
    const port = await window.electronAPI.getBackendPort();
    apiBaseUrl = `http://localhost:${port}`;
  } else {
    apiBaseUrl = '';
  }
  return apiBaseUrl;
};

const POLL_INTERVAL_MS = 3000;

let timer: ReturnType<typeof setInterval> | null = null;
let refCount = 0;
const subscribers = new Set<(s: TunnelState) => void>();
let latestState: TunnelState = { url: '', status: 'idle' };

function notify(): void {
  for (const fn of subscribers) fn(latestState);
}

function stopTimerIfReady(): void {
  if (latestState.url && timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function poll(): Promise<void> {
  try {
    const base = await getApiBase();
    const r = await fetch(`${base}/api/tunnel/status`);
    const data = await r.json();
    latestState = { url: data.url || '', status: data.status };
    notify();
    stopTimerIfReady();
  } catch {
  }
}

function subscribe(fn: (s: TunnelState) => void): () => void {
  subscribers.add(fn);
  fn(latestState);
  refCount++;
  if (!timer && !latestState.url) {
    poll();
    timer = setInterval(poll, POLL_INTERVAL_MS);
  }
  return () => {
    subscribers.delete(fn);
    refCount--;
    if (refCount <= 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function updateTunnelState(patch: Partial<TunnelState>): void {
  latestState = { ...latestState, ...patch };
  notify();
  stopTimerIfReady();
  if (!latestState.url && refCount > 0 && !timer) {
    poll();
    timer = setInterval(poll, POLL_INTERVAL_MS);
  }
}

export function useTunnelStatus(): { url: string; status: TunnelStatus } {
  const [state, setState] = useState<TunnelState>(latestState);
  useEffect(() => subscribe(setState), []);
  return state;
}
