import express, { type Application } from "express";

export function setupMiddleware(app: Application, allowedOriginSet: Set<string>): void {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    
    const isDev = process.env.NODE_ENV !== "production";
    const isAllowed = !origin || allowedOriginSet.has(origin) || isDev || origin.includes("run.app") || origin.includes("aistudio");

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
}
