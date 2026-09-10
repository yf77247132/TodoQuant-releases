import { LogService } from "../../services/logService.ts";
import { AddMarginActionConfig, TestPosition } from "../../types/blocks.ts";
import { OKXTradeService } from "../../services/okxTradeService.ts";
import type { AccountDetail } from "../../types/trading.ts";

export class AddMarginAction {
  static async execute(config: AddMarginActionConfig, tradeService: OKXTradeService, _riskyPositions: TestPosition[], configId?: string) {
    const redeemAmt = parseFloat(config.margin_guard_redeem_amt || "5");
    const testMode = config.margin_test_mode === true || config.test_mode === true;
    const paymentAccount = config.margin_payment_account || "savings";
    const toAccountRaw = config.margin_to_account || "18";
    
    const isBinance = (tradeService as any)?.exchangeType === "BINANCE";

    const toAccount = (isBinance && toAccountRaw === "18") ? "SPOT" : toAccountRaw;

    const getDestLabel = (val: string) => {
      if (isBinance) {
        const labels: Record<string, string> = {
          "SPOT": "现货账户",
          "MARGIN": "杠杆全仓",
          "USDT_FUTURE": "U本位合约",
          "COIN_FUTURE": "币本位合约",
          "FUNDING": "资金账户",
          "18": "现货账户"
        };
        return labels[val] || val;
      }
      return val === "18" ? "交易账户" : val === "6" ? "资金账户" : val;
    };

    const destLabel = getDestLabel(toAccount);

    if (!Number.isFinite(redeemAmt) || redeemAmt <= 0) {
      LogService.logKey("margin", 'margin.validation.amount', {}, 'error', configId);
      return;
    }

    try {
      if (testMode) {
        const modeText = paymentAccount === "funding" ? "从资金账户划转" : "从赚币赎回并划转";
        LogService.logKey("margin", 'margin.sim.transfer', { mode: modeText, amt: redeemAmt, dest: destLabel }, 'info', configId);
      } else {
        if (paymentAccount === "funding") {
          LogService.logKey("margin", 'margin.real.transfer.start', { amt: redeemAmt, dest: destLabel }, 'info', configId);
          const okTransfer = await tradeService.transferAsset("USDT", redeemAmt.toString(), "6", toAccount);
          if (okTransfer === true) {
            LogService.logKey("margin", 'margin.transfer.success', {}, 'info', configId);
          } else {
            LogService.logKey("margin", 'margin.transfer.fail.check', {}, 'error', configId);
          }
        } else {
          LogService.logKey("margin", 'margin.real.redeem.start', { amt: redeemAmt }, 'info', configId);
          const okRedeem = await tradeService.redeemSavings("USDT", redeemAmt.toString());
          if (okRedeem === true) {
            LogService.logKey("margin", 'margin.redeem.success', { dest: destLabel }, 'info', configId);
            let balanceReady = false;
            for (let attempt = 0; attempt < 3; attempt++) {
              const backoff = 500 * Math.pow(2, attempt);
              await new Promise(r => setTimeout(r, backoff));
              try {
                const balance = await tradeService.getAccountBalance("USDT") as any;
                if (balance && Array.isArray(balance.details)) {
                  const usdtDetail = balance.details.find((d: AccountDetail) => d.ccy === "USDT");
                  const availBal = usdtDetail ? parseFloat(usdtDetail.availBal || "0") : 0;
                  if (availBal >= redeemAmt) {
                    balanceReady = true;
                    break;
                  }
                }
              } catch {
              }
            }
            if (balanceReady) {
              const okTransfer = await tradeService.transferAsset("USDT", redeemAmt.toString(), "6", toAccount);
              if (okTransfer === true) {
                LogService.logKey("margin", 'margin.transfer.success', {}, 'info', configId);
              } else {
                LogService.logKey("margin", 'margin.transfer.fail.check2', {}, 'error', configId);
              }
            } else {
              LogService.logKey("margin", 'margin.transfer.insufficient', { amt: redeemAmt }, 'error', configId);
            }
          } else {
            LogService.logKey("margin", 'margin.redeem.fail', {}, 'error', configId);
          }
        }
      }
    } catch (e: unknown) {
      const error = e as Error;
      LogService.logKey("margin", 'action.exception', { msg: error.message || String(e) }, 'error', configId);
    }
  }
}
