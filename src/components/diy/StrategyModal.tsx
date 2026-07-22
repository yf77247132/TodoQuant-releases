import DashedHint from '../../ui/DashedHint'
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Trash2, Activity, Info } from 'lucide-react';
import { useClickOutside } from '../../hooks/useClickOutside.ts';
import { useShortcutKeyConflict } from '../../hooks/useShortcutKeyConflict.ts';
import Button from '../../ui/Button.tsx';
import Select from '../../ui/Select.tsx';
import TextInput from '../../ui/TextInput.tsx';
import NumberInput from '../../ui/NumberInput.tsx';
import Switch from '../../ui/Switch.tsx';
import ShortcutKeyInput from '../../ui/ShortcutKeyInput.tsx';
import { Tooltip } from '../../ui/Tooltip.tsx';
import { getConditionSummary, getConfigSummary } from './configSummarizer.ts';
import { ACTION_TYPE_LABEL } from '../../constants/actionLabels.ts';
import { buildSpecFromConditions } from '../../freqtrade/buildSpecFromConditions.ts';
import type { DIYStrategy, ConditionTemplate, ActionBlock, ActionType, ModuleConfig } from '../../types/index.ts';

interface StrategyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (strategy: DIYStrategy) => void;
  onSaveAndStart?: (strategy: DIYStrategy) => void;
  initialData?: DIYStrategy | null;
  conditionTemplates: ConditionTemplate[];
  placeConfigs: ModuleConfig[];
  amendConfigs: ModuleConfig[];
  cancelConfigs: ModuleConfig[];
  closeConfigs: ModuleConfig[];
  preventMarginConfigs: ModuleConfig[];
  accountNames: Record<number, string>;
  accountColors: Record<number, string>;
  accounts: Array<{ id: string; name: string }>;
  defaultEmail?: string;
  allStrategies: DIYStrategy[];
  showToast?: (message: string, type: 'success' | 'error') => void;
}

