import express, { type Application } from "express";
import { trackRequestStart, trackRequestEnd } from "../../services/diagnosticsService.ts";

export function setupMiddleware(app: Application, allowedOriginSet: Set<string>): void {
  const RUN_APP_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.run\.app$/;
  const LOCAL_DEV_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
  const isDev = process.env.NODE_ENV !== "production";

  app.use((req, res, next) => {
    const origin = req.headers.origin;

    const isAllowed = !origin
      || allowedOriginSet.has(origin)
      || RUN_APP_ORIGIN_RE.test(origin)
      || (isDev && (origin === "null" || LOCAL_DEV_ORIGIN_RE.test(origin)));

    if (isAllowed) {
      if (origin) {
        res.header("Access-Control-Allow-Origin", origin);
      } else if (isDev) {
        res.header("Access-Control-Allow-Origin", "*");
      }
      res.header("Vary", "Origin");
    } else {
      console.warn(`[CORS] Rejected origin: ${origin}`);
      return res.status(403).json({ ok: false, error: "Origin not allowed" });
    }
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, X-Master-Key, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
    res.header("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }
    next();
  });

  app.use("/api/webhooks/tradingview", express.text({ type: "*/*" }));
  app.use("/api/webhook/tradingview", express.text({ type: "*/*" }));
  app.use(express.json({ limit: '5mb' }));

  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    const id = trackRequestStart(req.method, req.path, req.url.includes("?") ? req.url.split("?")[1] : undefined);
    const finalize = () => trackRequestEnd(id);
    res.on("finish", finalize);
    res.on("close", finalize);
    next();
  });
}
