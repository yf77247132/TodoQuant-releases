// wsServiceRegistry 接线冒烟测试（打破 import 环的防回归锁，2026-09-12）
//
// ⚠️ 加载顺序即语义：消费方（messageHandlers/wsManager/DiyEngine）先于注册方加载；
// 若本文件能正常 import 并通过断言，说明注册表晚绑定接线正确。
//
// 注：此前版本的"未注册时 fail-fast"用例不可构造——wsManager 的传递依赖链已加载
// AccountMonitor 并触发自注册，require 不会抛错。fail-fast 逻辑保留在注册表内，
// 供真实初始化顺序被人为改动时暴露问题。
process.env.ELECTRON_USER_DATA_PATH = process.env.TEMP + '/okts-registry-smoke';

import assert from 'node:assert/strict';
import test from 'node:test';

import * as reg from '../src/lib/wsServiceRegistry.ts';
import '../src/bootstrap/ws/core/messageHandlers.ts';
import '../src/services/wsManager.ts';
import '../src/engine/diy/DiyEngine.ts';
import '../src/services/AccountMonitor.ts';

test('wsServiceRegistry: AccountMonitor / transformOrder 接线可用', () => {
  const am = reg.requireAccountMonitor();
  assert.ok(am, 'AccountMonitor 可获取');
  const to = reg.requireTransformOrder();
  const out = to({ ordType: 'limit', side: 'buy', sz: '1', instId: 'BTC-USDT-SWAP', ordId: 'x', state: 'live' }) as Record<string, unknown>;
  assert.ok(String(out.ordType).length > 0, 'transformOrder 可调用');
});

test('wsServiceRegistry: DiyEngine / OKXWebSocketManager 接线可用', () => {
  assert.ok(reg.requireDiyEngine(), 'DiyEngine 可获取');
  assert.ok(reg.requireOkxWsManager(), 'OKXWebSocketManager 可获取');
});

// ⚠️ 本文件拉起完整引擎/服务图（DB、WS 管理器、DIY 引擎等），模块句柄复杂，
// 测试完成后直接退出，防止残留句柄令测试运行器挂起（实测 5 分钟不退出）。
test.after(() => process.exit(0));
