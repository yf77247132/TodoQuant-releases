import { dbService } from '../../../services/dbService.ts';
import { LogService } from '../../../services/logService.ts';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from '../../../services/errorMonitor.ts';
import { loadSavedConfig } from '../../../services/configService.ts';
import { DIYStrategy, ConditionTemplate } from '../../../types/diy.ts';
import { safeJsonParse } from '../../../lib/safeJsonParse.ts';

interface JsonParseReporter {
  (context: string, error: Error, rawPreview: string): void;
}

export interface StrategyLifecycleDeps {
  runningStrategies: Map<string, DIYStrategy>;
  executingStrategies: Set<string>;
  conditionTemplates: Map<string, ConditionTemplate>;
  conditionState: Map<string, { result: boolean; lastLoggedAt: number }>;
  liveStates: Map<string, { result: boolean; currentVal: string }>;
  lastTriggeredMap: Map<string, number>;
  pendingSignals: Map<string, { receivedAt: number; payload: unknown }>;
  userTimezoneRef: { current: string | null };
  locale: string;
  startTick: () => void;
  bumpStrategyRunToken: (strategyId: string) => number;
  reportJsonParseError: JsonParseReporter;
}

export async function initCore(deps: StrategyLifecycleDeps): Promise<void> {
  await reloadStrategiesCore(deps);
  deps.startTick();

  const cfg = await loadSavedConfig();
  const userTz = cfg.timezone;
  const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
  const activeTz = userTz || systemTz;
  const nowStr = new Date().toLocaleString('zh-CN', { hour12: false, timeZone: activeTz });

  const TZ_LABELS: Record<string, string> = {
    'Asia/Shanghai': '北京时间 (UTC+8)',
    'Asia/Tokyo': '东京时间 (UTC+9)',
    'Asia/Singapore': '新加坡时间 (UTC+8)',
    'Europe/London': '伦敦时间 (UTC+0)',
    'America/New_York': '纽约时间 (UTC-5)',
    'America/Los_Angeles': '洛杉矶时间 (UTC-8)',
    'UTC': '协调世界时 (UTC)'
  };

  const activeTzLabel = userTz ? (TZ_LABELS[userTz] || userTz) : `系统时区: ${systemTz}`;
  LogService.logKey('diy', 'diy.strategy.init', { tzLabel: activeTzLabel, now: nowStr });
}

export async function reloadStrategiesCore(deps: StrategyLifecycleDeps): Promise<void> {
  try {
    const cfg = await loadSavedConfig();
    deps.userTimezoneRef.current = cfg.timezone || null;

    const templatesRaw = dbService.getConfig('diy_conditions');
    const templates = safeJsonParse<ConditionTemplate[]>(templatesRaw, [], {
      context: 'DiyEngine.reloadStrategies.diy_conditions',
      reporter: (error, meta) => deps.reportJsonParseError(meta.context, error, meta.rawPreview)
    });
    deps.conditionTemplates.clear();
    for (const t of templates) {
      deps.conditionTemplates.set(String(t.id), t);
    }

    const strategiesRaw = dbService.getConfig('diy_strategies');
    const strategies = safeJsonParse<DIYStrategy[]>(strategiesRaw, [], {
      context: 'DiyEngine.reloadStrategies.diy_strategies',
      reporter: (error, meta) => deps.reportJsonParseError(meta.context, error, meta.rawPreview)
    });

    const existingIds = new Set(strategies.map(s => String(s.id)));

    for (const [id, st] of deps.runningStrategies.entries()) {
      if (!existingIds.has(String(id))) {
        deps.runningStrategies.delete(id);
        deps.lastTriggeredMap.delete(id);
        LogService.logKey('diy', 'diy.strategy.deleted', { name: st.name });
      }
    }

    for (const st of strategies) {
      const running = deps.runningStrategies.get(String(st.id));
      if (running) {
        running.name = st.name;
        running.conditionTemplateId = st.conditionTemplateId;
        running.actions = st.actions;
        running.testMode = st.testMode;
      }
    }
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    LogService.logKey('diy', 'diy.strategy.loadFailed', { msg: error.message }, 'error');
    ErrorMonitor.captureError(error, ErrorLevel.HIGH, ErrorCategory.SYSTEM);
  }
}

export async function startStrategyCore(deps: StrategyLifecycleDeps, strategyId: string): Promise<void> {
  const strategiesRaw = dbService.getConfig('diy_strategies');
  const strategies = safeJsonParse<DIYStrategy[]>(strategiesRaw, [], {
    context: 'DiyEngine.startStrategy.diy_strategies',
    reporter: (error, meta) => deps.reportJsonParseError(meta.context, error, meta.rawPreview)
  });
  const st = strategies.find(s => String(s.id) === String(strategyId));
  if (!st) {
    LogService.logKey('diy', 'diy.strategy.notFound', { id: strategyId }, 'warn');
    return;
  }
  const template = deps.conditionTemplates.get(String(st.conditionTemplateId));
  if (!template) {
    LogService.logKey('diy', 'diy.strategy.conditionDeleted', { name: st.name }, 'warn');
    return;
  }
  st.running = true;
  deps.bumpStrategyRunToken(String(st.id));
  const existing = deps.runningStrategies.get(String(st.id));
  if (existing) {
    existing.name = st.name;
    existing.conditionTemplateId = String(st.conditionTemplateId);
    existing.actions = st.actions;
    existing.testMode = st.testMode;
  } else {
    deps.runningStrategies.set(String(st.id), { ...st, triggerCount: 0, lastTriggered: 0 });
  }
  LogService.logKey('diy', 'diy.strategy.started', { name: st.name }, 'info', strategyId);
}

export async function stopStrategyCore(deps: StrategyLifecycleDeps, strategyId: string): Promise<void> {
  const st = deps.runningStrategies.get(strategyId);
  if (st) {
    LogService.logKey('diy', 'diy.strategy.stopped', { name: st.name }, 'info', strategyId);
  }
  deps.runningStrategies.delete(strategyId);
  deps.bumpStrategyRunToken(strategyId);
  deps.executingStrategies.delete(strategyId);
  deps.lastTriggeredMap.delete(strategyId);
  deps.pendingSignals.delete(strategyId);
  for (const key of deps.pendingSignals.keys()) {
    if (key.startsWith(`${strategyId}:`)) {
      deps.pendingSignals.delete(key);
    }
  }

  for (const key of deps.conditionState.keys()) {
    if (key.startsWith(`${strategyId}:`)) {
      deps.conditionState.delete(key);
    }
  }
  for (const key of deps.liveStates.keys()) {
    if (key.startsWith(`${strategyId}:`)) {
      deps.liveStates.delete(key);
    }
  }
}
