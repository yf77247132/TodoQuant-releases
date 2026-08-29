import Select from '../ui/Select.tsx';
import TextInput from '../ui/TextInput.tsx';
import Button from '../ui/Button.tsx';
import ConfirmModal from '../ui/ConfirmModal.tsx';
import { Spinner } from '../ui/Spinner.tsx';
import { ThirdPartyLicensesPanel } from './ThirdPartyLicensesPanel.tsx';
import { Settings, Save, RefreshCw, Eye, EyeOff, RefreshCcw, Download, Languages } from 'lucide-react';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { switchLanguage } from '../i18n/index.ts';
import ConfigHeader from '../ui/ConfigHeader.tsx';
import { TAB_IDS, DEFAULT_TAB_SHORTCUTS, getTabShortcuts } from '../lib/tabShortcuts.ts';
import type { AppConfig } from '../types/core.ts';
import { useShortcutKeyConflict } from '../hooks/useShortcutKeyConflict.ts';
import AccountSelect from '../ui/AccountSelect.tsx';
import InstrumentInput from '../ui/InstrumentInput.tsx';
import { Tooltip } from '../ui/Tooltip.tsx';
import DashedHint from '../ui/DashedHint.tsx';
import { LABEL_BASE, INPUT_BASE } from '../ui/inputStyles.ts';

interface SystemSettingsModuleProps {
  isActive?: boolean;
  config: Partial<AppConfig>;
  updateConfig: (newConfig: Partial<AppConfig>) => Promise<boolean>;
  accountColors?: Record<number, string>;
}

