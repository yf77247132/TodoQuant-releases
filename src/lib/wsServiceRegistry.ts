
import type { AccountMonitor } from '../services/AccountMonitor.ts';
import type { OKXWebSocketManager } from '../services/wsManager.ts';
import type { DiyEngine } from '../engine/diy/DiyEngine.ts';

let getAccountMonitorImpl: (() => AccountMonitor) | null = null;
let transformOrderImpl: ((order: Record<string, unknown>) => Record<string, unknown>) | null = null;

export function registerAccountMonitorAccess(
  impl: () => AccountMonitor,
  transformOrder: (order: Record<string, unknown>) => Record<string, unknown>
): void {
  getAccountMonitorImpl = impl;
  transformOrderImpl = transformOrder;
}

export function requireAccountMonitor(): AccountMonitor {
  if (!getAccountMonitorImpl) {
    throw new Error('[wsServiceRegistry] AccountMonitor 未注册：初始化顺序被改动（AccountMonitor 模块应自注册）');
  }
  return getAccountMonitorImpl();
}

export function requireTransformOrder(): (order: Record<string, unknown>) => Record<string, unknown> {
  if (!transformOrderImpl) {
    throw new Error('[wsServiceRegistry] transformOrder 未注册：初始化顺序被改动（AccountMonitor 模块应自注册）');
  }
  return transformOrderImpl;
}

let getDiyEngineImpl: (() => DiyEngine) | null = null;

export function registerDiyEngineAccess(impl: () => DiyEngine): void {
  getDiyEngineImpl = impl;
}

export function requireDiyEngine(): DiyEngine {
  if (!getDiyEngineImpl) {
    throw new Error('[wsServiceRegistry] DiyEngine 未注册：初始化顺序被改动（DiyEngine 模块应自注册）');
  }
  return getDiyEngineImpl();
}

let getOkxWsManagerImpl: (() => typeof OKXWebSocketManager) | null = null;

export function registerOkxWsManagerAccess(impl: () => typeof OKXWebSocketManager): void {
  getOkxWsManagerImpl = impl;
}

export function requireOkxWsManager(): typeof OKXWebSocketManager {
  if (!getOkxWsManagerImpl) {
    throw new Error('[wsServiceRegistry] OKXWebSocketManager 未注册：初始化顺序被改动（wsManager 模块应自注册）');
  }
  return getOkxWsManagerImpl();
}
