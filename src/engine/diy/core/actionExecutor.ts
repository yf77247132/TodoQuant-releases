import { LogService } from '../../../services/logService.ts';
import { ErrorMonitor, ErrorLevel, ErrorCategory } from '../../../services/errorMonitor.ts';
import { AccountMonitor } from '../../../services/AccountMonitor.ts';
import { calculateLiquidationDistance } from '../../../lib/positionUtils.ts';
import { EmailService } from '../../../services/emailService.ts';
import { sendPcNotification } from '../../../services/electronBridge.ts';
import { OKXWebSocketManager } from '../../../bootstrap/ws/wsManager.ts';
import { StrategyEngine } from '../../StrategyEngine.ts';
import { PlaceOrderAction } from '../../../blocks/actions/PlaceOrderAction.ts';
import { AmendOrderAction } from '../../../blocks/actions/AmendOrderAction.ts';
import { CancelOrderAction } from '../../../blocks/actions/CancelOrderAction.ts';
import { ClosePositionAction } from '../../../blocks/actions/ClosePositionAction.ts';
import { AddMarginAction } from '../../../blocks/actions/AddMarginAction.ts';
import { DIYStrategy, ActionBlock, ConditionTemplate } from '../../../types/diy.ts';
import { AppConfig } from '../../../types/core.ts';
import { OKXPosition } from '../../../types/okx.ts';

const ACTION_TYPE_LABELS_ZH: Record<string, string> = {
  place_order: '下单模块',
  amend_order: '改单模块',
  cancel_order: '撤单模块',
  close_pos: '平仓模块',
  prevent_margin_risk: '转账模块',
  stop_strategy: '停止策略',
  notify: '通知',
  transfer: '划转',
};
const ACTION_TYPE_LABELS_EN: Record<string, string> = {
  place_order: 'Place',
  amend_order: 'Amend',
  cancel_order: 'Cancel',
  close_pos: 'Close',
  prevent_margin_risk: 'Transfer',
  stop_strategy: 'Stop Strategy',
  notify: 'Notify',
  transfer: 'Transfer',
};

export interface ActionExecutorDeps {
  executingStrategies: Set<string>;
  runningStrategies: Map<string, DIYStrategy>;
  conditionTemplates: Map<string, ConditionTemplate>;
  userTimezone: string | null;
  locale: string;
  isStrategyRunActive: (strategyId: string, token: number) => boolean;
  stopStrategy: (strategyId: string) => Promise<void>;
  persistStrategyStatus: (strategyId: string, running: boolean) => void;
}

function buildNotifyContent(
  strategy: DIYStrategy,
  strategyId: string,
  deps: ActionExecutorDeps,
  appConfig: AppConfig
): string {
  const isEn = deps.locale === 'en-US';
  const actionLabels = isEn ? ACTION_TYPE_LABELS_EN : ACTION_TYPE_LABELS_ZH;
  const template = deps.conditionTemplates.get(String(strategy.conditionTemplateId));
  const condName = template?.name || (isEn ? 'Unknown' : '未知条件');
  const testModeStr = isEn ? (strategy.testMode ? 'On' : 'Off') : (strategy.testMode ? '开' : '关');
  const actionDetails = strategy.actions.map((a) => {
    const label = actionLabels[a.type] || a.type;

    let value = isEn ? 'Unknown' : '未知配置';
    if (['notify', 'stop_strategy'].includes(a.type)) {
      value = a.type === 'notify' ? (a.params?.email || (isEn ? 'Admin' : '管理员')) : (a.params?.targetId || (isEn ? 'Not set' : '未指定'));
    } else {
      const configs = (
        a.type === 'place_order' ? appConfig.place_configs
          : a.type === 'amend_order' ? appConfig.amend_configs
            : a.type === 'cancel_order' ? appConfig.cancel_configs
              : a.type === 'close_pos' ? appConfig.close_configs
                : a.type === 'prevent_margin_risk' ? appConfig.margin_configs
                  : []
      ) || [];
      const target = (configs as Record<string, unknown>[]).find((c: Record<string, unknown>) => c.id === a.targetConfigId);
      value = target?.name || (isEn ? 'Unknown' : '未知配置');
    }
    return `${label}: ${value}`;
  }).join('\n');

  const activeTz = deps.userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  const localeForTime = isEn ? 'en-US' : 'zh-CN';
  const triggerTime = new Date().toLocaleString(localeForTime, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: activeTz
  }).replace(/\

  if (isEn) {
    return `Your DIY strategy "${strategy.name}" (ID: ${strategyId}) has been triggered.\n\n`
      + `Strategy details:\n`
      + `Condition: ${condName}\n`
      + `Test: ${testModeStr}\n`
      + `${actionDetails}\n\n`
      + `Time: ${triggerTime}`;
  }
  return `您的 DIY 策略"${strategy.name}"(ID: ${strategyId}) 已触发。\n\n`
    + `策略详情:\n`
    + `条件: ${condName}\n`
    + `测试: ${testModeStr}\n`
    + `${actionDetails}\n\n`
    + `时间: ${triggerTime}`;
}

