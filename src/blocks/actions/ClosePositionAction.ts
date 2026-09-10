
import { OKXTradeService } from "../../services/okxTradeService.ts";
import { SymbolUtils } from "../../lib/symbolUtils.ts";
import { LogService } from "../../services/logService.ts";
import { AccountMonitor } from "../../services/AccountMonitor.ts";
import { CancelOrderAction } from "./CancelOrderAction.ts";
import { ClosePositionActionConfig, CancelOrderActionConfig } from "../../types/blocks.ts";
import type { ActionClosePositionParams } from "../../types/blocks.ts";
import type { Position } from "../../types/trading.ts";
import { translateCloseDetail } from "../../lib/logTemplates.ts";
import { formatApiError } from "../../lib/apiErrorFormatter.ts";
import { invalidateHistoryCachesForAction } from "../../services/historyCacheService.ts";

export class ClosePositionAction {
  private static readonly CANCEL_ORDER_TYPES = [
    'limit', 'post_only', 'limit_maker',
    'trigger', 'conditional', 'oco', 'chase', 'move_order_stop',
    'iceberg', 'twap', 'trailing_stop',
  ];

  private static async cancelPendingForInstIds(
    tradeService: OKXTradeService,
    configId: string,
    instIds: string[],
    shouldContinue?: () => boolean,
  ): Promise<void> {
    for (const cid of instIds) {
      if (shouldContinue && !shouldContinue()) break;
      try {
        await CancelOrderAction.execute(
          {
            id: configId,
            inst_id: cid,
            cancel_inst_id: cid,
            cancel_test_mode: false,
            test_mode: false,
            cancel_order_types: ClosePositionAction.CANCEL_ORDER_TYPES,
          } as CancelOrderActionConfig,
          tradeService,
          shouldContinue,
        );
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        LogService.logKey("close", 'close.cancel.pending.failed', { instId: cid, msg: err.message }, 'warn', configId);
      }
    }
  }

  private static filterByFormula<T>(items: T[], formula: string, getValue: (item: T) => number): T[] {
    const match = formula.match(/^([<>=≤≥]+)\s*([\d.-]+)$/);
    if (!match) return items;

    const [, operator, valueStr] = match;
    const threshold = parseFloat(valueStr);
    if (!Number.isFinite(threshold)) return items;

    return items.filter(item => {
      const val = getValue(item);
      switch (operator) {
        case '>': return val > threshold;
        case '<': return val < threshold;
        case '=': return val === threshold;
        case '≥': case '>=': return val >= threshold;
        case '≤': case '<=': return val <= threshold;
        default: return true;
      }
    });
  }

