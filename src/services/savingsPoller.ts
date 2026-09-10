import { OKXTradeService } from './okxTradeService.ts';
import { OKXWebSocketManager } from './wsManager.ts';
import { loadSavedConfig } from './configService.ts';
import { AccountMonitor } from './AccountMonitor.ts';
import { LogService } from './logService.ts';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from './errorMonitor.ts';
import { WebSocket, WebSocketServer } from 'ws';
import { Exchange, ExchangeAccount } from '../types/core.ts';
import { BinanceSdkTradeService } from './binanceSdkTradeService.ts';

interface SavingsState {
  USDT: string;
  USDC: string;
}

interface AssetValuation {
  totalBal: string;
  funding: string;
  trading: string;
  earn: string;
}

interface SavingsPollerConfig {
  wss: WebSocketServer;
}

export class SavingsPoller {
  private savingsState: Record<number, SavingsState> = {};
  private assetValuationState: Record<number, AssetValuation> = {};
  private services: Record<number, OKXTradeService | BinanceSdkTradeService> = {};
  private pollInterval: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(private config: SavingsPollerConfig) {}

  private getService(acc: ExchangeAccount, idx: number): OKXTradeService | BinanceSdkTradeService {
    if (!this.services[idx]) {
      if (acc.exchange === Exchange.BINANCE) {
        this.services[idx] = new BinanceSdkTradeService({
          apiKey: acc.apiKey || "",
          secretKey: acc.secretKey || "",
          accountIdx: idx,
          accountName: acc.name
        });
      } else {
        this.services[idx] = new OKXTradeService({
          apiKey: acc.apiKey || "",
          secretKey: acc.secretKey || "",
          passphrase: acc.passphrase || "",
          accountIdx: idx,
          accountId: acc.id,
          accountName: acc.name
        });
      }
    }
    return this.services[idx];
  }

  getSavingsState(accountIdx: number): SavingsState | undefined {
    return this.savingsState[accountIdx];
  }

  getAssetValuationState(accountIdx: number): AssetValuation | undefined {
    return this.assetValuationState[accountIdx];
  }

  start(): void {
    if (this.pollInterval) return;

    const poll = async () => {
      if (this.polling) return;
      this.polling = true;

      const config = loadSavedConfig();
      const accounts = config.accounts || [];

      try {
        for (let idx = 0; idx < accounts.length; idx++) {
          const acc = accounts[idx];
          const isPermanentlyStopped = OKXWebSocketManager.instance?.isPermanentlyStopped(idx);
          const isMonitorStopped = AccountMonitor.getInstance().isAccountStopped(idx);
          if (!acc.apiKey || !acc.secretKey || isPermanentlyStopped || isMonitorStopped) continue;
          if (acc.exchange !== Exchange.BINANCE && !acc.passphrase) continue;

          const service = this.getService(acc, idx);

          try {
            await service.syncTime();
            const [usdt, usdc] = await Promise.all([
              service.getSavingsBalance("USDT"),
              service.getSavingsBalance("USDC")
            ]);

            if (usdt !== null || usdc !== null) {
              const balances: SavingsState = {
                USDT: usdt || "0",
                USDC: usdc || "0"
              };
              this.savingsState[idx] = balances;
              this.pushSavingsUpdate(idx, balances);
            }

            const rawValuation = await service.getAssetValuation("USDT") as any;
            if (rawValuation) {
              const valuation: AssetValuation = {
                totalBal: rawValuation.totalEq || rawValuation.totalBal || "0",
                funding: rawValuation.details?.funding || "0",
                trading: rawValuation.details?.trading || "0",
                earn: rawValuation.details?.earn || "0"
              };
              this.assetValuationState[idx] = valuation;
              this.pushAssetValuationUpdate(idx, valuation);
            }
          } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            LogService.logKey("SYSTEM", 'savingsPoller.pollFailed', { accountIdx: idx, msg: error.message }, 'error');
            ErrorMonitor.captureError(error, ErrorLevel.LOW, ErrorCategory.SYSTEM);
          }
        }
      } finally {
        this.polling = false;
      }
    };

    poll();
    this.pollInterval = setInterval(poll, 10000);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.polling = false;
    this.services = {};
  }

  reset(): void {
    this.savingsState = {};
    this.assetValuationState = {};
    this.services = {};
    this.polling = false;
  }

  private pushSavingsUpdate(account: number, balances: SavingsState | null): void {
    const wsManager = globalThis.OKX_WS_MANAGER;
    const payload = {
      type: "savings",
      account,
      balances: balances ?? { USDT: "0", USDC: "0" },
      ok: balances !== null,
    };

    this.broadcastPayload(payload, wsManager);
  }

  private pushAssetValuationUpdate(account: number, valuation: AssetValuation | null): void {
    const wsManager = globalThis.OKX_WS_MANAGER;
    const payload = {
      type: "asset_valuation",
      account,
      valuation: valuation ?? {},
      ok: valuation !== null,
    };

    this.broadcastPayload(payload, wsManager);
  }

  private broadcastPayload(payload: unknown, wsManager?: { broadcast?: (payload: unknown) => void }): void {
    if (wsManager && typeof wsManager.broadcast === 'function') {
      wsManager.broadcast(payload);
      return;
    }

    const serialized = JSON.stringify(payload);
    this.config.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 4 * 1024 * 1024) {
        client.send(serialized);
      }
    });
  }

  pushAllToClient(client: WebSocket): void {
    Object.keys(this.savingsState)
      .map(Number)
      .filter(k => !isNaN(k) && this.savingsState[k])
      .forEach(k => this.pushSavingsUpdateToClient(client, k, this.savingsState[k]));

    Object.keys(this.assetValuationState)
      .map(Number)
      .filter(k => !isNaN(k) && this.assetValuationState[k])
      .forEach(k => this.pushAssetValuationUpdateToClient(client, k, this.assetValuationState[k]));
  }

  private pushSavingsUpdateToClient(client: WebSocket, account: number, balances: SavingsState): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: "savings",
        account,
        balances,
        ok: true,
      }));
    }
  }

  private pushAssetValuationUpdateToClient(client: WebSocket, account: number, valuation: AssetValuation): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: "asset_valuation",
        account,
        valuation,
        ok: true,
      }));
    }
  }
}
