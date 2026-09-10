import assert from "node:assert/strict";
import test from "node:test";

import { DiyEngine } from "../src/engine/diy/DiyEngine.ts";

test("DiyEngine requestTick serializes re-entrant calls", async () => {
  const engine = DiyEngine.getInstance() as any;

  const originalTick = engine.tick;
  const originalIsTicking = engine.isTicking;
  const originalPendingTick = engine.pendingTick;

  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  engine.tick = () => {
    calls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    if (calls === 1) {
      engine.requestTick();
    }
    inFlight -= 1;
  };

  engine.isTicking = false;
  engine.pendingTick = false;
  engine.requestTick();

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls, 2);
  assert.equal(maxInFlight, 1);

  engine.tick = originalTick;
  engine.isTicking = originalIsTicking;
  engine.pendingTick = originalPendingTick;
});

test("DiyEngine stopStrategy clears execution guards and run token state", async () => {
  const engine = DiyEngine.getInstance() as any;
  const strategyId = "regression_diy_stop_1";

  engine.runningStrategies.set(strategyId, { id: strategyId, name: "demo", running: true });
  engine.executingStrategies.add(strategyId);
  engine.lastTriggeredMap.set(strategyId, Date.now());
  engine.pendingSignals.set(strategyId, { receivedAt: Date.now(), payload: { v: 1 } });
  engine.strategyRunTokens.set(strategyId, 7);

  await engine.stopStrategy(strategyId);

  assert.equal(engine.runningStrategies.has(strategyId), false);
  assert.equal(engine.executingStrategies.has(strategyId), false);
  assert.equal(engine.lastTriggeredMap.has(strategyId), false);
  assert.equal(engine.pendingSignals.has(strategyId), false);
  assert.equal(engine.strategyRunTokens.get(strategyId), 8);
});
