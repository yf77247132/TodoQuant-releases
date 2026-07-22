import { LogService } from "../../services/logService.ts";
import { dbService } from "../../services/dbService.ts";
import { DIYStrategy, ConditionTemplate } from "../../types/diy.ts";
import { ErrorMonitor, ErrorLevel, ErrorCategory } from "../../services/errorMonitor.ts";
import { safeJsonParse } from "../../lib/safeJsonParse.ts";
import { loadSavedConfig } from "../../services/configService.ts";
import { AppConfig } from "../../types/core.ts";
import { fetchFundingRate } from "../../lib/marketPrice.ts";
import { SymbolUtils } from "../../lib/symbolUtils.ts";
import {
  initCore,
  reloadStrategiesCore,
  startStrategyCore,
  stopStrategyCore,
  type StrategyLifecycleDeps,
} from "./core/strategyLifecycle.ts";
import { evaluateTemplateCore } from "./core/conditionEvaluator.ts";
import {
  executeActionsCore,
  persistStrategyStatusCore,
} from "./core/actionExecutor.ts";
import { onDataPushCore, pushSignalCore, cleanupExpiredSignals } from "./core/signalQueue.ts";

export class DiyEngine {
  private static instance: DiyEngine;

  private runningStrategies: Map<string, DIYStrategy> = new Map();
  private executingStrategies: Set<string> = new Set();
  private conditionTemplates: Map<string, ConditionTemplate> = new Map();
  private conditionState: Map<string, { result: boolean; lastLoggedAt: number }> = new Map();
  private liveStates: Map<string, { result: boolean; currentVal: string }> = new Map();
  private tickInterval: NodeJS.Timeout | null = null;
  private userTimezone: string | null = null;
  private userLocale: string = 'zh-CN';
  private lastTriggeredMap: Map<string, number> = new Map();
  private pendingSignals: Map<string, { receivedAt: number; payload: unknown }> = new Map();
  private isTicking = false;
  private pendingTick = false;
  private strategyRunTokens: Map<string, number> = new Map();
  private pendingStrategyPersists: Map<string, DIYStrategy> = new Map();
  private persistFlushTimer: NodeJS.Timeout | null = null;
  private static readonly PERSIST_FLUSH_MS = 800;
  private lastMidnight = 0;
  private fundingRateCache: Map<string, string> = new Map();

  private constructor() {}

  private buildLifecycleDeps(): StrategyLifecycleDeps {
    return {
      runningStrategies: this.runningStrategies,
      executingStrategies: this.executingStrategies,
      conditionTemplates: this.conditionTemplates,
      conditionState: this.conditionState,
      liveStates: this.liveStates,
      lastTriggeredMap: this.lastTriggeredMap,
      pendingSignals: this.pendingSignals,
      userTimezoneRef: { current: this.userTimezone },
      locale: this.userLocale,
      startTick: () => this.startTick(),
      bumpStrategyRunToken: (id: string) => this.bumpStrategyRunToken(id),
      reportJsonParseError: (context: string, error: Error, rawPreview: string) =>
        this.reportJsonParseError(context, error, rawPreview),
    };
  }

  public static getInstance(): DiyEngine {
    if (!DiyEngine.instance) {
      DiyEngine.instance = new DiyEngine();
    }
    return DiyEngine.instance;
  }

  public getLiveStates(strategyId: string) {
    const states: { result: boolean; currentVal: string }[] = [];
    this.liveStates.forEach((val, key) => {
      if (key.startsWith(`${strategyId}:`)) {
        const parts = key.split(":");
        const condIdx = parseInt(parts[2], 10);
        if (!isNaN(condIdx)) states[condIdx] = val;
      }
    });
    return states.filter(s => s !== undefined);
  }

  private reportJsonParseError(context: string, error: Error, rawPreview: string): void {
    LogService.logKey("diy", 'diy.jsonParseFailed', { context, msg: error.message, raw: rawPreview }, 'error');
    ErrorMonitor.captureValidationError(error, { context, rawPreview }, "DiyEngine");
  }

  public async init() {
    const deps = this.buildLifecycleDeps();
    await initCore(deps);
    this.userTimezone = deps.userTimezoneRef.current;
  }

  public async reloadStrategies() {
    const deps = this.buildLifecycleDeps();
    await reloadStrategiesCore(deps);
    this.userTimezone = deps.userTimezoneRef.current;
  }

  public async startStrategy(strategyId: string) {
    await startStrategyCore(this.buildLifecycleDeps(), strategyId);
    await this.syncPrefetchFundingRates(strategyId);
  }

