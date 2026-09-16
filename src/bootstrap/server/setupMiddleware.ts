import express, { type Application } from "express";
import { trackRequestStart, trackRequestEnd } from "../../services/diagnosticsService.ts";
import { isLoopbackRequest, allowRemoteAccess } from "../../lib/networkUtils.ts";

export function setupMiddleware(app: Application, allowedOriginSet: Set<string>): void {
  const WEBHOOK_PATH_PREFIXES = ["/api/webhook/", "/api/webhooks/"];
  const TV_WEBHOOK_PATH_PREFIXES = ["/api/webhook/tradingview", "/api/webhooks/tradingview"];
  app.use((req, res, next) => {
    if (allowRemoteAccess()) return next();

    if (req.headers["cf-connecting-ip"]
      && !TV_WEBHOOK_PATH_PREFIXES.some((p) => req.path.startsWith(p))) {
      console.warn(`[Access] Rejected tunnel request to non-webhook path: ${req.method} ${req.path}`);
      return res.status(403).json({ ok: false, error: "Forbidden: tunnel access is limited to TradingView webhook" });
    }

    if (WEBHOOK_PATH_PREFIXES.some((p) => req.path.startsWith(p))) return next();
    if (isLoopbackRequest(req)) return next();

    console.warn(`[Access] Rejected non-loopback request: ${req.method} ${req.path} from ${req.socket?.remoteAddress || 'unknown'}`);
    return res.status(403).json({ ok: false, error: "Forbidden: 仅允许本机访问（如需远程访问请设置 OKTS_ALLOW_REMOTE=1）" });
  });

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

  const CSP = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self' 'unsafe-inline' https://s3.tradingview.com https://*.tradingview.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss: https://*.tradingview.com",
    "frame-src https://*.tradingview.com",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "form-action 'self'",
  ].join("; ");

  app.use((_req, res, next) => {
    res.header("Content-Security-Policy", CSP);
    res.header("X-Content-Type-Options", "nosniff");
    res.header("Referrer-Policy", "no-referrer");
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
