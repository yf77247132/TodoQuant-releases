import express, { type Application } from "express";
import http from "http";
import { WebSocketServer } from "ws";

export interface AppBootstrapContext {
  app: Application;
  server: http.Server;
  wss: WebSocketServer;
  port: number;
  host: string;
  allowedOriginSet: Set<string>;
}

export function createApp(port: number): AppBootstrapContext {
  const app = express();
  
  const safeEnv = process.env as Record<string, string | undefined>;
  const host = safeEnv.HOST || "0.0.0.0";
  const allowedOriginsRaw = safeEnv.ALLOWED_ORIGINS || 
    `http://localhost:${port},http://127.0.0.1:${port},http://localhost,http://127.0.0.1`;

  const allowedOrigins = allowedOriginsRaw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const allowedOriginSet = new Set(allowedOrigins);
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  return {
    app,
    server,
    wss,
    port,
    host,
    allowedOriginSet,
  };
}
