import assert from "node:assert/strict";
import test from "node:test";

import { DiyEngine } from "../src/engine/diy/DiyEngine.ts";
import { dbService } from "../src/services/dbService.ts";
import type { DIYStrategy } from "../src/types/diy.ts";

function makeStrategy(overrides: Partial<DIYStrategy>): DIYStrategy {
  return {
    id: "persist_case_1",
    name: "persist-case",
    conditionTemplateId: "tpl_1",
    actions: [],
    running: true,
    testMode: true,
    createdAt: Date.now(),
    triggerCount: 0,
    lastTriggered: 0,
    ...overrides,
  };
}

test("DiyEngine batches strategy persist within flush window", async () => {
  const engine = DiyEngine.getInstance() as any;
  const originalGetConfig = dbService.getConfig;
  const originalSetConfig = dbService.setConfig;

  let persistCalls = 0;
  let latestPayload = "[]";

  const base = makeStrategy({});
  dbService.getConfig = ((key: string) => {
    if (key === "diy_strategies") return JSON.stringify([base]);
    return null;
  }) as typeof dbService.getConfig;

  dbService.setConfig = ((key: string, value: unknown) => {
    if (key !== "diy_strategies") return;
    persistCalls += 1;
    latestPayload = String(value);
  }) as typeof dbService.setConfig;

  engine.persistStrategyData(makeStrategy({ triggerCount: 1, lastTriggered: 1 }));
  engine.persistStrategyData(makeStrategy({ triggerCount: 2, lastTriggered: 2 }));

  await new Promise((resolve) => setTimeout(resolve, 900));

  assert.equal(persistCalls, 1);
  const persisted = JSON.parse(latestPayload) as DIYStrategy[];
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].triggerCount, 2);
  assert.equal(persisted[0].lastTriggered, 2);

  dbService.getConfig = originalGetConfig;
  dbService.setConfig = originalSetConfig;
});
