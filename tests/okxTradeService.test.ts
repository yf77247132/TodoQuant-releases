import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OKXTradeService, OKXConfig } from '../src/services/okxTradeService.ts';
import type { ActionPlaceOrderParams } from '../src/types/blocks.ts';

function createService(overrides?: Partial<OKXConfig>): OKXTradeService {
  return new OKXTradeService({
    apiKey: 'dummy-api-key',
    secretKey: 'dummy-secret-key-for-testing',
    passphrase: 'dummy-passphrase',
    accountIdx: 0,
    ...overrides,
  });
}

// ─── getInstType ───
describe('OkxTradeService.getInstType', () => {
  const svc = createService();

  it('undefined → "SWAP"（默认）', () => {
    assert.equal((svc as any).getInstType(undefined), 'SWAP');
  });

  it('"BTC-USDT-SWAP" → "SWAP"', () => {
    assert.equal((svc as any).getInstType('BTC-USDT-SWAP'), 'SWAP');
  });

  it('"BTC-USDT-230929" → "FUTURES"（日期格式）', () => {
    assert.equal((svc as any).getInstType('BTC-USDT-230929'), 'FUTURES');
  });

  it('"BTC-USDT" → "SPOT"', () => {
    assert.equal((svc as any).getInstType('BTC-USDT'), 'SPOT');
  });

  it('"ETH-USDT-123456" → "FUTURES"（6位数字）', () => {
    assert.equal((svc as any).getInstType('ETH-USDT-123456'), 'FUTURES');
  });

  it('"ETH-USDT-123" → "SWAP"（3位数字不匹配）', () => {
    assert.equal((svc as any).getInstType('ETH-USDT-123'), 'SWAP');
  });

  it('空字符串 → "SWAP"（默认）', () => {
    assert.equal((svc as any).getInstType(''), 'SWAP');
  });
});

// ─── translateError ───
describe('OkxTradeService.translateError', () => {
  const svc = createService();

  it('"Timestamp request expired" → "请求时间戳已过期"', () => {
    assert.equal((svc as any).translateError('Timestamp request expired'), '请求时间戳已过期');
  });

  it('"Invalid API key" → "API Key 无效"', () => {
    assert.equal((svc as any).translateError('Invalid API key'), 'API Key 无效');
  });

  it('"Order does not exist" → "订单不存在"', () => {
    assert.equal((svc as any).translateError('Order does not exist'), '订单不存在');
  });

  it('未匹配保持原文', () => {
    assert.equal((svc as any).translateError('Unknown error message'), 'Unknown error message');
  });

  it('includes匹配+replace', () => {
    assert.equal(
      (svc as any).translateError('Timestamp request expired and other'),
      '请求时间戳已过期 and other',
    );
  });
});