export const SystemSettingsModule: React.FC<SystemSettingsModuleProps> = React.memo(({ config, updateConfig, isActive = true, accountColors = {} }) => {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState('');
  const [tabConflictMsgs, setTabConflictMsgs] = useState<Record<string, string>>({});
  const { checkConflict: checkShortcutConflict } = useShortcutKeyConflict(t);

  const refreshAllTabConflicts = useCallback((shortcuts: Record<string, string>) => {
    TAB_IDS.forEach(tabId => {
      const val = shortcuts[tabId];
      if (val) {
        checkShortcutConflict(val, undefined, tabId).then(msg => {
          setTabConflictMsgs(prev => ({ ...prev, [tabId]: msg }));
        });
      } else {
        setTabConflictMsgs(prev => ({ ...prev, [tabId]: '' }));
      }
    });
  }, [checkShortcutConflict]);

  useEffect(() => {
    if (!isActive) return;
    const timer = setTimeout(() => {
      refreshAllTabConflicts(getTabShortcuts(config));
    }, 100);
    return () => clearTimeout(timer);
  }, [isActive, config, refreshAllTabConflicts]);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getAppVersion().then(setAppVersion).catch(() => {});
    } else {
      fetch('/api/system/app-version')
        .then(r => r.json())
        .then(data => setAppVersion(data.version || ''))
        .catch(() => {});
    }
  }, []);

  const [backupStatus, setBackupStatus] = useState<string>('');
  const [backups, setBackups] = useState<string[]>([]);
  const [selectedBackup, setSelectedBackup] = useState<string>('');
  const [resendKeyVisible, setResendKeyVisible] = useState(false);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; message: string; onConfirm: () => void } | null>(null);
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'downloading' | 'ready'>('idle');
  const [downloadProgress, setDownloadProgress] = useState<number>(0);

  const TIMEZONE_OPTIONS = [
    { label: t('settings.timezoneAuto'), value: '' },
    { label: t('settings.timezoneBeijing'), value: 'Asia/Shanghai' },
    { label: t('settings.timezoneTokyo'), value: 'Asia/Tokyo' },
    { label: t('settings.timezoneSingapore'), value: 'Asia/Singapore' },
    { label: t('settings.timezoneLondon'), value: 'Europe/London' },
    { label: t('settings.timezoneNewYork'), value: 'America/New_York' },
    { label: t('settings.timezoneLosAngeles'), value: 'America/Los_Angeles' },
    { label: t('settings.timezoneUTC'), value: 'UTC' },
  ];

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const [tgStatus, setTgStatus] = useState<{ configured: boolean; bound: boolean; username: string; chatId: string | null; binding: boolean }>({ configured: false, bound: false, username: '', chatId: null, binding: false });
  const [tgDeepLink, setTgDeepLink] = useState('');
  const [tgCode, setTgCode] = useState('');

  const fetchTgStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/telegram/status');
      const d = await r.json();
      if (d.ok) setTgStatus({ configured: !!d.configured, bound: !!d.bound, username: d.username || '', chatId: d.chatId || null, binding: !!d.binding });
    } catch {  }
  }, []);

  useEffect(() => {
    if (isActive) fetchTgStatus();
  }, [isActive, fetchTgStatus]);

  useEffect(() => {
    if (!tgStatus.binding) return;
    const timer = setInterval(fetchTgStatus, 2000);
    return () => clearInterval(timer);
  }, [tgStatus.binding, fetchTgStatus]);

  const handleBindTg = async () => {
    try {
      const r = await fetch('/api/telegram/bind', { method: 'POST' });
      const d = await r.json();
      if (d.ok) {
        setTgCode(d.code);
        setTgDeepLink(d.deepLink);
        setTgStatus(prev => ({ ...prev, binding: true }));
        window.open(d.deepLink, '_blank');
      } else {
        showToast(d.error || t('settings.telegramBindFailed'), 'error');
      }
    } catch { showToast(t('settings.telegramBindFailed'), 'error'); }
  };

  const handleUnbindTg = async () => {
    try {
      await fetch('/api/telegram/unbind', { method: 'POST' });
      setTgDeepLink(''); setTgCode(''); fetchTgStatus();
    } catch {  }
  };

  const handleTestTg = async () => {
    try {
      const r = await fetch('/api/telegram/test', { method: 'POST' });
      const d = await r.json();
      if (d.ok) showToast(t('settings.telegramTestSent'), 'success');
      else showToast(d.error || t('settings.telegramTestFailed'), 'error');
    } catch { showToast(t('settings.telegramTestFailed'), 'error'); }
  };

  const [leverageAccountId, setLeverageAccountId] = useState('');
  const [leverageInstId, setLeverageInstId] = useState('');
  const [leverageValue, setLeverageValue] = useState('10');
  const [leverageMgnMode, setLeverageMgnMode] = useState<'cross' | 'isolated'>('cross');
  const [leveragePosSide, setLeveragePosSide] = useState<'long' | 'short'>('long');
  const [leverageLoading, setLeverageLoading] = useState(false);
  const [leverageProgress, setLeverageProgress] = useState<{ processed: number; total: number; ok: number; fail: number } | null>(null);

  const okxAccounts = useMemo(() => {
    const accounts = config.accounts || [];
    return accounts
      .map((a: { id: string; name: string; exchange?: string }, idx: number) => ({
        id: a.id,
        name: a.name,
        exchange: a.exchange,
        color: accountColors[idx],
      }))
      .filter((a: { exchange?: string }) => a.exchange === 'OKX');
  }, [config.accounts, accountColors]);

  useEffect(() => {
    if (okxAccounts.length > 0 && !leverageAccountId) {
      setLeverageAccountId(okxAccounts[0].id);
    }
  }, [okxAccounts, leverageAccountId]);

  const handleSetLeverage = async () => {
    if (!leverageAccountId) {
      showToast(t('settings.leverage.selectAccount'), 'error');
      return;
    }
    const lever = Number(leverageValue);
    if (!Number.isFinite(lever) || lever % 1 !== 0 || lever < 1 || lever > 125) {
      showToast(t('settings.leverage.leverRangeError'), 'error');
      return;
    }
    if (leverageInstId && !leverageInstId.endsWith('-SWAP')) {
      showToast(t('settings.leverage.instIdSwapOnlyError'), 'error');
      return;
    }

    setLeverageLoading(true);
    setLeverageProgress(null);
    try {
      const resp = await fetch('/api/system/set-leverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: leverageAccountId,
          instId: leverageInstId || undefined,
          lever: String(lever),
          mgnMode: leverageMgnMode,
          posSide: leverageMgnMode === 'isolated' ? leveragePosSide : undefined,
        }),
      });

      const contentType = resp.headers.get('content-type') || '';
      const isStream = contentType.includes('x-ndjson');

      if (isStream && resp.body) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult: { ok: boolean; batch?: boolean; total?: number; okCount?: number; failCount?: number; fails?: Array<{ instId: string; error: string }>; error?: string } | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const msg = JSON.parse(trimmed);
              if (msg.type === 'progress') {
                setLeverageProgress({ processed: msg.processed, total: msg.total, ok: msg.ok, fail: msg.fail });
              } else if (msg.type === 'done') {
                finalResult = msg;
              }
            } catch {
            }
          }
        }

        if (finalResult) {
          if (finalResult.ok) {
            showToast(t('settings.leverage.batchSuccess', { ok: finalResult.okCount, fail: finalResult.failCount }), 'success');
          } else if (finalResult.failCount && finalResult.failCount > 0) {
            showToast(t('settings.leverage.batchDoneWithFail', {
              ok: finalResult.okCount,
              total: finalResult.total,
              fail: finalResult.failCount,
              fails: (finalResult.fails || []).slice(0, 3).map(f => `${f.instId}: ${f.error}`).join('; '),
            }), 'error');
          } else {
            showToast(t('settings.leverage.setFailed', { error: finalResult.error || '' }), 'error');
          }
        } else {
          showToast(t('settings.leverage.requestFailed'), 'error');
        }
      } else {
        const data = await resp.json();
        if (data.ok) {
          const modeLabel = leverageMgnMode === 'cross' ? t('settings.leverage.cross') : t('settings.leverage.isolated');
          const instIdLabel = leverageInstId || t('settings.leverage.allInstIds');
          showToast(t('settings.leverage.setSuccess', { instId: instIdLabel, lever, mode: modeLabel }), 'success');
        } else {
          showToast(t('settings.leverage.setFailed', { error: data.error || '' }), 'error');
        }
      }
    } catch {
      showToast(t('settings.leverage.requestFailed'), 'error');
    } finally {
      setLeverageLoading(false);
      setLeverageProgress(null);
    }
  };

  const fetchBackups = async () => {
    try {
      const response = await fetch('/api/db/backups');
      const data = await response.json();
      if (data.ok) {
        setBackups(data.files);
        if (data.files.length > 0) {
          setSelectedBackup(data.files[data.files.length - 1]);
        }
      }
    } catch (error) {
      console.error('获取备份列表失败', error);
    }
  };

  useEffect(() => {
    void fetchBackups();
    if (window.electronAPI) {
      window.electronAPI.getAppVersion().then(setAppVersion).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;
    const cleanupNotAvailable = window.electronAPI.onUpdateNotAvailable(() => {
      setUpdateStatus('idle');
    });
    const cleanupAvailable = window.electronAPI.onUpdateAvailable((_version) => {
      setUpdateStatus('downloading');
    });
    const cleanupProgress = window.electronAPI.onUpdateDownloadProgress((percent) => {
      setUpdateStatus('downloading');
      setDownloadProgress(percent);
    });
    const cleanupDownloaded = window.electronAPI.onUpdateDownloaded(() => {
      setUpdateStatus('ready');
    });
    const cleanupError = window.electronAPI.onUpdateError((_message) => {
      setUpdateStatus('idle');
    });
    return () => {
      cleanupNotAvailable();
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
      cleanupError();
    };
  }, [t, showToast]);

  const handleBackup = async () => {
    try {
      setBackupStatus(t('settings.backingUp'));
      const response = await fetch('/api/db/backup', { method: 'POST' });
      const data = await response.json();
      if (data.ok) {
        showToast(t('settings.backupSuccess', { file: data.file }), 'success');
        setBackupStatus('');
        void fetchBackups();
      } else {
        showToast(t('settings.backupFailed'), 'error');
        setBackupStatus(t('settings.backupFailed'));
      }
    } catch (error) {
      showToast(t('settings.backupRequestFailed'), 'error');
      setBackupStatus(t('settings.backupRequestFailed'));
    }
  };

  const handleRestore = async () => {
    if (!selectedBackup) {
      showToast(t('settings.selectBackupFirst'), 'error');
      return;
    }

    setConfirmModal({
      isOpen: true,
      message: t('settings.confirmRestore', { file: selectedBackup }),
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          setBackupStatus(t('settings.restoring'));
          const response = await fetch('/api/db/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: selectedBackup }),
          });
          const data = await response.json();

          if (response.ok && data.ok) {
            showToast(t('settings.restoreSuccess'), 'success');
            setTimeout(() => window.location.reload(), 2000);
          } else {
            const errorMsg = data.error || t('settings.backupFailed');
            showToast(t('settings.restoreFailed', { error: errorMsg }), 'error');
            setBackupStatus(t('settings.restoreFailed', { error: errorMsg }));
          }
        } catch (error) {
          const errorMsg = t('settings.requestFailed');
          showToast(errorMsg, 'error');
          setBackupStatus(errorMsg);
        }
      },
    });
  };

  if (!isActive) return <div className="flex flex-col flex-1 min-h-0" />;
  return (
    <>
      {toast && (
        <div
          className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg text-text-primary font-bold shadow-lg z-[var(--z-dropdown)] ${
            toast.type === 'success' ? 'bg-trade-green' : 'bg-trade-red'
          }`}
        >
          {toast.message}
        </div>
      )}

      <ConfirmModal
        open={!!confirmModal?.isOpen}
        title={t('settings.confirmAction')}
        message={confirmModal?.message || ''}
        onClose={() => setConfirmModal(null)}
        onConfirm={async () => { confirmModal?.onConfirm(); }}
      />

      <div className="flex flex-col space-y-4">
        <ConfigHeader
          icon={Settings}
          iconColor="text-brand-yellow"
          title={t('settings.title')}
          subtitle={t('settings.ui.subtitle')}
        />

        <div className="space-y-6 pb-8">
          <div className="bg-surface-2 border border-border-default rounded-2xl shadow-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-text-secondary">{t('settings.general')}</h3>

            <div className="flex flex-col gap-2">
              <label className="text-sm text-text-secondary">{t('settings.globalTimezone')}</label>
              <Select
                value={config.timezone || ''}
                onChange={(e) => updateConfig({ timezone: e.target.value })}
                containerClassName="w-full"
              >
                {TIMEZONE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
              <p className="text-3xs text-text-tertiary leading-relaxed">
                {t('settings.timezoneDesc')}
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-4 border-t border-border-subtle">
              <label className="text-sm text-text-secondary">{t('settings.language')}</label>
              <div className="flex items-center gap-3">
                <Select
                  value={i18n.language}
                  onChange={(e) => switchLanguage(e.target.value)}
                  containerClassName="w-full"
                >
                  <option value="zh-CN">中文</option>
                  <option value="en-US">English</option>
                </Select>
                <Languages className="w-4 h-4 text-text-tertiary shrink-0" />
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-4 border-t border-border-subtle">
              <label className="text-sm text-text-secondary">{t('settings.defaultEmail')}</label>
              <TextInput
                value={config.default_email || ''}
                defaultValue=""
                onChange={(val) => updateConfig({ default_email: val })}
                placeholder={t('settings.defaultEmailPlaceholder')}
                className="w-full"
                containerClassName="w-full"
              />
              <p className="text-3xs text-text-tertiary leading-relaxed">
                {t('settings.defaultEmailDescBefore')}
                <a
                  href="https://resend.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-blue hover:text-brand-blue/80 underline decoration-brand-blue/50 decoration-1 underline-offset-2"
                >
                  resend.com
                </a>
                {t('settings.defaultEmailDescAfter')}
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-4 border-t border-border-subtle">
              <label className="text-sm text-text-secondary">{t('settings.resendApiKeyLabel')}</label>
              <div className="flex relative w-full items-center">
                <TextInput
                  value={config.resend_api_key || ''}
                  defaultValue=""
                  onChange={(val) => updateConfig({ resend_api_key: val })}
                  placeholder={t('settings.resendApiKeyPlaceholder')}
                  className="w-full pr-10 font-mono"
                  type={resendKeyVisible ? 'text' : 'password'}
                  containerClassName="w-full"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setResendKeyVisible(!resendKeyVisible)}
                  className="absolute right-3"
                >
                  {resendKeyVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-3xs text-text-tertiary leading-relaxed">
                {t('settings.resendApiKeyDescBefore')}
                <a
                  href="https://resend.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-blue hover:text-brand-blue/80 underline decoration-brand-blue/50 decoration-1 underline-offset-2"
                >
                  resend.com
                </a>
                {t('settings.resendApiKeyDescAfter')}
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-4 border-t border-border-subtle">
              <label className="text-sm text-text-secondary">{t('settings.telegramTitle')}</label>
              <div className="text-xs text-text-secondary">
                {tgStatus.bound
                  ? <span>@{tgStatus.username || 'TodoQuant_bot'} · {t('settings.telegramBound')} <span className="text-text-tertiary">chat_id: {tgStatus.chatId}</span></span>
                  : `@${tgStatus.username || 'TodoQuant_bot'} · ${t('settings.telegramNotBound')}`
                }
              </div>
              {!tgStatus.bound && (
                tgStatus.binding ? (
                  <div className="flex items-center gap-2">
                    <Spinner size={14} />
                    <span className="text-xs text-text-secondary">{t('settings.telegramBindingHint')}</span>
                  </div>
                ) : (
                  <Button variant="surface" onClick={handleBindTg} className="w-fit">{t('settings.telegramBind')}</Button>
                )
              )}
              {tgStatus.bound && (
                <div className="flex gap-2">
                  <Button variant="surface" onClick={handleTestTg}>{t('settings.telegramTest')}</Button>
                  <Button variant="danger" onClick={handleUnbindTg}>{t('settings.telegramUnbind')}</Button>
                </div>
              )}
              <p className="text-3xs text-text-tertiary leading-relaxed">{t('settings.telegramDesc')}</p>
            </div>
          </div>

          {okxAccounts.length > 0 && (
            <div className="bg-surface-2 border border-border-default rounded-2xl shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-text-secondary">{t('settings.leverage.title')}</h3>
                <span className="text-xs text-text-tertiary">{t('settings.leverage.okxOnly')}</span>
              </div>

              <div className="flex items-end gap-3">
                <AccountSelect
                  value={leverageAccountId}
                  onChange={setLeverageAccountId}
                  accounts={okxAccounts}
                  label={t('settings.leverage.account')}
                  className="flex-1"
                />

                <div className="flex-1">
                  <InstrumentInput
                    value={leverageInstId}
                    defaultValue=""
                    onChange={setLeverageInstId}
                    label={t('settings.leverage.instId')}
                    tooltip={t('settings.leverage.instIdTooltip')}
                    placeholder={t('settings.leverage.instIdPlaceholder')}
                    exchange="OKX"
                    allowEmpty={true}
                    className="w-full"
                  />
                </div>

                <div className="flex-1 space-y-2">
                  <label className={LABEL_BASE}>
                    <Tooltip content={t('settings.leverage.leverTooltip')}>
                      <DashedHint className="cursor-help">
                        {t('settings.leverage.lever')}
                      </DashedHint>
                    </Tooltip>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={125}
                    step={1}
                    value={leverageValue}
                    onChange={(e) => setLeverageValue(e.target.value)}
                    placeholder={t('settings.leverage.leverPlaceholder')}
                    className={INPUT_BASE}
                  />
                </div>

                <div className="flex-1 space-y-2">
                  <label className={LABEL_BASE}>{t('settings.leverage.mgnMode')}</label>
                  <Select
                    value={leverageMgnMode}
                    onChange={(e) => setLeverageMgnMode(e.target.value as 'cross' | 'isolated')}
                    containerClassName="w-full"
                  >
                    <option value="cross">{t('settings.leverage.mgnModeCross')}</option>
                    <option value="isolated">{t('settings.leverage.mgnModeIsolated')}</option>
                  </Select>
                </div>

                {leverageMgnMode === 'isolated' && (
                  <div className="flex-1 space-y-2">
                    <label className={LABEL_BASE}>{t('settings.leverage.posSide')}</label>
                    <Select
                      value={leveragePosSide}
                      onChange={(e) => setLeveragePosSide(e.target.value as 'long' | 'short')}
                      containerClassName="w-full"
                    >
                      <option value="long">{t('settings.leverage.posSideLong')}</option>
                      <option value="short">{t('settings.leverage.posSideShort')}</option>
                    </Select>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <Button
                  variant="primary"
                  onClick={handleSetLeverage}
                  disabled={leverageLoading || !leverageAccountId}
                  className="px-6"
                >
                  {leverageLoading ? t('settings.leverage.submitting') : t('settings.leverage.submit')}
                </Button>
              </div>

              {leverageProgress && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-secondary">
                      {t('settings.leverage.batchProgress', leverageProgress)}
                    </span>
                    <span className="text-text-tertiary">
                      {leverageProgress.total > 0 ? Math.round((leverageProgress.processed / leverageProgress.total) * 100) : 0}%
                    </span>
                  </div>
                  <div className="h-2 bg-surface-1 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-blue rounded-full transition-all duration-150 ease-out"
                      style={{
                        width: leverageProgress.total > 0
                          ? `${(leverageProgress.processed / leverageProgress.total) * 100}%`
                          : '0%',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="bg-surface-2 border border-border-default rounded-2xl shadow-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-text-secondary">{t('settings.databaseManagement')}</h3>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm text-text-secondary">{t('settings.selectBackupFile')}</label>
                <Select
                  value={selectedBackup}
                  onChange={(e) => setSelectedBackup(e.target.value)}
                  containerClassName="w-full"
                >
                  {backups.map((file) => {
                    const raw = file.split('.').pop() || '0';
                    const timestamp = parseInt(raw);
                    const date = new Date(timestamp);
                    const isValid = !Number.isNaN(timestamp) && Number.isFinite(timestamp) && !Number.isNaN(date.getTime()) && timestamp >= 1e12;
                    const formattedDate = isValid
                      ? `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} ${String(date.getHours()).padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
                      : file;
                    const showDate = formattedDate === file ? '' : ` (${formattedDate})`;
                    return (
                      <option key={file} value={file}>
                        {file}{showDate}
                      </option>
                    );
                  })}
                </Select>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="surface"
                  onClick={handleBackup}
                  disabled={!!backupStatus && backupStatus.includes('正在')}
                >
                  <Save className="w-4 h-4" />
                  {t('settings.backupDatabase')}
                </Button>
                <Button
                  variant="surface"
                  onClick={handleRestore}
                  disabled={!selectedBackup || (!!backupStatus && backupStatus.includes('正在'))}
                >
                  <RefreshCw className={`w-4 h-4 ${backupStatus === '正在恢复...' ? 'animate-spin' : ''}`} />
                  {t('settings.restoreBackup')}
                </Button>
              </div>

              {backupStatus && (
                <div className="text-xs text-brand-yellow/80 bg-brand-yellow/5 p-3 rounded-lg border border-brand-yellow/10">
                  {backupStatus}
                </div>
              )}
            </div>
          </div>

          <div className="bg-surface-2 border border-border-default rounded-2xl shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-text-secondary">{t('settings.shortcuts')}</h3>
            </div>
            <p className="text-3xs text-text-tertiary leading-relaxed">
              {t('settings.shortcutsDesc')}
            </p>
            <div className="space-y-2">
              {TAB_IDS.map((tabId) => {
                const shortcuts = getTabShortcuts(config);
                const currentValue = shortcuts[tabId] || '';
                const tabLabel = t(`nav.${tabId === 'apikeys' ? 'apikeys' : tabId}`);
                const isTabConflict = currentValue !== '' && TAB_IDS.some(
                  (other) => other !== tabId && shortcuts[other] === currentValue
                );
                const configConflictMsg = tabConflictMsgs[tabId] || '';
                const isConflict = isTabConflict || !!configConflictMsg;
                return (
                  <div
                    key={tabId}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${
                      isConflict
                        ? 'border-trade-red/30 bg-trade-red/5'
                        : 'border-border-subtle bg-surface-1'
                    }`}
                  >
                    <span className="text-xs text-text-secondary w-24 truncate">{tabLabel}</span>
                    <input
                      type="text"
                      value={currentValue}
                      maxLength={1}
                      onChange={(e) => {
                        const val = e.target.value.slice(-1);
                        const newShortcuts = { ...shortcuts, [tabId]: val };
                        updateConfig({ tab_shortcuts: newShortcuts });
                      }}
                      onKeyDown={(e) => {
                        e.preventDefault();
                        let key = '';
                        if (e.key === 'Backspace' || e.key === 'Delete') {
                          key = '';
                        } else if (e.key.length === 1 && e.key !== ' ') {
                          key = e.key;
                        } else {
                          return;
                        }
                        const newShortcuts = { ...shortcuts, [tabId]: key };
                        updateConfig({ tab_shortcuts: newShortcuts });
                      }}
                      placeholder={t('settings.shortcutsPlaceholder')}
                      className={`w-16 text-center px-2 py-1.5 rounded-md border bg-surface-1 text-sm font-mono text-text-primary outline-none transition-all ${
                        isConflict
                          ? 'border-trade-red/50 focus:border-trade-red'
                          : 'border-border-default focus:border-focus-ring'
                      }`}
                    />
                    {isConflict && (
                      <span className="text-2xs text-trade-red">
                        {isTabConflict ? t('settings.shortcutsConflict') : configConflictMsg}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <Button
              onClick={() => updateConfig({ tab_shortcuts: { ...DEFAULT_TAB_SHORTCUTS } })}
            >
              <RefreshCcw className="w-3.5 h-3.5" />
              {t('settings.shortcutsReset')}
            </Button>
          </div>

          <div className="bg-surface-2 border border-border-default rounded-2xl shadow-sm p-6">
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-2">
                <h3 className="text-base font-bold text-text-secondary">v{appVersion}</h3>
                <p className="text-3xs text-text-tertiary leading-relaxed">
                  {t('settings.checkUpdateDesc')}
                </p>
              </div>
              <div className="flex flex-col gap-2 ml-4">
                <Button
                  variant="surface"
                  onClick={async () => {
                    if (!window.electronAPI) return;
                    if (updateStatus === 'downloading') {
                      showToast(t('settings.downloadingWait'), 'error');
                      return;
                    }
                    setUpdateStatus('checking');
                    try {
                      await window.electronAPI.checkForUpdates();
                    } catch {
                      showToast(t('settings.updateCheckFailedBtn'), 'error');
                      setUpdateStatus('idle');
                    }
                  }}
                  disabled={updateStatus === 'downloading' || updateStatus === 'checking'}
                >
                  {updateStatus === 'downloading' ? (
                    <Download className="w-4 h-4 animate-bounce" />
                  ) : (
                    <RefreshCcw className={`w-4 h-4 ${updateStatus === 'checking' ? 'animate-spin' : ''}`} />
                  )}
                  {updateStatus === 'checking' ? t('settings.checking') : updateStatus === 'downloading' ? t('settings.downloadingBtn') : t('settings.checkUpdate')}
                </Button>
                {updateStatus !== 'idle' && (
                  <div className="text-xs text-brand-yellow/80 bg-brand-yellow/5 p-3 rounded-lg border border-brand-yellow/10 flex items-center gap-2">
                    {updateStatus === 'ready' ? '✅' : updateStatus === 'downloading' ? '⬇️' : ''}
                    {updateStatus === 'ready' ? t('settings.updateReady') : updateStatus === 'downloading' ? t('settings.downloadingPercent', { percent: downloadProgress.toFixed(0) }) : t('settings.checking')}
                  </div>
                )}
                {updateStatus === 'ready' && (
                  <Button
                    variant="surface"
                    onClick={async () => {
                      if (!window.electronAPI) return;
                      setConfirmModal({
                        isOpen: true,
                        message: t('settings.confirmInstallUpdate'),
                        onConfirm: async () => {
                          setConfirmModal(null);
                          try {
                            await window.electronAPI.restartAndUpdate();
                          } catch {
                            showToast(t('settings.installUpdateFailed'), 'error');
                          }
                        },
                      });
                    }}
                    className="w-full"
                  >
                    <RefreshCcw className="w-4 h-4" />
                    {t('settings.installUpdateNow')}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <ThirdPartyLicensesPanel />

          <div className="bg-surface-2 border border-border-default rounded-2xl shadow-sm p-6">
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-2">
                <h3 className="text-base font-bold text-text-secondary">{t('settings.backend')}</h3>
                <p className="text-3xs text-text-tertiary leading-relaxed">
                  {t('settings.restartBackendDesc')}
                </p>
              </div>
              <Button
                variant="surface"
                onClick={async () => {
                  try {
                    if (window.electronAPI) {
                      const newPort = await window.electronAPI.restartBackend();
                      showToast(t('settings.backendRestarted', { port: newPort }), 'success');
                      setTimeout(() => window.location.reload(), 500);
                    } else {
                      showToast('Dev 模式：请在 CMD 菜单中选 [1] 重新启动', 'success');
                      await fetch('/api/system/restart', { method: 'POST' });
                    }
                  } catch (e) {
                    showToast(t('settings.restartFailed', { error: e instanceof Error ? e.message : String(e) }), 'error');
                  }
                }}
              >
                <RefreshCw className="w-4 h-4" />
                {t('settings.restartBackend')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
});
