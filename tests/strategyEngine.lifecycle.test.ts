import assert from "node:assert/strict";
import test from "node:test";

import { StrategyEngine } from "../src/engine/StrategyEngine.ts";
import type { ModuleConfig } from "../src/types/strategy.ts";

test("StrategyEngine supports start/stop lifecycle for one instance key", () => {
  const type = "regression_noop";
  const configId = "cfg_lifecycle_1";
  const config: ModuleConfig = { id: configId, name: "lifecycle" };

  StrategyEngine.stop(type, undefined, configId);

  const firstStart = StrategyEngine.start(type, config, configId);
  assert.equal(firstStart, true);
  assert.equal(StrategyEngine.getStatus(type, configId).running, true);

  const secondStart = StrategyEngine.start(type, config, configId);
  assert.equal(secondStart, false);

  const stopped = StrategyEngine.stop(type, "test-stop", configId);
  assert.equal(stopped, true);
  assert.equal(StrategyEngine.getStatus(type, configId).running, false);
});

test("StrategyEngine getAllInstanceStatuses returns scoped instance ids", () => {
  const type = "regression_noop";
  const c1 = "cfg_scope_1";
  const c2 = "cfg_scope_2";

  StrategyEngine.stop(type, undefined, c1);
  StrategyEngine.stop(type, undefined, c2);

  StrategyEngine.start(type, { id: c1 }, c1);
  StrategyEngine.start(type, { id: c2 }, c2);

  const statuses = StrategyEngine.getAllInstanceStatuses(type);
  const ids = statuses.map((s) => s.id).filter(Boolean);
  assert.ok(ids.includes(c1));
  assert.ok(ids.includes(c2));

  StrategyEngine.stop(type, undefined, c1);
  StrategyEngine.stop(type, undefined, c2);
});