export async function executeActionsCore(
  deps: ActionExecutorDeps,
  strategy: DIYStrategy,
  triggerAccountIdx: number,
  runToken: number
): Promise<void> {
  if (!deps.isStrategyRunActive(strategy.id, runToken)) return;
  const appConfig = (await import('../../../services/configService.ts')).loadSavedConfig();
  deps.executingStrategies.add(strategy.id);

  try {
    await LogService.runWithRedirect('diy', strategy.id, async () => {
      const startNum = strategy.actions.length;
      LogService.logKey('diy', 'diy.flow.conditionsMet', { name: strategy.name, count: startNum }, 'info', strategy.id);

      for (let i = 0; i < strategy.actions.length; i++) {
        if (!deps.isStrategyRunActive(strategy.id, runToken)) {
          LogService.logKey('diy', 'diy.flow.stopped', { name: strategy.name }, 'info', strategy.id);
          break;
        }
        const action = strategy.actions[i];
        try {
          await dispatchActionCore(deps, action, triggerAccountIdx, appConfig, strategy.testMode, strategy.id, strategy);
        } catch (e: unknown) {
          const err = e instanceof Error ? e : new Error(String(e));
          LogService.logKey('diy', 'diy.flow.actionFailed', { typeLabel: ACTION_TYPE_LABELS_ZH[action.type] || action.type, i: i + 1, total: startNum, msg: err.message }, 'error', strategy.id);
          ErrorMonitor.captureError(err, ErrorLevel.HIGH, ErrorCategory.SYSTEM);
        }
      }
      LogService.logKey('diy', 'diy.flow.allDone', {}, 'info', strategy.id);
      LogService.addLog('diy', '--------------------------------------------------', 'info', undefined, strategy.id);
    });
  } finally {
    deps.executingStrategies.delete(strategy.id);
  }
}

