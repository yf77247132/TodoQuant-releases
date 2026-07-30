import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { configCache } from '../lib/configCache.ts';
import { safeJsonParse } from '../lib/safeJsonParse.ts';
import { queryClient } from '../lib/queryClient.ts';
import { LogEntry } from '../types/logs.ts';
import {
  AccountsResponse,
  EnvStatusResponse,
  ModuleStatusResponse,
  AccountInfo,
  ConfigResponse,
  SnapshotResponse,
  OrdersResponse
} from '../types/api.ts';
import type { AppConfig } from '../types/core.ts';

import {
  Position,
  Account,
  Order
} from '../types/trading.ts';

import {
  LOG_WINDOW_SIZE,
  PENDING_MSG_MAX,
  SCRIPT_TO_LOG_KEY,
  ACTIVE_ORDER_STATES,
  shallowEqualRecord,
  hasPatchChanges,
  isDuplicateLogEntry,
  mergeLogEntries,
  buildPositionKey,
  buildOrderKey,
  isEmptyPosition
} from './useTradingDataUtils.ts';

let apiBaseUrl: string | null = null;

const getApiBaseUrl = async (): Promise<string> => {
  if (apiBaseUrl !== null) return apiBaseUrl;
  if (window.electronAPI) {
    const port = await window.electronAPI.getBackendPort();
    apiBaseUrl = `http://localhost:${port}`;
  } else {
    apiBaseUrl = '';
  }
  return apiBaseUrl;
};