// ─── getTimestamp ───
describe('OkxTradeService.getTimestamp', () => {
  it('返回 ISO 8601 格式字符串', () => {
    const svc = createService();
    const ts = (svc as any).getTimestamp();
    // ISO 8601 格式: YYYY-MM-DDTHH:mm:ss.sssZ
    assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('syncFailedCount > 2 时安全余量增大', () => {
    const svc = createService();
    // 设置 syncFailedCount = 5
    (svc as any).syncFailedCount = 5;

    const ts = (svc as any).getTimestamp();
    const now = Date.now();
    // syncFailedCount=5 时 safetyMargin = min(200 + 5*500, 5000) = 2700
    // 时间戳 = now + timeOffset(0) - 2700
    const tsMs = new Date(ts).getTime();
    const expectedMs = now - 2700;
    // 允许 100ms 误差（执行耗时）
    assert.ok(Math.abs(tsMs - expectedMs) < 100, `期望约 ${expectedMs}，实际 ${tsMs}`);
  });

  it('timeOffset 偏移量影响', () => {
    const svc = createService();
    (svc as any).timeOffset = 5000; // 偏移 5 秒
    (svc as any).syncFailedCount = 0;

    const ts = (svc as any).getTimestamp();
    const now = Date.now();
    const tsMs = new Date(ts).getTime();
    // safetyMargin = 200, timeOffset = 5000
    const expectedMs = now + 5000 - 200;
    assert.ok(Math.abs(tsMs - expectedMs) < 100, `期望约 ${expectedMs}，实际 ${tsMs}`);
  });
});

// ─── sign ───
describe('OkxTradeService.sign', () => {
  const svc = createService({ secretKey: 'test-secret-key-123' });

  it('验证签名格式（base64编码）', () => {
    const sig = (svc as any).sign('2024-01-01T00:00:00.000Z', 'GET', '/api/v5/public/time');
    // base64 编码只包含 A-Z a-z 0-9 + / = 字符
    assert.match(sig, /^[A-Za-z0-9+/]+=*$/);
  });

  it('相同输入产生相同签名', () => {
    const sig1 = (svc as any).sign('2024-01-01T00:00:00.000Z', 'POST', '/api/v5/trade/order', '{"side":"buy"}');
    const sig2 = (svc as any).sign('2024-01-01T00:00:00.000Z', 'POST', '/api/v5/trade/order', '{"side":"buy"}');
    assert.equal(sig1, sig2);
  });

  it('不同输入产生不同签名', () => {
    const sig1 = (svc as any).sign('2024-01-01T00:00:00.000Z', 'GET', '/api/v5/public/time');
    const sig2 = (svc as any).sign('2024-01-01T00:00:00.000Z', 'POST', '/api/v5/trade/order');
    assert.notEqual(sig1, sig2);
  });
});

// ─── mapToOKXPayload ───
describe('OkxTradeService.mapToOKXPayload', () => {
  const svc = createService();

  it('普通限价单：clOrdId 映射', () => {
    const params: ActionPlaceOrderParams = {
      instId: 'BTC-USDT-SWAP',
      tdMode: 'isolated',
      side: 'buy',
      ordType: 'limit',
      sz: '1',
      clOrdId: 'my-order-001',
      px: '50000',
    };
    const payload = (svc as any).mapToOKXPayload(params);

    assert.equal(payload.clOrdId, 'my-order-001');
    assert.equal(payload.algoClOrdId, undefined);
    assert.equal(payload.instId, 'BTC-USDT-SWAP');
    assert.equal(payload.px, '50000');
  });

  it('触发单：algoClOrdId 映射 + triggerPx/triggerPxType', () => {
    const params: ActionPlaceOrderParams = {
      instId: 'BTC-USDT-SWAP',
      tdMode: 'isolated',
      side: 'buy',
      ordType: 'trigger',
      sz: '1',
      clOrdId: 'algo-order-001',
      triggerPx: '60000',
    };
    const payload = (svc as any).mapToOKXPayload(params);

    assert.equal(payload.algoClOrdId, 'algo-order-001');
    assert.equal(payload.clOrdId, undefined);
    assert.equal(payload.triggerPx, '60000');
    assert.equal(payload.orderPx, '60000');
    assert.equal(payload.triggerPxType, 'last');
  });

  it('现货订单：tgtCcy/ccy 字段', () => {
    const params: ActionPlaceOrderParams = {
      instId: 'BTC-USDT',
      tdMode: 'cash',
      side: 'buy',
      ordType: 'limit',
      sz: '0.01',
      clOrdId: 'spot-001',
      px: '50000',
      meta: { tgt_ccy: 'quote_ccy' },
    };
    const payload = (svc as any).mapToOKXPayload(params);

    assert.equal(payload.tgtCcy, 'quote_ccy');
    assert.equal(payload.posSide, undefined);
  });

  it('现货杠杆订单：ccy 字段设为计价币', () => {
    const params: ActionPlaceOrderParams = {
      instId: 'BTC-USDT',
      tdMode: 'cross',
      side: 'buy',
      ordType: 'limit',
      sz: '0.01',
      clOrdId: 'margin-001',
      px: '50000',
    };
    const payload = (svc as any).mapToOKXPayload(params);

    assert.equal(payload.ccy, 'USDT');
    // 非cash模式应删除tgtCcy
    assert.equal(payload.tgtCcy, undefined);
  });

  it('合约订单：posSide 字段', () => {
    const params: ActionPlaceOrderParams = {
      instId: 'BTC-USDT-SWAP',
      tdMode: 'isolated',
      side: 'buy',
      ordType: 'limit',
      sz: '1',
      clOrdId: 'swap-001',
      posSide: 'long',
      px: '50000',
    };
    const payload = (svc as any).mapToOKXPayload(params);

    assert.equal(payload.posSide, 'long');
  });

  it('附带止盈止损：映射结构', () => {
    const params: ActionPlaceOrderParams = {
      instId: 'BTC-USDT-SWAP',
      tdMode: 'isolated',
      side: 'buy',
      ordType: 'limit',
      sz: '1',
      clOrdId: 'tpsl-001',
      px: '50000',
      attachAlgoOrds: [
        {
          clOrdId: 'tp-attach-001',
          tpTriggerPx: '55000',
          slTriggerPx: '48000',
        } as any,
      ],
    };
    const payload = (svc as any).mapToOKXPayload(params);

    assert.ok(Array.isArray(payload.attachAlgoOrds));
    assert.equal(payload.attachAlgoOrds.length, 1);

    const algo = payload.attachAlgoOrds[0];
    assert.equal(algo.attachAlgoClOrdId, 'tp-attach-001');
    assert.equal(algo.tpTriggerPx, '55000');
    assert.equal(algo.tpOrdPx, '55000');
    assert.equal(algo.tpTriggerPxType, 'last');
    assert.equal(algo.slTriggerPx, '48000');
    assert.equal(algo.slOrdPx, '48000');
    assert.equal(algo.slTriggerPxType, 'last');
  });

  it('追逐单：chaseType/chaseVal', () => {
    const params: ActionPlaceOrderParams = {
      instId: 'BTC-USDT-SWAP',
      tdMode: 'isolated',
      side: 'buy',
      ordType: 'chase',
      sz: '1',
      clOrdId: 'chase-001',
      chaseVal: '5',
    };
    const payload = (svc as any).mapToOKXPayload(params);

    assert.equal(payload.algoClOrdId, 'chase-001');
    assert.equal(payload.chaseType, 'distance');
    assert.equal(payload.chaseVal, '5');
  });

  it('移动止盈止损：activePx/callbackRatio/callbackSpread', () => {
    const params: ActionPlaceOrderParams = {
      instId: 'BTC-USDT-SWAP',
      tdMode: 'isolated',
      side: 'buy',
      ordType: 'move_order_stop',
      sz: '1',
      clOrdId: 'move-001',
      activePx: '60000',
      callbackRatio: '0.05',
      callbackSpread: '100',
    };
    const payload = (svc as any).mapToOKXPayload(params);

    assert.equal(payload.algoClOrdId, 'move-001');
    assert.equal(payload.activePx, '60000');
    assert.equal(payload.callbackRatio, '0.05');
    assert.equal(payload.callbackSpread, '100');
  });
});
