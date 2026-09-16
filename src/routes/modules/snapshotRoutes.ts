import type { Application } from 'express';
import type { OKXPosition } from '../../types/okx.ts';
import type { AccountBalances } from '../../types/monitorTypes.ts';
import { AccountMonitor } from '../../services/AccountMonitor.ts';
import { loadSavedConfig } from '../../services/configService.ts';
import { InstrumentService } from '../../services/instrumentService.ts';
import { LogService } from '../../services/logService.ts';
import { sendError, toError } from './shared.ts';
import type { ApiRoutesConfig } from './types.ts';
import { BINANCE_YELLOW } from '../../constants/colors.ts';

export function registerSnapshotRoutes(app: Application, config: ApiRoutesConfig): void {
  app.get("/api/instruments/search", (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.json({ ok: true, data: [] });
      }
      const results = InstrumentService.searchInstruments(query);
      res.json({ ok: true, data: results });
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });

  app.get("/api/snapshot", (req, res) => {
    try {
      const monitor = AccountMonitor.getInstance();
      const configData = loadSavedConfig();
      const accounts = configData.accounts || [];

      const allPositions: OKXPosition[] = [];
      const allAccounts: Array<AccountBalances & { _account: number }> = [];

      accounts.forEach((_acc, idx) => {
        const acc = _acc as unknown as Record<string, unknown>;
        const data = monitor.getAccountData(idx);
        const accountSnapshot: Record<string, unknown> = { _account: idx };
        if (acc.id) accountSnapshot._accountId = acc.id;

        if (data && data.balances) {
          Object.assign(accountSnapshot, data.balances);
        }

        const savingsState = config.savingsPoller.getSavingsState(idx);
        if (savingsState) {
          accountSnapshot.savingsUsdt = savingsState.USDT;
          accountSnapshot.savingsUsdc = savingsState.USDC;
        }
        const assetValuation = config.savingsPoller.getAssetValuationState(idx);
        if (assetValuation) {
          accountSnapshot.valuation = assetValuation;
        }

        allAccounts.push(accountSnapshot as AccountBalances & { _account: number });

        if (data && data.positions) {
          allPositions.push(...data.positions.map(p => ({
            ...p,
            _account: idx,
            ...(acc.id ? { _accountId: acc.id } : {})
          })));
        }
      });

      const accountNames: Record<number, string> = {};
      const accountColors: Record<number, string> = {};
      accounts.forEach((acc: any, idx: number) => {
        accountNames[idx] = acc.name;
        accountColors[idx] = acc.color || BINANCE_YELLOW;
      });

      res.json({ ok: true, positions: allPositions, accounts: allAccounts, accountNames, accountColors });
    } catch (e: unknown) {
      const error = toError(e);
      LogService.logKey('SYSTEM', 'routeError', { route: req.path, msg: error.message }, 'error');
      sendError(res, e);
    }
  });
}
