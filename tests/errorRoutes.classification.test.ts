import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { registerErrorRoutes } from "../src/routes/modules/errorRoutes.ts";
import { ErrorMonitor } from "../src/services/errorMonitor.ts";
import { LogService } from "../src/services/logService.ts";
import { dbService } from "../src/services/dbService.ts";

test("frontend error report keeps USER/SYSTEM/API classification consistent", async () => {
  const originalSaveError = dbService.saveError.bind(dbService);
  (dbService as any).saveError = () => {};

  ErrorMonitor.clearErrors();
  LogService.getHistory().length = 0;

  const app = express();
  app.use(express.json());
  registerErrorRoutes(app, {
    ordersCache: {} as any,
    savingsPoller: {} as any,
    wsManager: {
      getLatestWsData: () => ({}),
    } as any,
    startAccountMonitoring: async () => {},
  });

  const server = app.listen(0);
  const { port } = server.address() as { port: number };

  try {
    const payload = {
      errors: [
        {
          type: "runtime",
          level: "high",
          errorClass: "SYSTEM",
          message: "system regression sample",
          url: "http://localhost/ui",
          userAgent: "node-test",
        },
        {
          type: "network",
          level: "medium",
          errorClass: "API",
          message: "api regression sample",
          url: "http://localhost/ui",
          userAgent: "node-test",
        },
        {
          type: "runtime",
          level: "low",
          errorClass: "USER",
          message: "user regression sample",
          url: "http://localhost/ui",
          userAgent: "node-test",
        },
      ],
    };

    const response = await fetch(`http://127.0.0.1:${port}/api/errors/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);

    const byMessage = new Map(ErrorMonitor.getAllErrors().map((e) => [e.message, e]));
    const logByMessage = new Map(LogService.getHistory().map((l) => [l.message, l]));

    const systemError = byMessage.get("system regression sample");
    const apiError = byMessage.get("api regression sample");
    const userError = byMessage.get("user regression sample");

    assert.ok(systemError);
    assert.ok(apiError);
    assert.ok(userError);

    assert.equal(systemError?.errorClass, "SYSTEM");
    assert.equal((systemError?.details as Record<string, unknown>)?.errorClass, "SYSTEM");
    assert.equal(apiError?.errorClass, "API");
    assert.equal((apiError?.details as Record<string, unknown>)?.errorClass, "API");
    assert.equal(userError?.errorClass, "USER");
    assert.equal((userError?.details as Record<string, unknown>)?.errorClass, "USER");

    const systemLog = Array.from(logByMessage.values()).find((l) =>
      l.message.includes("system regression sample"),
    );
    const apiLog = Array.from(logByMessage.values()).find((l) =>
      l.message.includes("api regression sample"),
    );
    const userLog = Array.from(logByMessage.values()).find((l) =>
      l.message.includes("user regression sample"),
    );

    assert.equal(systemLog?.category, "SYSTEM");
    assert.equal(apiLog?.category, "API");
    assert.equal(userLog?.category, "USER");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ErrorMonitor.clearErrors();
    LogService.getHistory().length = 0;
    (dbService as any).saveError = originalSaveError;
  }
});

