import { type WebSocketServer, type WebSocket } from "ws";
import { loadSavedConfig } from "../../services/configService.ts";
import { StrategyEngine } from "../../engine/StrategyEngine.ts";
import { type OKXWebSocketManager } from "../ws/wsManager.ts";
import { type SavingsPoller } from "../../services/savingsPoller.ts";

interface SetupWebSocketOptions {
  wss: WebSocketServer;
  wsManager: OKXWebSocketManager;
  savingsPoller: SavingsPoller;
}

const FRONTEND_HEARTBEAT_MS = 30_000;
let heartbeatTimer: NodeJS.Timeout | null = null;

const isAlive = (ws: WebSocket) => (ws as WebSocket & { isAlive?: boolean }).isAlive !== false;
const setAlive = (ws: WebSocket, v: boolean) => { (ws as WebSocket & { isAlive?: boolean }).isAlive = v; };

export function setupWebSocket(options: SetupWebSocketOptions): void {
  const { wss, wsManager, savingsPoller } = options;

  wss.on("connection", async (ws) => {
    setAlive(ws, true);
    ws.on("pong", () => setAlive(ws, true));

    try {
      savingsPoller.pushAllToClient(ws);

      const wsStatus = wsManager.getConnectionStatus();
      Object.entries(wsStatus || {}).forEach(([acc, connected]) => {
        ws.send(JSON.stringify({ type: "ws_status", account: Number(acc), connected }));
      });

      const cfg = await loadSavedConfig();
      const systemTz = cfg.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      ws.send(JSON.stringify({ type: "system_info", timezone: systemTz }));

      ["trader", "amend", "margin", "diy", "cancel", "close"].forEach((type) => {
        ws.send(
          JSON.stringify({
            type: "scriptStatus",
            script: type,
            running: StrategyEngine.getStatus(type).running,
          })
        );
      });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error("[WS] connection handler error:", err.message);
    }

  });

  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      wss.clients.forEach((ws) => {
        if (!isAlive(ws)) {
          ws.terminate();
          return;
        }
        setAlive(ws, false);
        ws.ping();
      });
    }, FRONTEND_HEARTBEAT_MS);
    heartbeatTimer.unref?.();
  }
}