export default function StrategyModal({
  isOpen,
  onClose,
  onSave,
  onSaveAndStart,
  initialData,
  conditionTemplates,
  placeConfigs,
  amendConfigs,
  cancelConfigs,
  closeConfigs,
  preventMarginConfigs,
  accountNames,
  accountColors,
  accounts,
  defaultEmail,
  allStrategies,
  showToast,
}: StrategyModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialData?.name || '');
  const [shortcutKey, setShortcutKey] = useState(initialData?.shortcut_key || '');
  const [conditionTemplateId, setConditionTemplateId] = useState(initialData?.conditionTemplateId || (conditionTemplates[0]?.id || ''));
  const [actions, setActions] = useState<ActionBlock[]>(initialData?.actions || []);
  const [testMode, setTestMode] = useState(initialData?.testMode ?? true);

  const modalRef = useRef<HTMLDivElement>(null);
  const { conflictMsg: shortcutConflictMsg, checkConflict: checkShortcutKeyConflict, clearConflict: clearShortcutKeyConflict } = useShortcutKeyConflict(t);
  useClickOutside(modalRef, onClose);

  const [telegramBound, setTelegramBound] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/telegram/status')
      .then(r => r.json())
      .then(d => setTelegramBound(!!d.bound))
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    setName(initialData?.name || '');
    setShortcutKey(initialData?.shortcut_key || '');
    setConditionTemplateId(initialData?.conditionTemplateId || (conditionTemplates[0]?.id || ''));
    setActions(initialData?.actions || []);
    setTestMode(initialData?.testMode ?? true);
  }, [initialData, conditionTemplates]);

  useEffect(() => {
    if (isOpen) {
      if (shortcutKey) {
        checkShortcutKeyConflict(shortcutKey, initialData?.id);
      } else {
        clearShortcutKeyConflict();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const getAutoName = useCallback(() => {
    const template = conditionTemplates.find(t => t.id === conditionTemplateId);
    if (!template) return '';

    const actionTypes = actions.map(a => t(ACTION_TYPE_LABEL[a.type] || 'strategy.actionDefault'));

    const uniqueActions = Array.from(new Set(actionTypes));
    const actionStr = uniqueActions.length > 0 ? ` - ${uniqueActions.join('+')}` : '';

    return `${template.name}${actionStr}`;
  }, [conditionTemplateId, actions, conditionTemplates, t]);

  if (!isOpen) return null;

  const handleAddAction = () => {
    const defaultType: ActionType = 'place_order';
    const defaultConfigId = placeConfigs[0]?.id || '';
    setActions([...actions, { id: Date.now().toString(), type: defaultType, params: {}, targetConfigId: defaultConfigId }]);
  };

  const handleUpdateAction = (id: string, updates: Partial<ActionBlock>) => {
    setActions(actions.map(a => a.id === id ? { ...a, ...updates } : a));
  };

  const handleRemoveAction = (id: string) => {
    setActions(actions.filter(a => a.id !== id));
  };

  const buildStrategy = (): DIYStrategy | null => {
    let finalName = name.trim();
    if (!finalName) {
      finalName = `#${Date.now().toString(16).slice(-4).toUpperCase()}`;
    }

    if (!conditionTemplateId || actions.length === 0) return null;

    const emailNotifyMissing = actions.some((a) =>
      a.type === 'notify' && a.params?.notify_type === 'email' && !a.params?.email
    );
    if (emailNotifyMissing) {
      showToast?.(t('strategy.emailRequired'), 'error');
      return null;
    }
    const telegramNotifyMissing = actions.some((a) =>
      a.type === 'notify' && a.params?.notify_type === 'telegram' && !telegramBound
    );
    if (telegramNotifyMissing) {
      showToast?.(t('strategy.telegramNotBound'), 'error');
      return null;
    }

    const validatedActions = actions.map(action => {
      if (action.targetConfigId) return action;
      let fallbackId = '';
      if (action.type === 'place_order') fallbackId = placeConfigs[0]?.id || '';
      else if (action.type === 'amend_order') fallbackId = amendConfigs[0]?.id || '';
      else if (action.type === 'cancel_order') fallbackId = cancelConfigs[0]?.id || '';
      else if (action.type === 'close_pos') fallbackId = closeConfigs[0]?.id || '';
      else if (action.type === 'prevent_margin_risk') fallbackId = preventMarginConfigs[0]?.id || '';
      else if (action.type === 'stop_strategy') fallbackId = 'all';
      return { ...action, targetConfigId: fallbackId };
    });

    const template = conditionTemplates.find(t => t.id === conditionTemplateId);
    const freqtradeSpec = template
      ? buildSpecFromConditions(
          initialData?.id || Date.now().toString(),
          finalName,
          template.conditions,
          template.timeframe || '5m',
        )
      : undefined;

    return {
      id: initialData?.id || Date.now().toString(),
      name: finalName,
      conditionTemplateId,
      actions: validatedActions,
      running: initialData?.running || false,
      testMode,
      createdAt: initialData?.createdAt || Date.now(),
      shortcut_key: shortcutKey || undefined,
      freqtradeSpec,
    };
  };

  const handleSave = () => {
    const strategy = buildStrategy();
    if (!strategy) return;
    onSave(strategy);
    onClose();
  };

  return (
    <div
      id="diy-strategy-modal"
      className="fixed inset-0 z-[var(--z-dropdown)] flex items-center justify-center p-4 animate-in fade-in duration-300"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      />
      <div ref={modalRef} className="relative bg-surface-2 border border-border-default rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border-default flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-blue/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-brand-blue" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-secondary">{initialData ? t('strategy.editStrategy') : t('strategy.newStrategy')}</h2>
              <p className="text-xs text-text-tertiary">{t('strategy.strategyDesc')}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-3 rounded-full text-text-tertiary hover:text-text-primary transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="block text-3xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5">{t('strategy.strategyName')}</label>
              <TextInput
                value={name}
                defaultValue=""
                onChange={setName}
                placeholder={t('strategy.placeholderName')}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-3xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5">
                <Tooltip content={t('common.shortcutKeyTip')}>
                  <DashedHint className="cursor-help">
                    {t('common.shortcutKey')}
                  </DashedHint>
                </Tooltip>
              </label>
              <ShortcutKeyInput
                value={shortcutKey}
                onChange={(val) => {
                  setShortcutKey(val);
                  if (val) {
                    checkShortcutKeyConflict(val, initialData?.id);
                  } else {
                    clearShortcutKeyConflict();
                  }
                }}
                conflictMsg={shortcutConflictMsg}
              />
            </div>
          </div>

          <Switch
            checked={!testMode}
            onChange={(val) => setTestMode(!val)}
            label={t('strategy.liveMode')}
            descriptionOn={t('strategy.liveModeOn')}
            descriptionOff={t('strategy.liveModeOff')}
            colorOn="text-brand-yellow"
          />

          <div className="space-y-2">
            <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">{t('strategy.triggerCondition')}</label>
            <Tooltip
              className="relative block w-full"
              content={(() => {
                const template = conditionTemplates.find(t => t.id === conditionTemplateId) || conditionTemplates[0];
                if (!template) return t('strategy.selectConditionFirst');
                return getConditionSummary(template, accountNames as unknown as Record<string, string>, accounts, t);
              })()}
            >
              <Select
                className="w-full cursor-help hover:border-brand-blue/50 transition-colors"
                value={conditionTemplateId || (conditionTemplates[0]?.id || '')}
                onChange={(e) => setConditionTemplateId(e.target.value)}
              >
                {conditionTemplates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Tooltip>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-text-secondary ml-1">{t('strategy.execActions')}</label>
              <Button
                variant="ghost"
                onClick={handleAddAction}
              >
                <Plus className="w-3 h-3" />
                {t('strategy.addAction')}
              </Button>
            </div>

            <div className="space-y-3">
              {actions.length === 0 ? (
                <div className="p-8 border border-dashed border-white/5 rounded-2xl flex flex-col items-center justify-center text-center">
                  <Info className="w-6 h-6 text-text-muted mb-2" />
                  <p className="text-xs text-text-muted">{t('strategy.addActionHint')}</p>
                </div>
              ) : (
                actions.map((action, idx) => (
                  <div key={action.id} className="p-4 rounded-2xl bg-surface-1 border border-border-default shadow-sm space-y-4 relative group">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-lg bg-surface-1 border border-border-default flex items-center justify-center text-xs">
                        {idx + 1}
                      </div>
                      <div className="flex-1 grid grid-cols-2 gap-3">
                        <Select
                          className="cursor-help hover:border-brand-blue/50 transition-colors"
                          value={action.type}
                          onChange={(e) => {
                            const newType = e.target.value as ActionType;
                            let defaultConfigId = '';
                            if (newType === 'place_order') defaultConfigId = placeConfigs[0]?.id || '';
                            else if (newType === 'amend_order') defaultConfigId = amendConfigs[0]?.id || '';
                            else if (newType === 'cancel_order') defaultConfigId = cancelConfigs[0]?.id || '';
                            else if (newType === 'close_pos') defaultConfigId = closeConfigs[0]?.id || '';
                            else if (newType === 'prevent_margin_risk') defaultConfigId = preventMarginConfigs[0]?.id || '';
                            else if (newType === 'stop_strategy') defaultConfigId = 'all';

                            handleUpdateAction(action.id, {
                              type: newType,
                              targetConfigId: defaultConfigId,
                              params: newType === 'notify' ? { notify_type: 'email', email: defaultEmail || '', message: '' } : {}
                            });
                          }}
                        >
                          {(Object.keys(ACTION_TYPE_LABEL) as ActionType[])
                            .filter(type => !['stop_strategy', 'transfer'].includes(type) || (type === 'stop_strategy'))
                            .map(type => (
                            <option key={type} value={type}>{t(ACTION_TYPE_LABEL[type])}</option>
                          ))}
                        </Select>
                        {action.type === 'notify' ? (
                          (() => {
                            const notifyType = action.params?.notify_type || 'pc';
                            return (
                              <>
                                <Tooltip
                                  className="relative block flex-1"
                                  content={(() => {
                                    if (notifyType === 'pc') return t('strategy.pcNotif');
                                    if (notifyType === 'telegram') return t('strategy.telegramNotif');
                                    return t('strategy.emailNotif', {
                                      email: action.params?.email || t('strategy.emailUnfilled')
                                    });
                                  })()}
                                >
                                  <Select
                                    className="w-full cursor-help hover:border-brand-blue/50 transition-colors"
                                    value={notifyType}
                                    onChange={(e) => {
                                      const newType = e.target.value;
                                      if (newType === 'email' && !action.params?.email && defaultEmail) {
                                        handleUpdateAction(action.id, {
                                          params: { ...action.params, email: defaultEmail, notify_type: 'email' }
                                        });
                                      } else {
                                        handleUpdateAction(action.id, {
                                          params: { ...action.params, notify_type: newType }
                                        });
                                      }
                                    }}
                                  >
                                    <option value="pc">{t('strategy.pcNotifOption')}</option>
                                    <option value="email">{t('strategy.emailOption')}</option>
                                    <option value="telegram">{t('strategy.telegramOption')}</option>
                                  </Select>
                                </Tooltip>
                                {notifyType === 'email' && (
                                  <Tooltip
                                    className="relative block flex-1"
                                    content={action.params?.email
                                      ? t('strategy.emailNotif', { email: action.params.email })
                                      : t('strategy.emailRequired')}
                                  >
                                    <TextInput
                                      containerClassName="w-full"
                                      value={action.params?.email || ''}
                                      defaultValue=""
                                      onChange={(val) => handleUpdateAction(action.id, {
                                        params: { ...action.params, email: val, notify_type: 'email' }
                                      })}
                                      placeholder={t('strategy.emailPlaceholder')}
                                    />
                                  </Tooltip>
                                )}
                                {notifyType === 'telegram' && !telegramBound && (
                                  <p className="text-3xs text-amber-500 leading-relaxed w-full">
                                    {t('strategy.telegramNotBoundHint')}
                                  </p>
                                )}
                              </>
                            );
                          })()
                        ) : (
                          <Tooltip
                            className="relative block flex-1"
                            content={(() => {
                              let configs: ModuleConfig[] = [];
                              const type = action.type as ActionType;
                              switch (type) {
                                case 'place_order': configs = placeConfigs; break;
                                case 'amend_order': configs = amendConfigs; break;
                                case 'cancel_order': configs = cancelConfigs; break;
                                case 'prevent_margin_risk': configs = preventMarginConfigs; break;
                                case 'close_pos': configs = closeConfigs; break;
                                case 'stop_strategy': {
                                  const targetId = action.targetConfigId;
                                  let strategyName = targetId === 'all' ? t('strategy.allStrategies') : targetId;
                                  if (targetId !== 'all') {
                                    const s = allStrategies.find(x => x.id === targetId);
                                    if (s) strategyName = s.name;
                                  }
                                  return t('strategy.stopStrategy', { name: strategyName });
                                }
                                case 'notify': return getConfigSummary('notify', action, accountNames, accountColors, accounts, t);
                                default: return t('strategy.selectAction');
                              }
                              const cfg = configs.find(c => c.id === action.targetConfigId || c.configId === action.targetConfigId) || configs[0];
                              if (!cfg) return t('strategy.selectConfigFirst');
                              return getConfigSummary(type, cfg, accountNames, accountColors, accounts, t);
                            })()}
                          >
                            <Select
                              className="w-full cursor-help hover:border-brand-blue/50 transition-colors"
                              value={action.targetConfigId || ''}
                              onChange={(e) => handleUpdateAction(action.id, { targetConfigId: e.target.value })}
                            >
                              {(() => {
                                const type = action.type as ActionType;
                                if (type === 'stop_strategy') {
                                  return (
                                    <>
                                      <option value="all">{t('strategy.allStrategiesPause')}</option>
                                      {allStrategies.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                      ))}
                                    </>
                                  );
                                }

                                const configs = (type === 'place_order' ? placeConfigs :
                                                type === 'amend_order' ? amendConfigs :
                                                type === 'cancel_order' ? cancelConfigs :
                                                type === 'prevent_margin_risk' ? preventMarginConfigs :
                                                closeConfigs);

                                return configs.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ));
                              })()}
                            </Select>
                          </Tooltip>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() => handleRemoveAction(action.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border-default bg-surface-1 flex items-center justify-end gap-3 shrink-0">
          <Button
            variant="ghost"
            size="md"
            onClick={onClose}
            className="rounded-xl"
          >
            {t('strategy.cancel')}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSave}
            disabled={!conditionTemplateId || actions.length === 0}
            className="rounded-xl"
          >
            {t('strategy.saveStrategy')}
          </Button>
          {onSaveAndStart && (
            <Button
              variant={!testMode ? 'secondary' : undefined}
              size="md"
              onClick={() => {
                const strategy = buildStrategy();
                if (strategy) onSaveAndStart(strategy);
              }}
              disabled={!conditionTemplateId || actions.length === 0}
              className="rounded-xl"
            >
              {t('ui.configModal.saveAndStart')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