  private async syncPrefetchFundingRates(strategyId: string) {
    const strategy = this.runningStrategies.get(strategyId);
    if (!strategy) return;
    const template = this.conditionTemplates.get(String(strategy.conditionTemplateId));
    if (!template) return;

    const instIds = new Set<string>();
    for (const cond of template.conditions) {
      if (cond.type === 'pos_funding_rate') {
        const instId = String((cond.params as Record<string, unknown>)?.instId || '').trim();
        if (instId) instIds.add(instId);
      }
    }

    for (const instId of instIds) {
      try {
        const result = await fetchFundingRate(instId);
        if (result?.rate !== undefined) {
          this.fundingRateCache.set(instId, result.rate);
        }
      } catch {
      }
    }
  }

  public async stopStrategy(strategyId: string) {
    await stopStrategyCore(this.buildLifecycleDeps(), strategyId);
  }

  private startTick() {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => {
      this.requestTick();
    }, 1000);
  }

  public getRunningStrategyIds(): Set<string> {
    return new Set(this.runningStrategies.keys());
  }

  public setLocale(locale: string): void {
    if (locale === 'zh-CN' || locale === 'en-US') {
      this.userLocale = locale;
    }
  }

  private bumpStrategyRunToken(strategyId: string): number {
    const next = (this.strategyRunTokens.get(strategyId) || 0) + 1;
    this.strategyRunTokens.set(strategyId, next);
    return next;
  }

  private isStrategyRunActive(strategyId: string, token: number): boolean {
    return this.runningStrategies.has(strategyId) && this.strategyRunTokens.get(strategyId) === token;
  }

  private requestTick(): void {
    if (this.isTicking) {
      this.pendingTick = true;
      return;
    }
    this.isTicking = true;
    try {
      this.tick();
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      LogService.logKey("diy", 'diy.tickException', { msg: error.message }, 'error');
      ErrorMonitor.captureError(error, ErrorLevel.HIGH, ErrorCategory.SYSTEM);
    } finally {
      this.isTicking = false;
      if (this.pendingTick) {
        this.pendingTick = false;
        queueMicrotask(() => this.requestTick());
      }
    }
  }

  private tick() {
    cleanupExpiredSignals(this.pendingSignals);

    const appConfig = loadSavedConfig();

    const currentMidnight = new Date().setHours(0, 0, 0, 0);
    if (this.lastMidnight !== 0 && currentMidnight !== this.lastMidnight) {
      LogService.logKey("diy", 'diy.dateChanged', {}, 'info');
      for (const st of this.runningStrategies.values()) {
        st.triggerCount = 0;
        this.persistStrategyData(st);
      }
    }
    this.lastMidnight = currentMidnight;

    this.prefetchFundingRates();

    for (const [id, strategy] of this.runningStrategies.entries()) {
      try {
        const template = this.conditionTemplates.get(String(strategy.conditionTemplateId));
        if (!template) continue;

        const accountIndices = new Set<number>();
        for (const cond of template.conditions) {
          const accountId = String((cond.params as Record<string, unknown>)?.accountId || '').trim();
          if (accountId && appConfig.accounts) {
            const idx = appConfig.accounts.findIndex((a) => a.id === accountId);
            if (idx >= 0) accountIndices.add(idx);
          }
        }

        const NON_ACCOUNT_CONDITIONS = new Set(['tv_signal', 'time_window', 'cooldown', 'count_limit', 'indicator']);
        const hasNonAccountCond = template.conditions.some(c => NON_ACCOUNT_CONDITIONS.has(c.type));
        if (accountIndices.size === 0 && !hasNonAccountCond) continue;
        if (accountIndices.size === 0 && hasNonAccountCond) {
          accountIndices.add(0);
        }

        for (const accountIdx of accountIndices) {
          const isMatched = this.evaluateTemplate(strategy, template, accountIdx, appConfig);
          if (isMatched) {
            if (this.executingStrategies.has(strategy.id)) continue;
            const runToken = this.strategyRunTokens.get(strategy.id);
            if (!runToken) continue;
            this.markTriggered(strategy.id);
            void this.executeActions(strategy, accountIdx, runToken);
          }
        }
      } catch (e: unknown) {
        ErrorMonitor.captureStrategyError(e as Error, { scriptType: "diy", configId: id }, "DiyEngine");
      }
    }
  }

  public onDataPush(_accountIdx: number, _channel: string, _data: unknown[]) {
    onDataPushCore(_accountIdx, _channel, _data);
  }

  private checkSafetyLocks(strategy: DIYStrategy, _template: ConditionTemplate): boolean {
    const now = Date.now();
    const lastTrigger = this.lastTriggeredMap.get(strategy.id) || strategy.lastTriggered || 0;
    if (now - lastTrigger < 1000) return false;
    return true;
  }

  private prefetchFundingRates() {
    const instIds = new Set<string>();
    for (const strategy of this.runningStrategies.values()) {
      const template = this.conditionTemplates.get(String(strategy.conditionTemplateId));
      if (!template) continue;
      for (const cond of template.conditions) {
        if (cond.type === 'pos_funding_rate') {
          const instId = String((cond.params as Record<string, unknown>)?.instId || '').trim();
          if (instId) instIds.add(instId);
        }
      }
    }
    for (const instId of instIds) {
      void fetchFundingRate(instId).then(result => {
        if (result?.rate !== undefined) {
          this.fundingRateCache.set(instId, result.rate);
        }
      }).catch(() => {
      });
    }
  }

  private markTriggered(strategyId: string) {
    const now = Date.now();
    this.lastTriggeredMap.set(strategyId, now);
    for (const key of this.pendingSignals.keys()) {
      if (key === strategyId || key.startsWith(`${strategyId}:`)) {
        this.pendingSignals.delete(key);
      }
    }

    const strategy = this.runningStrategies.get(strategyId);
    if (strategy) {
      strategy.lastTriggered = now;
      strategy.triggerCount = (strategy.triggerCount || 0) + 1;
      this.persistStrategyData(strategy);
    }
  }

  private persistStrategyData(strategy: DIYStrategy) {
    this.pendingStrategyPersists.set(String(strategy.id), strategy);
    if (this.persistFlushTimer) return;
    this.persistFlushTimer = setTimeout(() => {
      this.flushPersistedStrategies();
    }, DiyEngine.PERSIST_FLUSH_MS);
  }

  private flushPersistedStrategies() {
    const pending = new Map(this.pendingStrategyPersists);
    if (pending.size === 0) {
      this.pendingStrategyPersists.clear();
      this.persistFlushTimer = null;
      return;
    }

    try {
      const strategiesRaw = dbService.getConfig("diy_strategies");
      const strategies = safeJsonParse<DIYStrategy[]>(strategiesRaw, [], {
        context: "DiyEngine.persistStrategyData.diy_strategies",
        reporter: (error, meta) => this.reportJsonParseError(meta.context, error, meta.rawPreview),
      });
      const updatedById = new Map<string, DIYStrategy>();
      for (const st of strategies) {
        updatedById.set(String(st.id), st);
      }
      for (const [id, st] of pending.entries()) {
        updatedById.set(String(id), st);
      }
      dbService.setConfig("diy_strategies", JSON.stringify(Array.from(updatedById.values())));
      this.pendingStrategyPersists.clear();
      this.persistFlushTimer = null;
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      LogService.logKey("diy", 'diy.saveFailed', { msg: error.message }, 'error');
      ErrorMonitor.captureError(error, ErrorLevel.HIGH, ErrorCategory.SYSTEM);
      this.persistFlushTimer = null;
    }

    if (this.pendingStrategyPersists.size > 0 && !this.persistFlushTimer) {
      this.persistFlushTimer = setTimeout(() => {
        this.flushPersistedStrategies();
      }, DiyEngine.PERSIST_FLUSH_MS);
    }
  }

  private async executeActions(strategy: DIYStrategy, triggerAccountIdx: number, runToken: number) {
    await executeActionsCore(
      {
        executingStrategies: this.executingStrategies,
        runningStrategies: this.runningStrategies,
        conditionTemplates: this.conditionTemplates,
        userTimezone: this.userTimezone,
        locale: this.userLocale,
        isStrategyRunActive: (strategyId: string, token: number) => this.isStrategyRunActive(strategyId, token),
        stopStrategy: async (strategyId: string) => this.stopStrategy(strategyId),
        persistStrategyStatus: (strategyId: string, running: boolean) =>
          this.persistStrategyStatus(strategyId, running),
      },
      strategy,
      triggerAccountIdx,
      runToken
    );
  }

  private persistStrategyStatus(strategyId: string, running: boolean) {
    persistStrategyStatusCore(strategyId, running);
  }

  public pushSignal(strategyId: string, payload: unknown, source: 'tv' | 'ft' = 'tv') {
    return pushSignalCore(
      {
        runningStrategies: this.runningStrategies,
        pendingSignals: this.pendingSignals,
        requestTick: () => this.requestTick(),
      },
      strategyId,
      payload,
      source
    );
  }

  private evaluateTemplate(
    strategy: DIYStrategy,
    template: ConditionTemplate,
    triggerAccountIdx: number,
    appConfig: AppConfig
  ): boolean {
    return evaluateTemplateCore(
      {
        conditionState: this.conditionState,
        liveStates: this.liveStates,
        userTimezone: this.userTimezone,
        lastTriggeredMap: this.lastTriggeredMap,
        pendingSignals: this.pendingSignals,
        fundingRateCache: this.fundingRateCache,
        checkSafetyLocks: (st: DIYStrategy, t: ConditionTemplate) => this.checkSafetyLocks(st, t),
      },
      strategy,
      template,
      triggerAccountIdx,
      appConfig
    );
  }
}
