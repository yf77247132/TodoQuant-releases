/**
 * DIY 条件引擎共享测试基建（fixture）
 *
 * 存在理由：conditionEvaluator 的 4 个回归测试此前各自复制了这套基建
 * （makeDeps 逐字复制 4 份，mkStrategy / mkTemplate / stubSources / mkTicker 各 3 份）。
 * 后果：ConditionEvaluatorDeps 增删字段时要同步改 4 处，漏一处 = 测试静默失效。
 * 抽取后新增回归测试直接 import，不再复制第 5 遍。
 *
 * ⚠️ 文件名不带 .test.ts 后缀 → 不会被 npm test 的 glob（tests 目录下的 *.test.ts）收集，仅供 import。
 * ⚠️ 全部为内存桩，不触碰 trading.db。
 */
import { marketScanner, type TickerData } from "../../src/services/MarketScanner.ts";
import { AccountMonitor } from "../../src/services/AccountMonitor.ts";
import type { ConditionEvaluatorDeps } from "../../src/engine/diy/core/conditionEvaluator.ts";
import type { DIYStrategy, ConditionTemplate } from "../../src/types/diy.ts";

/**
 * 最小可用求值依赖：状态全为空 Map、安全锁恒通过。
 * price_change 类条件只读行情、不读账户数据 → 配合 stubSources 即可脱离真实环境。
 * 注：字段与 ConditionEvaluatorDeps 严格对齐，类型不匹配会直接编译失败（这正是抽 fixture 的目的）。
 */
export function makeDeps(): ConditionEvaluatorDeps {
  return {
    conditionState: new Map(),
    liveStates: new Map(),
    userTimezone: null,
    lastTriggeredMap: new Map(),
    pendingSignals: new Map(),
    fundingRateCache: new Map(),
    crossState: new Map(),
    instrumentTriggered: new Map(),
    checkSafetyLocks: () => true,
  };
}

/** 仅含 id / name 的策略桩（条件求值只用 id 构造去重 key） */
export function mkStrategy(id: string): DIYStrategy {
  return { id, name: `测试策略-${id}` } as unknown as DIYStrategy;
}

/** 仅含 conditions 的模板桩 */
export function mkTemplate(conditions: ConditionTemplate["conditions"]): ConditionTemplate {
  return { conditions } as unknown as ConditionTemplate;
}

/**
 * 构造行情 ticker：价格锚定 100，只让涨幅可变。
 *
 * 求值口径（conditionEvaluator doEvaluateCore）：
 *   today   → 直读 ticker.changeToday
 *   24h     → 直读 ticker.change24h
 *   high24h → 由 high24h / sodUtc8 现算（本桩固定 high24h = sodUtc8 = 100 → high24h 涨幅恒 0）
 * open24h 仅作字段填充，当前无消费方。
 *
 * @param change24h   24H 涨幅（%）
 * @param changeToday 当日涨幅（%），默认同 change24h
 */
export function mkTicker(instId: string, change24h: number, changeToday: number = change24h): TickerData {
  return {
    instId, last: 100, open24h: 100 / (1 + change24h / 100), sodUtc8: 100,
    high24h: 100, low24h: 100, volCcy24h: 1000, change24h, changeToday, ts: Date.now(),
  };
}

/**
 * 屏蔽账户数据依赖。
 * ⚠️ 必须显式标注返回类型，否则 tsc 报 TS7023（stub 返回类型被隐式推断为 any）。
 */
export function stubAccountData(): void {
  Object.assign(AccountMonitor.getInstance(), { getAccountData: (): null => null });
}

/** 注入行情缓存并屏蔽账户数据依赖（price_change 类测试的通用准备） */
export function stubSources(tickers: TickerData[]): void {
  Object.assign(marketScanner, {
    getTicker: (_exchange: string, instId: string) => tickers.find(t => t.instId === instId),
    getAllTickers: () => tickers,
  });
  stubAccountData();
}