const safeFetch = async <T = unknown>(
  url: string,
  options?: RequestInit,
  retries = 3,
  initialDelayMs = 200
): Promise<T | null> => {
  let attempt = 0;
  while (attempt < retries) {
    try {
      const baseUrl = await getApiBaseUrl();
      const fullUrl = `${baseUrl}${url}`;
      const r = await fetch(fullUrl, options);
      if (!r.ok) {
        const text = await r.text();
        console.warn(`获取 ${fullUrl} 失败，状态码 ${r.status}: ${text.substring(0, 100)}`);
        
        const isIdempotent = !options || !options.method || options.method === 'GET' || options.method === 'HEAD';
        if (r.status >= 500 && isIdempotent && attempt < retries - 1) {
          attempt++;
          const delay = initialDelayMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        return null;
      }
      return await r.json() as T;
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      attempt++;
      
      const isIdempotent = !options || !options.method || options.method === 'GET' || options.method === 'HEAD';
      if (attempt < retries && isIdempotent) {
        const delay = initialDelayMs * Math.pow(2, attempt - 1);
        console.warn(`Fetch ${url} 出现瞬态错误（尝试 ${attempt}/${retries}，将在 ${delay}ms 后重试）: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error(`Fetch ${url} error (最终失败):`, err);
        return null;
      }
    }
  }
  return null;
};

export function useTradingData() {
  const stateRef = useRef({
    positions: {} as Record<string, Position>,
    accounts: {} as Record<string, Account>,
    orders: {} as Record<string, Order>,
    logs: [] as LogEntry[],
    traderLogs: [] as LogEntry[],
    amendLogs: [] as LogEntry[],
    marginLogs: [] as LogEntry[],
    diyLogs: [] as LogEntry[],
    cancelLogs: [] as LogEntry[],
    closeLogs: [] as LogEntry[],
    wsStatus: {} as Record<number, { connected: boolean, lastSeen?: number, status?: string }>,
    serverTimezone: 'UTC',
    snapshotLoaded: false,
    pendingMessages: [] as Record<string, unknown>[]
  });

  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [accounts, setAccounts] = useState<Record<string, Account>>({});
  const [orders, setOrders] = useState<Record<string, Order>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [traderLogs, setTraderLogs] = useState<LogEntry[]>([]);
  const [amendLogs, setAmendLogs] = useState<LogEntry[]>([]);
  const [marginLogs, setMarginLogs] = useState<LogEntry[]>([]);
  const [diyLogs, setDiyLogs] = useState<LogEntry[]>([]);
  const [cancelLogs, setCancelLogs] = useState<LogEntry[]>([]);
  const [closeLogs, setCloseLogs] = useState<LogEntry[]>([]);
  const [wsStatus, setWsStatus] = useState<Record<number, { connected: boolean, lastSeen?: number, status?: string }>>({});
  const [serverTimezone, setServerTimezone] = useState<string>('UTC');

  const [accountIdNames, setAccountIdNames] = useState<Record<string, string>>({});
  const [accountIdColors, setAccountIdColors] = useState<Record<string, string>>({});
  const [accountIdExchanges, setAccountIdExchanges] = useState<Record<string, string>>({});

  const [fundingRates, setFundingRates] = useState<Record<string, { rate: string; displayText: string }>>({});

  const updateScheduled = useRef(false);

  const orderSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orderSyncPending = useRef(false);

  const [envStatus, setEnvStatus] = useState<Record<string, boolean>>({});
  const [moduleStatus, setModuleStatus] = useState<Record<string, boolean>>({
    trader: false,
    amend: false,
    margin: false,
    diy: false,
    cancel: false
  });

  const changedKeys = useRef<Set<string>>(new Set());

  const lastOrdersRender = useRef(0);
  const ordersThrottled = useRef(false);
  const scheduleUpdate = (key: string) => {
    changedKeys.current.add(key);
    if (updateScheduled.current) return;
    updateScheduled.current = true;
    requestAnimationFrame(() => {
      const now = Date.now();
      if (changedKeys.current.has('orders') && now - lastOrdersRender.current < 200) {
        changedKeys.current.delete('orders');
        ordersThrottled.current = true;
      }
      if (changedKeys.current.has('positions')) setPositions({ ...stateRef.current.positions });
      if (changedKeys.current.has('accounts')) setAccounts({ ...stateRef.current.accounts });
      if (changedKeys.current.has('orders')) {
        setOrders({ ...stateRef.current.orders });
        lastOrdersRender.current = now;
        ordersThrottled.current = false;
      }
      if (changedKeys.current.has('logs')) setLogs([...stateRef.current.logs]);
      if (changedKeys.current.has('traderLogs')) setTraderLogs([...stateRef.current.traderLogs]);
      if (changedKeys.current.has('amendLogs')) setAmendLogs([...stateRef.current.amendLogs]);
      if (changedKeys.current.has('marginLogs')) setMarginLogs([...stateRef.current.marginLogs]);
      if (changedKeys.current.has('diyLogs')) setDiyLogs([...stateRef.current.diyLogs]);
      if (changedKeys.current.has('cancelLogs')) setCancelLogs([...stateRef.current.cancelLogs]);
      if (changedKeys.current.has('closeLogs')) setCloseLogs([...stateRef.current.closeLogs]);
      if (changedKeys.current.has('wsStatus')) setWsStatus({ ...stateRef.current.wsStatus });
      if (changedKeys.current.has('serverTimezone')) setServerTimezone(stateRef.current.serverTimezone);
      changedKeys.current.clear();
      updateScheduled.current = false;

      if (ordersThrottled.current) {
        const delay = 200 - (Date.now() - lastOrdersRender.current);
        setTimeout(() => {
          if (ordersThrottled.current) {
            setOrders({ ...stateRef.current.orders });
            lastOrdersRender.current = Date.now();
            ordersThrottled.current = false;
          }
        }, Math.max(delay, 50));
      }
    });
  };

  const pendingSavingsUsdt = useRef<Record<number, string>>({});
  const pendingSavingsUsdc = useRef<Record<number, string>>({});
  const pendingValuation = useRef<Record<number, Account['valuation']>>({});

  const [config, setConfig] = useState<Partial<AppConfig>>(configCache.get() || {
    triggerId: "PriceGapTrigger",
    actionId: "PlaceOrderAction",
    check_interval: "5",
    inst_id: "BTC-USDT-SWAP",
    accountNames: {}
  });

  const configRef = useRef<Partial<AppConfig>>(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const updateConfig = useCallback(async (newConfig: Partial<AppConfig> | ((prev: Partial<AppConfig>) => Partial<AppConfig>)) => {
    const currentConfig = configRef.current;
    const updates = typeof newConfig === 'function' ? (newConfig as (prev: Partial<AppConfig>) => Partial<AppConfig>)(currentConfig) : newConfig;

    const updatedFullConfig = { ...currentConfig, ...updates };
    setConfig(updatedFullConfig);
    configCache.set(updatedFullConfig);

    try {
      const res = await safeFetch<ConfigResponse>('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (!res || res.error || res.ok === false) {
        console.error('同步配置到服务器失败:', res?.error || '未知错误');
        return false;
      }

      return true;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('同步配置到服务器失败:', error);
      return false;
    }
  }, [configRef]);

  const { data: configRes } = useQuery({
    queryKey: ['config'],
    queryFn: () => safeFetch<ConfigResponse>('/api/config'),
    staleTime: 5000,
    refetchInterval: 90000,
    refetchOnWindowFocus: true,
  });

  const { data: accountsRes } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => safeFetch<AccountsResponse>('/api/accounts'),
    staleTime: 5000,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });

  const fundingInstIds = [...new Set(Object.values(stateRef.current.positions).map(p => p.instId).filter(Boolean))];

  const { data: fundingRatesRes } = useQuery({
    queryKey: ['funding-rates'],
    queryFn: async () => {
      const ids = [...new Set(Object.values(stateRef.current.positions).map(p => p.instId).filter(Boolean))];
      if (ids.length === 0) return { ok: true, data: {} };
      const params = ids.map(id => `instIds=${encodeURIComponent(id)}`).join('&');
      return safeFetch<{ ok: boolean; data: Record<string, { rate: string; displayText: string }> }>(`/api/funding-rates?${params}`);
    },
    staleTime: 5000,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
    enabled: fundingInstIds.length > 0,
  });

  const { data: tickerData } = useQuery({
    queryKey: ['market', 'tickers', 'all'],
    queryFn: async () => {
      const res = await fetch('/api/market/tickers/all?exchange=okx');
      if (!res.ok) return { ok: false, data: {} as Record<string, { change24h: number; changeToday: number }> };
      return res.json() as Promise<{ ok: boolean; data: Record<string, { change24h: number; changeToday: number }> }>;
    },
    staleTime: 5000,
    refetchInterval: 10000,
    placeholderData: (prev: any) => prev,
  });
  const changeTodayMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (tickerData?.data) {
      for (const [instId, t] of Object.entries(tickerData.data)) {
        if (t.changeToday !== undefined) map[instId] = String(t.changeToday);
      }
    }
    return map;
  }, [tickerData]);

  const { data: logsRes } = useQuery({
    queryKey: ['logs'],
    queryFn: () => safeFetch<LogEntry[]>('/api/logs'),
    staleTime: 5000,
    refetchInterval: 120000,
  });

  const { data: envRes } = useQuery({
    queryKey: ['env-status'],
    queryFn: () => safeFetch<EnvStatusResponse>('/api/env-status'),
    staleTime: 5000,
    refetchOnWindowFocus: true,
  });

  const { data: traderStatus } = useQuery({
    queryKey: ['trader-status'],
    queryFn: () => safeFetch<ModuleStatusResponse>('/api/trader/status'),
    staleTime: 5000,
    refetchInterval: 120000,
    refetchOnWindowFocus: true,
  });

  const { data: amendStatus } = useQuery({
    queryKey: ['amend-status'],
    queryFn: () => safeFetch<ModuleStatusResponse>('/api/amend/status'),
    staleTime: 5000,
    refetchInterval: 120000,
    refetchOnWindowFocus: true,
  });

  const { data: marginStatus } = useQuery({
    queryKey: ['margin-status'],
    queryFn: () => safeFetch<ModuleStatusResponse>('/api/margin/status'),
    staleTime: 5000,
    refetchInterval: 120000,
    refetchOnWindowFocus: true,
  });

  const { data: cancelStatus } = useQuery({
    queryKey: ['cancel-status'],
    queryFn: () => safeFetch<ModuleStatusResponse>('/api/cancel/status'),
    staleTime: 5000,
    refetchInterval: 120000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (configRes && !configRes.error) {
      setConfig(prev => {
        const updates = configRes as Partial<AppConfig>;
        if (!hasPatchChanges(prev, updates)) return prev;

        if (updates.timezone) {
          stateRef.current.serverTimezone = updates.timezone;
          setServerTimezone(updates.timezone);
        }

        const safeUpdates = { ...updates };
        delete safeUpdates.accountNames;
        delete safeUpdates.accountColors;
        delete safeUpdates.accountExchanges;

        return { ...prev, ...safeUpdates };
      });
    }
  }, [configRes]);

  useEffect(() => {
    if (accountsRes && accountsRes.ok && Array.isArray(accountsRes.data)) {
      const names: Record<number, string> = {};
      const exchanges: Record<number, string> = {};
      const colors: Record<number, string> = {};

      accountsRes.data.forEach((acc: AccountInfo, index: number) => {
        names[index] = acc.name;
        exchanges[index] = acc.exchange;
        colors[index] = acc.color;
        if (acc.id) {
          (names as Record<string, string>)[acc.id] = acc.name;
          (exchanges as Record<string, string>)[acc.id] = acc.exchange;
          (colors as Record<string, string>)[acc.id] = acc.color;
        }
      });

      setConfig(prev => {
        const namesChanged = !shallowEqualRecord(
          prev.accountNames as Record<string, string> | undefined,
          names as unknown as Record<string, string>
        );
        const exchangesChanged = !shallowEqualRecord(
          prev.accountExchanges as Record<string, string> | undefined,
          exchanges as unknown as Record<string, string>
        );
        const colorsChanged = !shallowEqualRecord(
          prev.accountColors as Record<string, string> | undefined,
          colors as unknown as Record<string, string>
        );

        if (!namesChanged && !exchangesChanged && !colorsChanged) return prev;

        return {
          ...prev,
          accountNames: names,
          accountExchanges: exchanges,
          accountColors: colors
        };
      });

      const idNames: Record<string, string> = {};
      const idColors: Record<string, string> = {};
      const idExchanges: Record<string, string> = {};
      accountsRes.data.forEach((acc: AccountInfo) => {
        if (acc.id) {
          idNames[acc.id] = acc.name;
          idColors[acc.id] = acc.color;
          idExchanges[acc.id] = acc.exchange;
        }
      });
      setAccountIdNames(idNames);
      setAccountIdColors(idColors);
      setAccountIdExchanges(idExchanges);
    }
  }, [accountsRes]);

  useEffect(() => {
    if (!logsRes) return;

    const mergedAll = mergeLogEntries(stateRef.current.logs, logsRes);
    stateRef.current.logs = mergedAll;
    setLogs(mergedAll);

    const restTraderLogs = logsRes.filter(l => l && l.script === 'trader');
    const mergedTrader = mergeLogEntries(stateRef.current.traderLogs, restTraderLogs);
    stateRef.current.traderLogs = mergedTrader;
    setTraderLogs(mergedTrader);

    const restAmendLogs = logsRes.filter(l => l && l.script === 'amend');
    const mergedAmend = mergeLogEntries(stateRef.current.amendLogs, restAmendLogs);
    stateRef.current.amendLogs = mergedAmend;
    setAmendLogs(mergedAmend);

    const restMarginLogs = logsRes.filter(l => l && l.script === 'margin');
    const mergedMargin = mergeLogEntries(stateRef.current.marginLogs, restMarginLogs);
    stateRef.current.marginLogs = mergedMargin;
    setMarginLogs(mergedMargin);

    const restDiyLogs = logsRes.filter(l => l && l.script === 'diy');
    const mergedDiy = mergeLogEntries(stateRef.current.diyLogs, restDiyLogs);
    stateRef.current.diyLogs = mergedDiy;
    setDiyLogs(mergedDiy);

    const restCancelLogs = logsRes.filter(l => l && l.script === 'cancel');
    const mergedCancel = mergeLogEntries(stateRef.current.cancelLogs, restCancelLogs);
    stateRef.current.cancelLogs = mergedCancel;
    setCancelLogs(mergedCancel);

    const restCloseLogs = logsRes.filter(l => l && l.script === 'close');
    const mergedClose = mergeLogEntries(stateRef.current.closeLogs, restCloseLogs);
    stateRef.current.closeLogs = mergedClose;
    setCloseLogs(mergedClose);
  }, [logsRes]);

  useEffect(() => {
    if (fundingRatesRes?.ok && fundingRatesRes.data) {
      setFundingRates(prev => {
        const incoming = fundingRatesRes.data as Record<string, { rate: string; displayText: string }>;
        const next = { ...prev };
        let hasChanges = false;
        for (const [instId, data] of Object.entries(incoming)) {
          if (!next[instId] || next[instId].rate !== data.rate) {
            next[instId] = data;
            hasChanges = true;
          }
        }
        return hasChanges ? next : prev;
      });
    }
  }, [fundingRatesRes]);

  useEffect(() => {
    if (envRes && envRes.keys) {
      setEnvStatus(envRes.keys);
    }
  }, [envRes]);

  useEffect(() => {
    const newStatus = {
      trader: !!(traderStatus && traderStatus.running),
      amend: !!(amendStatus && amendStatus.running),
      cancel: !!(cancelStatus && cancelStatus.running),
      margin: !!(marginStatus && marginStatus.running)
    };
    
    setModuleStatus(prev => {
      const isChanged =
        prev.trader !== newStatus.trader ||
        prev.amend !== newStatus.amend ||
        prev.cancel !== newStatus.cancel ||
        prev.margin !== newStatus.margin;
      return isChanged ? newStatus : prev;
    });
  }, [traderStatus, amendStatus, marginStatus, cancelStatus]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let isComponentMounted = true;
    let snapshotGen = 0;
    let reconnectDelay = 1000;

    const loadSnapshot = async () => {
      try {
        const [snapshotRes, ordersRes] = await Promise.all([
          safeFetch<SnapshotResponse>('/api/snapshot'),
          (async () => {
            for (let attempt = 0; attempt < 3; attempt++) {
              const res = await safeFetch<OrdersResponse>('/api/orders/pending?noWait=1');
              if (!res || !res.warming) return res;
              if (attempt < 2) await new Promise(r => setTimeout(r, 500));
            }
            return await safeFetch<OrdersResponse>('/api/orders/pending?noWait=1');
          })(),
        ]);

        const validAccountIdxs = new Set<number>();
        if (snapshotRes && snapshotRes.ok && Array.isArray(snapshotRes.accounts)) {
          snapshotRes.accounts.forEach((a: Account) => {
            if (a._account !== undefined) validAccountIdxs.add(a._account);
          });
        }

        if (snapshotRes && snapshotRes.ok && Array.isArray(snapshotRes.accounts)) {

          if (snapshotRes.accountNames) {
            setConfig(prev => {
              const names = snapshotRes.accountNames as Record<number, string>;
              const colors = (snapshotRes.accountColors || prev.accountColors) as Record<number, string>;
              const namesChanged = !shallowEqualRecord(
                prev.accountNames as Record<string, string> | undefined,
                names as unknown as Record<string, string>
              );
              const colorsChanged = !shallowEqualRecord(
                prev.accountColors as Record<string, string> | undefined,
                colors as unknown as Record<string, string>
              );
              if (!namesChanged && !colorsChanged) return prev;
              return { ...prev, accountNames: names, accountColors: colors };
            });
          }

          if (Array.isArray(snapshotRes.positions)) {
            const next: Record<string, Position> = {};
            snapshotRes.positions.forEach((p: Position) => {
              const key = buildPositionKey(p);
              if (validAccountIdxs.has(p._account)) {
                next[key] = p;
              }
            });
            stateRef.current.positions = next;
            setPositions(next);
          }
          if (Array.isArray(snapshotRes.accounts)) {
            const next: Record<number, Account> = {};
            snapshotRes.accounts.forEach((a: Account) => {
              if (a._account !== undefined && validAccountIdxs.has(a._account)) {
                next[a._account] = { ...stateRef.current.accounts[a._account], ...a };
              }
            });
            stateRef.current.accounts = next;
            setAccounts(next);
          }
        }

        if (ordersRes && ordersRes.ok && Array.isArray(ordersRes.data)) {
          const next: Record<string, Order> = {};
          const hasValidAccounts = validAccountIdxs.size > 0;
          ordersRes.data.forEach((o: Order) => {
            if (o._account === undefined) return;
            if (hasValidAccounts && !validAccountIdxs.has(o._account)) return;
            const id = o.algoId || o.ordId;
            if (!id) return;
            const key = buildOrderKey(o, id);
            const state = o.state || '';
            if (ACTIVE_ORDER_STATES.has(state.toLowerCase())) {
              next[key] = o;
            }
          });
          stateRef.current.orders = next;
          setOrders(next);
        }
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('快照加载失败:', error);
      }
    };

    const connectWs = () => {
      if (!isComponentMounted) return;

      const getWsUrl = async (): Promise<string> => {
        if (window.electronAPI) {
          const port = await window.electronAPI.getBackendPort();
          return `ws://localhost:${port}`;
        }
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.host}`;
      };

      getWsUrl().then(url => {
        if (!isComponentMounted) return;
        ws = new WebSocket(url);

      const processMessage = (msg: Record<string, unknown>) => {
        if (!msg) return;

        if (!stateRef.current.snapshotLoaded && msg.type !== 'log') {
          stateRef.current.pendingMessages.push(msg);
          if (stateRef.current.pendingMessages.length > PENDING_MSG_MAX) {
            stateRef.current.pendingMessages.shift();
          }
          return;
        }

        const isValidAccountIdx = (idx: number | undefined): boolean => {
          if (idx === undefined) return false;
          const names = configRef.current.accountNames;
          return names != null && names[idx] !== undefined;
        };

        if (msg.type === 'accounts_changed') {
          stateRef.current.positions = {};
          stateRef.current.accounts = {};
          stateRef.current.orders = {};
          stateRef.current.wsStatus = {};
          stateRef.current.pendingMessages = [];
          setPositions({});
          setAccounts({});
          setOrders({});
          setWsStatus({});
          queryClient.invalidateQueries({ queryKey: ['accounts'] });
          queryClient.invalidateQueries({ queryKey: ['config'] });
          stateRef.current.snapshotLoaded = false;
          snapshotGen++;
          const acctChangeGen = snapshotGen;
          void loadSnapshot().then(() => {
            if (acctChangeGen !== snapshotGen) return;
            stateRef.current.snapshotLoaded = true;
          });
          return;
        }

        if (msg.type === 'system_info') {
          stateRef.current.serverTimezone = msg.timezone || 'UTC';
          scheduleUpdate('serverTimezone');
          return;
        }

        if (msg.type === 'script_status') {
          const { scriptType, running } = msg;
          const parts = scriptType.split(':');
          const baseType = parts[0];
          const configId = parts[1];

          if (['trader', 'amend', 'cancel', 'margin', 'close'].includes(baseType)) {
            setModuleStatus(prev => {
              if (prev[baseType] === running) return prev;
              return { ...prev, [baseType]: running };
            });
          }

          if (configId) {
            const baseTypeToModuleName: Record<string, string> = {
              trader: 'place',
              amend: 'amend',
              cancel: 'cancel',
              close: 'close',
              margin: 'margin'
            };
            const moduleName = baseTypeToModuleName[baseType];
            if (moduleName) {
              const configsKey = [moduleName, 'configs'];
              const previousConfigs = queryClient.getQueryData<Array<{ id: string; running?: boolean }>>(configsKey);
              if (previousConfigs) {
                const refreshed = previousConfigs.map(c => 
                  c.id === configId ? { ...c, running } : c
                );
                queryClient.setQueryData(configsKey, refreshed);
              }

              const globalConfigKey = ['config'];
              const cachedConfig = queryClient.getQueryData<Record<string, unknown>>(globalConfigKey);
              if (cachedConfig) {
                const configListName = `${moduleName}_configs`;
                const list = cachedConfig[configListName];
                if (Array.isArray(list)) {
                  const updatedList = list.map((c: { id: string; running?: boolean }) => 
                    c.id === configId ? { ...c, running } : c
                  );
                  queryClient.setQueryData(globalConfigKey, {
                    ...cachedConfig,
                    [configListName]: updatedList
                  });
                }
              }
            }
          }
          return;
        }

        if (msg.type === 'log') {
          const logEntry = msg as LogEntry;

          const isDuplicate = isDuplicateLogEntry(stateRef.current.logs, logEntry);
          if (isDuplicate) return;

          stateRef.current.logs = [...stateRef.current.logs, logEntry].slice(-LOG_WINDOW_SIZE);
          scheduleUpdate('logs');
          
          const stateKey = SCRIPT_TO_LOG_KEY[logEntry.script];
          if (stateKey) {
            stateRef.current[stateKey] = [...stateRef.current[stateKey], logEntry].slice(-LOG_WINDOW_SIZE);
            scheduleUpdate(stateKey);
          }
          return;
        }

        if (msg.type === 'ws_status') {
          const configData = configRef.current;
          const hasAccount = configData.accountNames && configData.accountNames[msg.account] !== undefined;
          
          if (hasAccount) {
            stateRef.current.wsStatus = {
              ...stateRef.current.wsStatus,
              [msg.account]: { connected: msg.connected, lastSeen: Date.now(), status: msg.status }
            };
            scheduleUpdate('wsStatus');
          }
          return;
        }

        if (msg.type === 'order_sync') {
          orderSyncPending.current = true;
          if (!orderSyncTimer.current) {
            orderSyncTimer.current = setTimeout(() => {
              orderSyncTimer.current = null;
              if (!orderSyncPending.current) return;
              orderSyncPending.current = false;
              safeFetch<OrdersResponse>('/api/orders/pending').then(ordersRes => {
                if (ordersRes && ordersRes.ok && Array.isArray(ordersRes.data)) {
                  const next = { ...stateRef.current.orders };

                  Object.keys(next).forEach(key => {
                    delete next[key];
                  });

                  ordersRes.data.forEach((o: Order) => {
                    const id = o.algoId || o.ordId;
                    if (!id || o._account === undefined || !isValidAccountIdx(o._account)) return;
                    const key = buildOrderKey(o, id);
                    const state = o.state || '';
                    if (ACTIVE_ORDER_STATES.has(state.toLowerCase())) {
                      next[key] = o;
                    }
                  });
                  stateRef.current.orders = next;
                  scheduleUpdate('orders');
                }
              });
            }, 500);
          }
          return;
        }

        if (msg.arg && Array.isArray(msg.data)) {
          const channel = msg.arg.channel;

          if (channel === 'positions') {
            const next = { ...stateRef.current.positions };
            msg.data.forEach((p: Partial<Position>) => {
              if (p._account === undefined || !isValidAccountIdx(p._account)) return;
              const key = buildPositionKey(p);
              const isEmpty = isEmptyPosition(p);
              if (isEmpty) {
                delete next[key];
              } else {
                next[key] = { ...next[key], ...p } as Position;
              }
            });
            stateRef.current.positions = next;
            scheduleUpdate('positions');
          } else if (channel === 'account') {
            const next = { ...stateRef.current.accounts };
            msg.data.forEach((a: Partial<Account>) => {
              if (a._account !== undefined && isValidAccountIdx(a._account)) {
                const idx = a._account;
                const pUsdt = pendingSavingsUsdt.current[idx];
                const pUsdc = pendingSavingsUsdc.current[idx];
                const pVal = pendingValuation.current[idx];
                next[idx] = {
                  ...next[idx],
                  ...a,
                  savingsUsdt: pUsdt || next[idx]?.savingsUsdt,
                  savingsUsdc: pUsdc || next[idx]?.savingsUsdc,
                  valuation: pVal || next[idx]?.valuation
                };
                if (pUsdt) delete pendingSavingsUsdt.current[idx];
                if (pUsdc) delete pendingSavingsUsdc.current[idx];
                if (pVal) delete pendingValuation.current[idx];
              }
            });
            stateRef.current.accounts = next;
            scheduleUpdate('accounts');
          } else if (channel === 'orders' || channel === 'orders-algo' || channel === 'algo-advance') {
            const next = { ...stateRef.current.orders };
            msg.data.forEach((o: Partial<Order>) => {
              if (o._account === undefined || !isValidAccountIdx(o._account)) return;
              const id = o.algoId || o.ordId;
              if (id) {
                const key = buildOrderKey(o, id);
                const state = o.state || '';
                if (ACTIVE_ORDER_STATES.has(state.toLowerCase())) {
                  next[key] = { ...next[key], ...o } as Order;
                } else {
                  delete next[key];
                }
              }
            });
            stateRef.current.orders = next;
            scheduleUpdate('orders');
          }

          if (msg.data && msg.data.length > 0 && msg.data[0]._account !== undefined) {
            const acc = msg.data[0]._account;
            if (isValidAccountIdx(acc)) {
              stateRef.current.wsStatus = {
                ...stateRef.current.wsStatus,
                [acc]: { connected: true, lastSeen: Date.now() }
              };
              scheduleUpdate('wsStatus');
            }
          }
        }

        if (msg.type === 'positions_update' && msg.data) {
          const targetAccount = msg.account;
          if (targetAccount !== undefined && isValidAccountIdx(targetAccount)) {
            const next = { ...stateRef.current.positions };
            
            Object.keys(next).forEach(key => {
              if (next[key]._account === targetAccount) {
                delete next[key];
              }
            });

            msg.data.forEach((p: Partial<Position>) => {
              const key = (p.posId ? `${p.posId}_${targetAccount}` : `${p.instId}_${p.posSide}_${targetAccount}`);
              const isEmpty = isEmptyPosition(p);
              if (!isEmpty) {
                next[key] = { ...p, _account: targetAccount } as Position;
              }
            });

            stateRef.current.positions = next;
            scheduleUpdate('positions');
            
            stateRef.current.wsStatus = {
              ...stateRef.current.wsStatus,
              [targetAccount]: { connected: true, lastSeen: Date.now() }
            };
            scheduleUpdate('wsStatus');
          }
          return;
        }

        if (msg.type === 'account_update' && msg.balances) {
          const acc = msg.account;
          if (acc !== undefined && isValidAccountIdx(acc)) {
             const next = { ...stateRef.current.accounts };
             next[acc] = {
               ...next[acc],
               ...msg.balances,
               _account: acc
             };
             stateRef.current.accounts = next;
             scheduleUpdate('accounts');
             
             stateRef.current.wsStatus = {
               ...stateRef.current.wsStatus,
               [acc]: { connected: true, lastSeen: Date.now() }
             };
             scheduleUpdate('wsStatus');
          }
        }

        if (msg.type === 'savings' && msg.ok && msg.balances) {
          const acc = msg.account;
          if (acc !== undefined && isValidAccountIdx(acc)) {
            stateRef.current.accounts = {
              ...stateRef.current.accounts,
              [acc]: { 
                ...stateRef.current.accounts[acc], 
                _account: acc, 
                savingsUsdt: msg.balances.USDT, 
                savingsUsdc: msg.balances.USDC 
              }
            };
            scheduleUpdate('accounts');
            
            stateRef.current.wsStatus = {
              ...stateRef.current.wsStatus,
              [acc]: { connected: true, lastSeen: Date.now() }
            };
            scheduleUpdate('wsStatus');
          }
        }

        if (msg.type === 'asset_valuation' && msg.ok && msg.valuation) {
          if (msg.account !== undefined && isValidAccountIdx(msg.account)) {
            const acc = msg.account;
            pendingValuation.current[acc] = msg.valuation;
            stateRef.current.accounts = {
              ...stateRef.current.accounts,
              [acc]: {
                ...stateRef.current.accounts[acc],
                _account: acc,
                valuation: msg.valuation
              }
            };
            scheduleUpdate('accounts');
            
            stateRef.current.wsStatus = {
              ...stateRef.current.wsStatus,
              [acc]: { connected: true, lastSeen: Date.now() }
            };
            scheduleUpdate('wsStatus');
          }
        }
      };

      ws.onopen = async () => {
        snapshotGen++;
        stateRef.current.snapshotLoaded = false;
        stateRef.current.pendingMessages = [];
        reconnectDelay = 1000;
        const currentGen = snapshotGen;
        await loadSnapshot();
        if (currentGen !== snapshotGen) {
          return;
        }
        stateRef.current.snapshotLoaded = true;
        const pending = stateRef.current.pendingMessages;
        stateRef.current.pendingMessages = [];
        if (pending.length > 0) {
          for (const msg of pending) {
            if (msg) processMessage(msg);
          }
        }
        queryClient.invalidateQueries({ queryKey: ['logs'] });
      };

      ws.onerror = (error) => {
        console.error('[useTradingData] WebSocket error:', error);
      };

      ws.onclose = (event) => {
        stateRef.current.positions = {};
        stateRef.current.accounts = {};
        stateRef.current.orders = {};
        stateRef.current.wsStatus = {};
        stateRef.current.snapshotLoaded = false;
        setPositions({});
        setAccounts({});
        setOrders({});
        setWsStatus({});
        if (isComponentMounted) {
          const nextDelay = Math.min(reconnectDelay * 2, 30000);
          reconnectTimer = setTimeout(connectWs, reconnectDelay);
          reconnectDelay = nextDelay;
        }
      };

      ws.onmessage = (event) => {
        const data = safeJsonParse<any | null>(event.data, null, {
          context: 'useTradingData.ws.onmessage',
          reporter: (error, meta) => {
            console.error('[useTradingData] 解析 WebSocket 消息失败:', error, meta);
          }
        });
        if (!data) {
          return;
        }

        try {
          if (data.type === 'batch' && Array.isArray(data.messages)) {
            data.messages.forEach(processMessage);
          } else {
            processMessage(data);
          }
        } catch (e) {
          console.error('WebSocket 消息处理错误:', e, event.data);
        }
      };
      });
    };

    connectWs();

    return () => {
      isComponentMounted = false;
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  return {
    positions,
    accounts,
    orders,
    logs,
    traderLogs,
    amendLogs,
    marginLogs,
    diyLogs,
    cancelLogs,
    closeLogs,
    envStatus,
    moduleStatus,
    wsStatus,
    serverTimezone,
    config,
    updateConfig,
    setLogs,
    setTraderLogs,
    setAmendLogs,
    setMarginLogs,
    setDiyLogs,
    setCancelLogs,
    setCloseLogs,
    setModuleStatus,
    accountIdNames,
    accountIdColors,
    accountIdExchanges,
    fundingRates,
    changeTodayMap,
    removeOrder: (orderId: string) => {
      setOrders(prev => {
        const next = { ...prev };
        Object.keys(next).forEach((key) => {
          const order = next[key];
          const exchangeOrderId = order.algoId || order.ordId;
          if (exchangeOrderId === orderId) {
            delete next[key];
          }
        });
        stateRef.current.orders = next;
        return next;
      });
    },
  };
}