  static async execute(config: ClosePositionActionConfig, tradeService: OKXTradeService, shouldContinue?: () => boolean, triggeredInstId?: string) {
    const accountIdx = tradeService.accountIdx;
    const instId = (config.inst_id || config.close_inst_id || "").trim() || (triggeredInstId || "").trim();
    const testMode = config.close_test_mode === true || config.test_mode === true;
    const configId = config.id || '';

    try {
      const monitor = AccountMonitor.getInstance();
      let positions: any[] = [];

      if (!testMode) {
        try {
          await monitor.syncPositions(accountIdx);
        } catch (err: unknown) {
          LogService.logKey("close", 'close.sync.failed', { msg: err instanceof Error ? err.message : String(err) }, 'warn', configId);
        }
      }

      const accountData = monitor.getAccountData(accountIdx);
      const allPositions = accountData?.positions || [];

      if (instId) {
        positions = allPositions.filter((p: Position) => SymbolUtils.isSameSymbol(p.instId, instId) && parseFloat(p.pos || '0') !== 0);
      } else {
        positions = allPositions.filter((p: Position) => parseFloat(p.pos || '0') !== 0);
      }

      if (positions.length === 0 && typeof (tradeService as any).getPositions === 'function') {
        try {
          const remotePositions = await (tradeService as any).getPositions(instId || undefined);
          let fetched = Array.isArray(remotePositions) ? remotePositions : [];
          if (instId) {
            fetched = fetched.filter((p: Position) => SymbolUtils.isSameSymbol(p.instId, instId) && parseFloat(p.pos || '0') !== 0);
          } else {
            fetched = fetched.filter((p: Position) => parseFloat(p.pos || '0') !== 0);
          }
          positions = fetched;
        } catch (err: unknown) {
          LogService.logKey("close", 'close.query.failed', { instId, msg: err instanceof Error ? err.message : String(err) }, 'warn', configId);
        }
      }

      if (config.mgn_mode || config.close_mgn_mode) {
        const targetMode = config.mgn_mode || config.close_mgn_mode;
        positions = positions.filter((p: Position) => p.mgnMode === targetMode);
      }

      if (config.pos_side || config.close_pos_side) {
        const targetSide = config.pos_side || config.close_pos_side;
        positions = positions.filter((p: Position) => p.posSide === targetSide);
      }

      const uplFilter = config.upl_filter || config.close_upl_filter;
      if (uplFilter) {
        positions = ClosePositionAction.filterByFormula(positions, uplFilter, (p: Position) => parseFloat(p.upl || '0'));
      }

      const uplRatioFilter = config.upl_ratio_filter || config.close_upl_ratio_filter;
      if (uplRatioFilter) {
        const cleanFilter = uplRatioFilter.replace(/%/g, '');
        positions = ClosePositionAction.filterByFormula(positions, cleanFilter, (p: Position) => parseFloat(p.uplRatio || '0') * 100);
      }

      if (positions.length === 0) {
        LogService.logKey("close", 'close.no.positions', {}, 'info', configId);
        return;
      }

      let totalSuccess = 0;
      let totalFail = 0;
      const closeSuccessInstIds = new Set<string>();

      for (let i = 0; i < positions.length; i++) {
        if (shouldContinue && !shouldContinue()) {
          LogService.logKey("close", 'action.stop.signal', { op: '平仓' }, 'info', configId);
          break;
        }

        if (i > 0) {
          await new Promise(r => setTimeout(r, 200));
        }

        const pos = positions[i];
        try {
          if (testMode) {
            totalSuccess++;
            LogService.logKey("close", 'close.position.sim', { num: totalSuccess + totalFail, detail: ClosePositionAction.formatPositionDetails(pos) }, 'info', configId);
          } else {
            const closeParams: ActionClosePositionParams = {
              instId: pos.instId,
              mgnMode: pos.mgnMode,
              posSide: pos.posSide,
              ccy: pos.ccy,
              autoCxl: true,
            };
            const res = await tradeService.closePosition(closeParams);

            if (res && (res.code === "0" || res.code === "2")) {
              const itemData = res.data?.[0] || {};
              const sCode = itemData.sCode;
              if (sCode === "0" || sCode === undefined) {
                totalSuccess++;
                closeSuccessInstIds.add(pos.instId);
                LogService.logKey("close", 'close.position.ok', { num: totalSuccess + totalFail, detail: ClosePositionAction.formatPositionDetails(pos) }, 'info', configId);

                if (config.reverse && !testMode) {
                  try {
                    const isLong = pos.posSide === 'long' || (pos.posSide === 'net' && parseFloat(pos.pos || '0') > 0);
                    const side = isLong ? 'sell' : 'buy';
                    const openParams: Record<string, string> = {
                      instId: pos.instId,
                      tdMode: pos.mgnMode,
                      side,
                      ordType: 'market',
                      sz: pos.pos,
                    };
                    if (pos.posSide && pos.posSide !== 'net') {
                      openParams.posSide = pos.posSide === 'long' ? 'short' : 'long';
                    }
                    if (pos.ccy) openParams.ccy = pos.ccy;

                    const openRes = await tradeService.placeOrder(openParams);
                    if (openRes && (openRes.code === '0' || openRes.code === '2')) {
                      const openSCode = openRes.data?.[0]?.sCode;
                      if (openSCode === '0' || openSCode === undefined) {
                        LogService.logKey("close", 'close.reverse.ok', { instId: pos.instId, dir: isLong ? 'short' as const : 'long' as const }, 'info', configId);
                      } else {
                        LogService.logKey("close", 'close.reverse.fail', { detail: pos.instId, reason: openRes.data?.[0]?.sMsg || `sCode=${openSCode}` }, 'warn', configId);
                      }
                    } else {
                      LogService.logKey("close", 'close.reverse.fail', { detail: pos.instId, reason: formatApiError(openRes) }, 'warn', configId);
                    }
                  } catch (reverseErr: unknown) {
                    const errMsg = reverseErr instanceof Error ? reverseErr.message : String(reverseErr);
                    LogService.logKey("close", 'close.reverse.fail', { detail: pos.instId, reason: errMsg }, 'error', configId);
                  }
                }
              } else {
                totalFail++;
                LogService.logKey("close", 'close.position.fail', { num: totalSuccess + totalFail, reason: itemData.sMsg || formatApiError(res) || `item.sCode=${String(sCode)}`, params: translateCloseDetail(ClosePositionAction.formatPositionDetails(pos)) }, 'warn', configId);
              }
            } else {
              totalFail++;
              LogService.logKey("close", 'close.position.fail', { num: totalSuccess + totalFail, reason: formatApiError(res), params: translateCloseDetail(ClosePositionAction.formatPositionDetails(pos)) }, 'warn', configId);
            }
          }
        } catch (err: unknown) {
          const caughtErr = err instanceof Error ? err : new Error(String(err));
          totalFail++;
          LogService.logKey("close", 'close.position.exception', { num: totalSuccess + totalFail, reason: caughtErr.message || String(err), params: translateCloseDetail(ClosePositionAction.formatPositionDetails(pos)) }, 'error', configId);
        }
      }

      if (!testMode && totalSuccess > 0) {
        const accountId = monitor.getAccountData(accountIdx)?.accountId || '';
        invalidateHistoryCachesForAction(accountId);
        if (accountId) {
          await monitor.triggerSyncByAccountId(accountId);
        }
      }

      if (config.cancel_pending && !testMode && closeSuccessInstIds.size > 0) {
        await ClosePositionAction.cancelPendingForInstIds(
          tradeService,
          configId,
          Array.from(closeSuccessInstIds),
          shouldContinue,
        );
      }

      LogService.logKey("close", 'action.complete', { op: '平仓', success: totalSuccess, fail: totalFail }, 'info', configId);
    } catch (e: unknown) {
      const caughtErr = e instanceof Error ? e : new Error(String(e));
      LogService.logKey("close", 'action.exception', { msg: caughtErr.message || String(e) }, 'error', configId);
    }
  }

  private static formatPositionDetails(position: Position): string {
    const instId = position.instId || '-';
    const pos = position.pos || '0';
    const posSideMap: Record<string, string> = { long: '双向持仓-多仓', short: '双向持仓-空仓', net: '单向持仓' };
    const posSideText = posSideMap[position.posSide] || position.posSide || '-';
    const mgnModeMap: Record<string, string> = { cross: '全仓', isolated: '逐仓', cash: '现货' };
    const mgnModeText = mgnModeMap[position.mgnMode] || position.mgnMode || '-';
    const avgPx = position.avgPx ? parseFloat(position.avgPx).toFixed(4) : '-';
    const upl = position.upl ? parseFloat(position.upl).toFixed(4) : '0';
    const uplRatio = position.uplRatio ? (parseFloat(position.uplRatio) * 100).toFixed(2) : '-';

    return `交易对=${instId}, 方向=${posSideText}, 仓位模式=${mgnModeText}, 持仓数量=${pos}, 开仓均价=${avgPx}, 收益额=${upl} (${uplRatio}%)`;
  }
}