export async function dispatchActionCore(
  deps: ActionExecutorDeps,
  action: ActionBlock,
  triggerIdx: number,
  appConfig: AppConfig,
  strategyTestMode: boolean,
  strategyId: string,
  strategy: DIYStrategy
): Promise<void> {
  const targetId = action.targetConfigId;
  let targetConfig: Record<string, unknown> | null = null;

  const initActionEnv = async (configList: Record<string, unknown>[], moduleType: string) => {
    const sourceConfig = configList?.find((c: Record<string, unknown>) => String(c.id) === String(targetId));
    if (!sourceConfig) throw new Error(`找不到绑定的目标配置 (ID: ${targetId})`);

    const accountId = sourceConfig.account_id || '';
    if (!accountId) {
      throw new Error(`配置 "${sourceConfig.name || targetId}" 缺少 account_id，请重新选择账户`);
    }

    const testModeKey = moduleType === 'margin'
      ? 'margin_test_mode'
      : moduleType === 'amend'
        ? 'amend_test_mode'
        : moduleType === 'cancel'
          ? 'cancel_test_mode'
          : moduleType === 'close'
            ? 'close_test_mode'
            : 'place_test_mode';

    targetConfig = {
      ...sourceConfig,
      account_id: accountId,
      [testModeKey]: strategyTestMode,
      testMode: strategyTestMode,
    };

    LogService.logKey('diy', 'diy.flow.stepTrigger', { typeLabel: ACTION_TYPE_LABELS_ZH[action.type] || action.type, target: targetConfig.name || targetConfig.id }, 'info', strategyId);

    const tradeService = await StrategyEngine.getTradeService(targetConfig, moduleType);
    if (!tradeService) throw new Error(`无法获取账户 [${accountId}] 的 API 交易实例`);
    return { config: targetConfig, tradeService };
  };

  switch (action.type) {
    case 'place_order': {
      const env = await initActionEnv(appConfig.place_configs || [], 'trader');
      await PlaceOrderAction.execute(env.config, env.tradeService, undefined, env.config.id, appConfig);
      break;
    }
    case 'amend_order': {
      const env = await initActionEnv(appConfig.amend_configs || [], 'amend');
      await AmendOrderAction.execute(env.config, env.tradeService);
      break;
    }
    case 'cancel_order': {
      const env = await initActionEnv(appConfig.cancel_configs || [], 'cancel');
      await CancelOrderAction.execute(env.config, env.tradeService);
      break;
    }
    case 'close_pos': {
      const env = await initActionEnv(appConfig.close_configs || [], 'close');
      await ClosePositionAction.execute(env.config, env.tradeService);
      break;
    }
    case 'prevent_margin_risk': {
      const env = await initActionEnv(appConfig.margin_configs || [], 'margin');

      const accountData = AccountMonitor.getInstance().getAccountData(triggerIdx);
      const posList = accountData ? accountData.positions : [];
      const riskyPositions = posList.filter((p: OKXPosition) => {
        const d = calculateLiquidationDistance(p);
        return d !== null && d > 0 && d < 2000;
      });

      if (riskyPositions.length > 0) {
        await AddMarginAction.execute(env.config, env.tradeService, riskyPositions, env.config.id);
      } else {
        LogService.logKey('diy', 'diy.flow.riskSkip', {}, 'info', strategyId);
      }
      break;
    }
    case 'stop_strategy': {
      const stopTargetId = action.targetConfigId;
      const actionParams = action.params as Record<string, unknown>;
      const targetParams = actionParams?.targetId || actionParams?.targetScript || '';
      const isStopAll = stopTargetId === 'all' || targetParams === 'all';

      let targetName = stopTargetId || targetParams || 'all';
      if (isStopAll) {
        targetName = '全部策略';
      } else if (stopTargetId || targetParams) {
        const diyStrategiesRaw = appConfig.diy_strategies || appConfig.diy_configs || [];
        const diyStrategies = Array.isArray(diyStrategiesRaw) ? diyStrategiesRaw : [];
        const targetVal = stopTargetId || targetParams;
        const targetStr = String(targetVal);
        const found = diyStrategies.find((s: Record<string, unknown>) => String(s.id) === targetStr || s.name === targetVal);
        if (found) {
          targetName = found.name;
        } else {
          for (const st of deps.runningStrategies.values()) {
            if (String(st.id) === targetStr || st.name === String(targetVal)) {
              targetName = st.name;
              break;
            }
          }
        }
      }

      if (targetName === stopTargetId || targetName === targetParams) {
        if (targetName !== '全部策略' && !targetName.includes('策略')) {
          targetName = `策略: ${targetName}`;
        }
      }

      LogService.logKey('diy', 'diy.flow.stopStrategy', { name: targetName }, 'info', strategyId);

      let stoppedCount = 0;
      if (isStopAll) {
        const running = Array.from(deps.runningStrategies.values());
        for (const st of running) {
          await deps.stopStrategy(st.id);
          deps.persistStrategyStatus(st.id, false);
          stoppedCount++;
        }
      } else {
        const targetVal = stopTargetId || targetParams;
        const targetStr = String(targetVal);
        for (const st of deps.runningStrategies.values()) {
          if (String(st.id) === targetStr || st.name === String(targetVal)) {
            await deps.stopStrategy(st.id);
            deps.persistStrategyStatus(st.id, false);
            stoppedCount++;
          }
        }
      }
      if (stoppedCount > 0) {
        LogService.logKey('diy', 'diy.flow.stoppedN', { count: stoppedCount }, 'info', strategyId);
      } else if (!isStopAll && (stopTargetId || targetParams)) {
        const targetVal = stopTargetId || targetParams;
        const parts = String(targetVal).split(':');
        if (parts.length >= 2) {
          StrategyEngine.stop(parts[0], '由 DIY 策略触发停止', parts[1]);
          LogService.logKey('diy', 'diy.flow.sendStop', { module: parts[0], cfg: parts[1] }, 'info', strategyId);
        }
      }
      break;
    }
    case 'notify': {
      const notifyParams = action.params as Record<string, unknown>;
      const type = notifyParams?.notify_type || 'log';
      const message = notifyParams?.message || `策略 ID: ${strategyId} 已触发动作执行`;

      if (type === 'email') {
        const email = notifyParams?.email;
        if (email) {
          LogService.logKey('diy', 'diy.flow.sendEmail', { email }, 'info', strategyId);

          const emailSubject = `TodoQuant 策略触发: ${strategy.name}`;
          const emailContent = buildNotifyContent(strategy, strategyId, deps, appConfig);

          EmailService.sendNotification(email, emailSubject, emailContent).catch(e => {
            const err = e instanceof Error ? e : new Error(String(e));
            LogService.logKey('diy', 'diy.email.failed', { msg: err.message }, 'error', strategyId);
            ErrorMonitor.captureError(err, ErrorLevel.MEDIUM, ErrorCategory.SYSTEM);
          });
        } else {
          LogService.logKey('diy', 'diy.step.skipped', {}, 'error', strategyId);
        }
      } else if (type === 'telegram') {
        const { TelegramService } = await import('../../../services/telegramService.ts');
        const content = buildNotifyContent(strategy, strategyId, deps, appConfig);
        TelegramService.notifyStrategy(content).then((sent) => {
          if (sent) {
            LogService.logKey('diy', 'diy.flow.sendTelegram', { strategy: strategy.name }, 'info', strategyId);
          } else {
            LogService.logKey('diy', 'diy.telegram.notBound', {}, 'error', strategyId);
          }
        }).catch((e) => {
          const err = e instanceof Error ? e : new Error(String(e));
          LogService.logKey('diy', 'diy.telegram.failed', { msg: err.message }, 'error', strategyId);
          ErrorMonitor.captureError(err, ErrorLevel.MEDIUM, ErrorCategory.SYSTEM);
        });
      } else if (type === 'pc') {
        const isZh = deps.locale === 'zh-CN';
        const notifyTitle = isZh ? 'TodoQuant 策略触发' : 'TodoQuant Strategy Triggered';
        const notifyBody = isZh
          ? `您的 DIY 策略【${strategy.name}】(ID: ${strategyId}) 已触发`
          : `Your DIY strategy [${strategy.name}] (ID: ${strategyId}) has been triggered`;
        const sent = sendPcNotification(notifyTitle, notifyBody);
        if (sent) {
          LogService.logKey('diy', 'diy.flow.sendPc', { strategy: strategy.name }, 'info', strategyId);
        } else {
          LogService.logKey('diy', 'diy.flow.sendPcFallback', { title: notifyTitle, body: notifyBody }, 'info', strategyId);
        }
      } else {
        LogService.logKey('diy', 'diy.flow.notify', { msg: message }, 'info', strategyId);
      }
      break;
    }
    case 'transfer': {
      LogService.logKey('diy', 'diy.flow.simTransfer', {}, 'info', strategyId);
      break;
    }
    default:
      LogService.logKey('diy', 'diy.action.unknown', { type: action.type }, 'error');
  }
}

export function persistStrategyStatusCore(strategyId: string, running: boolean): void {
  try {
    const wsManager = OKXWebSocketManager.instance;
    if (wsManager) {
      wsManager.broadcast({
        type: 'script_status',
        scriptType: 'diy',
        configId: strategyId,
        running,
        timestamp: Date.now()
      });
    }
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    LogService.logKey('diy', 'diy.broadcast.failed', { msg: err.message }, 'error');
    ErrorMonitor.captureError(err, ErrorLevel.LOW, ErrorCategory.SYSTEM);
  }
}
