
import React, { useState, useEffect } from 'react';
import { Key, Save, Edit3, X, Shield, Plus, Trash2, Lock, Eye, EyeOff, ShieldCheck, ArrowUpToLine } from 'lucide-react';
import { Exchange } from '../types/index.ts';
import ConfigHeader from '../ui/ConfigHeader.tsx';
import Button from '../ui/Button.tsx';
import ConfirmModal from '../ui/ConfirmModal.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { useTranslation } from 'react-i18next';
import { BINANCE_YELLOW, OKX_BLUE, DEFAULT_ACCOUNT_COLORS } from '../constants/colors.ts';

interface Account {
  id: string;
  name: string;
  exchange: Exchange;
  color?: string;
  apiKey: string;
  secretKey?: string;
  passphrase?: string;
  createdAt: number;
}

interface AccountWithDynamicFields extends Account {
  _fullApiKey?: string;
  _fullSecretKey?: string;
  _fullPassphrase?: string;
  _decryptionFailed?: boolean;
}

interface MasterKeyStatus {
  hasAccounts: boolean;
  isMemory: boolean;
}

const PRESET_COLORS = [
  { name: 'Yellow', value: BINANCE_YELLOW },
  { name: 'Blue', value: OKX_BLUE },
  { name: 'Green', value: '#00C076' },
  { name: 'Red', value: '#FF4D4D' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Orange', value: '#f97316' },
];

export default React.memo(function ApiKeysModule({ autoOpenAdd, onAutoOpenHandled, isActive = true }: { autoOpenAdd?: boolean; onAutoOpenHandled?: () => void; isActive?: boolean }) {
  const [accounts, setAccounts] = useState<AccountWithDynamicFields[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [masterKey, setMasterKey] = useState('');
  const [isMasterKeySet, setIsMasterKeySet] = useState(false);
  const [mkStatus, setMkStatus] = useState<MasterKeyStatus | null>(null);
  const [showMasterKeyInput, setShowMasterKeyInput] = useState(false);
  const [newAcc, setNewAcc] = useState({
    name: '',
    exchange: Exchange.OKX,
    color: BINANCE_YELLOW,
    apiKey: '',
    secretKey: '',
    passphrase: ''
  });
  const [saveStatus, setSaveStatus] = useState('');
  const [addVisible, setAddVisible] = useState({ apiKey: true, secretKey: false, passphrase: false });
  const [masterKeyVisible, setMasterKeyVisible] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    exchange: Exchange.OKX,
    color: BINANCE_YELLOW,
    apiKey: '',
    secretKey: '',
    passphrase: ''
  });

  useEffect(() => {
    if (autoOpenAdd) {
      setShowAddModal(true);
      onAutoOpenHandled?.();
    }
  }, [autoOpenAdd, onAutoOpenHandled]);

  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const { t } = useTranslation();

  const toggleVisibility = (id: string, field: string) => {
    const key = `${id}-${field}`;
    const willShow = !visibleKeys[key];

    if (willShow && editingId !== id) {
      const acc = accounts.find(a => a.id === id);
      if (acc && !acc._fullApiKey) {
        handleReveal(id);
      }
    }

    setVisibleKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const isVisible = (id: string, field: string) => !!visibleKeys[`${id}-${field}`];

  const handleReveal = async (id: string) => {
    if (!masterKey && !isMasterKeySet) {
      setSaveStatus(t('apikeys.masterKeyRequired'));
      setTimeout(() => setSaveStatus(''), 3000);
      return;
    }

    try {
      const res = await fetch(`/api/accounts/${id}/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: masterKey || '' })
      });
      const data = await res.json();
      if (data.ok) {
        setAccounts(prev => prev.map(acc => {
          if (acc.id === id) {
            return {
              ...acc,
              _fullApiKey: data.data.apiKey,
              _fullSecretKey: data.data.secretKey,
              _fullPassphrase: data.data.passphrase
            } as AccountWithDynamicFields;
          }
          return acc;
        }));
      } else {
        setSaveStatus(t('apikeys.revealFailed', { error: data.error }));
        setTimeout(() => setSaveStatus(''), 3000);
      }
    } catch (e) {
      setSaveStatus(t('apikeys.revealSystemError'));
      setTimeout(() => setSaveStatus(''), 3000);
    }
  };

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/accounts');
      const data = await res.json();
      if (data.ok && Array.isArray(data.data)) {
        setAccounts(data.data.map((acc: Account) => ({
          ...acc,
          exchange: ((acc.exchange as string) || '').toUpperCase() as Exchange
        })));
      }
    } finally {
      setLoading(false);
    }
  };

  const checkMasterKeyStatus = async () => {
    try {
      const res = await fetch('/api/master-key/status');
      const data = await res.json();
      if (data.ok) {
        setIsMasterKeySet(data.isSet);
        setMkStatus(data);
      }
    } catch (e) {
      console.error('检查主密钥状态失败:', e);
    }
  };

  useEffect(() => {
    fetchAccounts();
    checkMasterKeyStatus();
  }, []);

  const handleSaveMasterKey = async () => {
    if (!masterKey || masterKey.length < 6) {
      setSaveStatus(t('apikeys.masterKeyTooShort'));
      setTimeout(() => setSaveStatus(''), 3000);
      return;
    }
    try {
      const res = await fetch('/api/master-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: masterKey, saveToDisk: true })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setSaveStatus(t('apikeys.masterKeySavedToLocal'));
        setIsMasterKeySet(true);
        setShowMasterKeyInput(false);
        setMasterKey('');
        fetchAccounts();
      } else {
        const errorMsg = (data.error || '').replace(/^\[USER\]\s*/, '');
        setSaveStatus(t('apikeys.saveMasterKeyFailed', { error: errorMsg }));
      }
    } catch (e) {
      setSaveStatus(t('apikeys.systemNetworkError', { detail: (e as Error).message || String(e) }));
    }
    setTimeout(() => setSaveStatus(''), 5000);
  };

  const handleAddAccount = async () => {
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAcc)
      });
      const data = await res.json();
      if (data.ok) {
        setSaveStatus(t('apikeys.accountAdded'));
        setShowAddModal(false);
        setNewAcc({ name: '', exchange: Exchange.OKX, color: PRESET_COLORS[0].value, apiKey: '', secretKey: '', passphrase: '' });
        fetchAccounts();
      } else {
        const errorMsg = (data.error || '').replace(/^\[USER\]\s*/, '');
        setSaveStatus(t('apikeys.addAccountFailed', { error: errorMsg }));
      }
    } catch (e) {
      setSaveStatus(t('apikeys.systemNetworkError', { detail: (e as Error).message || String(e) }));
    }
    setTimeout(() => setSaveStatus(''), 5000);
  };

  const handleEditAccount = (acc: Account) => {
    setEditingId(acc.id);
    setEditForm({
      name: acc.name,
      exchange: ((acc.exchange as string) || '').toUpperCase() as Exchange,
      color: acc.color || BINANCE_YELLOW,
      apiKey: '',
      secretKey: '',
      passphrase: ''
    });
  };

  const handleSaveAccount = async (id: string) => {
    try {
      const res = await fetch(`/api/accounts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });
      const data = await res.json();
      if (data.ok) {
        setSaveStatus(t('apikeys.accountUpdated'));
        setEditingId(null);
        fetchAccounts();
      } else {
        const errorMsg = (data.error || '').replace(/^\[USER\]\s*/, '');
        setSaveStatus(t('apikeys.updateAccountFailed', { error: errorMsg }));
      }
    } catch (e) {
      setSaveStatus(t('apikeys.systemNetworkError', { detail: (e as Error).message || String(e) }));
    }
    setTimeout(() => setSaveStatus(''), 5000);
  };

  const handleDeleteAccount = (id: string, name: string) => {
    setConfirmModal({
      isOpen: true,
      message: t('apikeys.confirmDeleteAccount', { name }),
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
          if (res.ok) {
            setSaveStatus(t('apikeys.accountDeleted'));
            await fetchAccounts();
          } else {
            setSaveStatus(t('apikeys.deleteAccountFailed'));
          }
        } catch (e) {
          setSaveStatus(t('apikeys.systemNetworkError', { detail: (e as Error).message || String(e) }));
        }
        setTimeout(() => setSaveStatus(''), 5000);
        setConfirmModal(null);
      }
    });
  };

  const handlePin = async (id: string) => {
    const previousAccounts = [...accounts];
    const idx = accounts.findIndex(acc => acc.id === id);
    if (idx === -1) return;

    const [account] = previousAccounts.splice(idx, 1);
    setAccounts([account, ...previousAccounts]);

    try {
      const res = await fetch(`/api/accounts/${id}/pin`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setSaveStatus(t('apikeys.accountPinned'));
        await fetchAccounts();
      } else {
        setSaveStatus(t('apikeys.pinFailed'));
        setAccounts(previousAccounts);
      }
    } catch (e) {
      setSaveStatus(t('apikeys.systemNetworkError', { detail: (e as Error).message || String(e) }));
      setAccounts(previousAccounts);
    }
    setTimeout(() => setSaveStatus(''), 3000);
  };

  if (!isActive) return <div className="flex flex-col flex-1 min-h-0" />;
  return (
    <div className="flex flex-col space-y-6 animate-in fade-in duration-500">
      <ConfigHeader
        icon={Key}
        iconColor="text-brand-yellow"
        title={t('nav.apikeys')}
        subtitle={t('apikeys.management')}
        addLabel={t('apikeys.addExchangeAccount')}
        onAdd={() => setShowAddModal(true)}
      />

      <div className="mb-6 p-4 bg-brand-blue/5 border border-brand-blue/20 rounded-2xl backdrop-blur-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-brand-blue shrink-0 mt-0.5" />
          <p className="text-sm text-text-secondary leading-relaxed">{t('apikeys.encryptionInfo')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {accounts.map((acc, idx) => (
          <div key={acc.id} className="bg-surface-2 border border-border-default rounded-2xl shadow-sm p-6 space-y-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Shield className="w-24 h-24" />
            </div>

            <div className="flex items-center justify-between relative z-10">
              <div className="flex items-center gap-4">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-lg shadow-inner"
                  style={{
                    backgroundColor: `${acc.color || DEFAULT_ACCOUNT_COLORS[idx % DEFAULT_ACCOUNT_COLORS.length]}15`,
                    color: acc.color || DEFAULT_ACCOUNT_COLORS[idx % DEFAULT_ACCOUNT_COLORS.length],
                    border: `1px solid ${acc.color || DEFAULT_ACCOUNT_COLORS[idx % DEFAULT_ACCOUNT_COLORS.length]}30`
                  }}
                >
                  {idx + 1}
                </div>
                <div>
                  {editingId === acc.id ? (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-full bg-surface-1 border border-border-default rounded-lg px-4 py-2.5 text-sm text-text-secondary focus:border-focus-ring outline-none transition-all placeholder-text-muted disabled:bg-white/5 disabled:border-border-subtle disabled:text-text-muted disabled:cursor-not-allowed py-1.5 px-3 text-sm w-48"
                        placeholder={t('apikeys.accountName')}
                      />
                      <div className="flex gap-2">
                        {[Exchange.OKX, Exchange.BINANCE].map(ex => (
                          <button
                            key={ex}
                            onClick={() => setEditForm({ ...editForm, exchange: ex })}
                            className={`px-3 py-1 rounded-lg text-2xs font-bold uppercase border transition-all flex items-center gap-1.5 ${
                              editForm.exchange === ex
                                ? 'bg-brand-yellow text-black border-brand-yellow shadow-lg shadow-brand-yellow/20'
                                : 'bg-white/5 border-border-default text-text-tertiary hover:text-text-secondary'
                            }`}
                          >
                            <img src={`/${ex.toLowerCase()}.png`} alt={ex} className="w-8 h-8 rounded-md" />
                            {ex}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2 mt-1">
                        {PRESET_COLORS.map(c => (
                          <button
                            key={c.value}
                            onClick={() => setEditForm({ ...editForm, color: c.value })}
                            className={`w-5 h-5 rounded border-2 transition-all ${
                              editForm.color === c.value ? 'border-white scale-110 shadow-lg' : 'border-transparent opacity-40 hover:opacity-100'
                            }`}
                            style={{ backgroundColor: c.value }}
                            title={c.name}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <h3 className="text-xl font-bold text-text-secondary flex items-center gap-3">
                        {acc.name}
                        <span className="px-2.5 py-1 rounded-lg text-2xs bg-white/10 text-text-secondary uppercase font-black tracking-wider border border-border-default">
                          {acc.exchange}
                        </span>
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-trade-green shadow-[0_0_8px_color-mix(in_srgb,var(--color-trade-green)_50%,transparent)]"></div>
                        <span className="text-2xs font-bold text-text-muted uppercase tracking-[0.2em]">
                          ENCRYPTED & SECURE
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {editingId === acc.id ? (
                  <div className="flex items-center gap-2 bg-surface-3 p-1 rounded-xl border border-border-default">
                    <button
                      onClick={() => handleSaveAccount(acc.id)}
                      className="p-2.5 text-trade-green hover:bg-trade-green/10 rounded-lg transition-all"
                      title={t('common.save')}
                    >
                      <Save className="w-5 h-5" />
                    </button>
                    <div className="w-px h-4 bg-white/10"></div>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-2.5 text-text-tertiary hover:bg-white/10 rounded-lg transition-all"
                      title={t('common.cancel')}
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 bg-surface-3 p-1 rounded-xl border border-border-default opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleEditAccount(acc)}
                      className="p-2.5 text-text-tertiary hover:text-brand-yellow hover:bg-brand-yellow/10 rounded-lg transition-all"
                      title={t('apikeys.editAccount')}
                    >
                      <Edit3 className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handlePin(acc.id)}
                      className="p-2.5 text-text-tertiary hover:text-brand-yellow hover:bg-brand-yellow/10 rounded-lg transition-all"
                      title={t('ui.configCard.pinToTop')}
                    >
                      <ArrowUpToLine className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDeleteAccount(acc.id, acc.name)}
                      className="p-2.5 text-text-tertiary hover:text-trade-red hover:bg-trade-red/10 rounded-lg transition-all"
                      title={t('apikeys.deleteAccount')}
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4 relative z-10">
              <div className="space-y-2">
                <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">API_KEY</label>
                <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-3 border border-border-default rounded-xl">
                  <Lock className="w-3 h-3 text-text-muted shrink-0" />
                  {editingId === acc.id ? (
                    <div className="relative flex-1">
                      <input
                        type={isVisible(acc.id, 'apiKey') ? "text" : "password"}
                        value={editForm.apiKey}
                        onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })}
                        placeholder={t('apikeys.leaveBlankToSkip')}
                        className="bg-transparent border-none outline-none text-sm font-mono text-text-secondary w-full pr-8"
                      />
                      <button
                        onClick={() => toggleVisibility(acc.id, 'apiKey')}
                        className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-text-tertiary hover:text-text-primary transition-colors"
                      >
                        {isVisible(acc.id, 'apiKey') ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  ) : (
                    <div className="relative flex-1 min-w-0 flex items-center justify-between gap-2">
                      <span className="text-sm font-mono text-text-secondary min-w-0 flex-1 truncate whitespace-nowrap">
                        {acc._decryptionFailed ? t('apikeys.decryptionFailed') : (isVisible(acc.id, 'apiKey') ? (acc._fullApiKey || acc.apiKey) : acc.apiKey)}
                      </span>
                      <button
                        onClick={() => toggleVisibility(acc.id, 'apiKey')}
                        className="p-1 text-text-tertiary hover:text-text-primary transition-colors shrink-0"
                      >
                        {isVisible(acc.id, 'apiKey') ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">SECRET_KEY</label>
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-3 border border-border-default rounded-xl">
                    <Lock className="w-3 h-3 text-text-muted shrink-0" />
                    {editingId === acc.id ? (
                      <div className="relative flex-1">
                        <input
                          type={isVisible(acc.id, 'secretKey') ? "text" : "password"}
                          value={editForm.secretKey}
                          onChange={(e) => setEditForm({ ...editForm, secretKey: e.target.value })}
                          placeholder={t('apikeys.leaveBlankToSkip')}
                          className="bg-transparent border-none outline-none text-sm font-mono text-text-secondary w-full pr-8"
                      />
                      <button
                        onClick={() => toggleVisibility(acc.id, 'secretKey')}
                        className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-text-tertiary hover:text-text-primary transition-colors"
                      >
                        {isVisible(acc.id, 'secretKey') ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  ) : (
                    <div className="relative flex-1 min-w-0 flex items-center justify-between gap-2">
                      <span className="text-sm font-mono text-text-secondary min-w-0 flex-1 truncate whitespace-nowrap">
                        {acc._decryptionFailed ? t('apikeys.decryptionFailed') : (isVisible(acc.id, 'secretKey') ? (acc._fullSecretKey || acc.secretKey) : acc.secretKey)}
                      </span>
                      <button
                        onClick={() => toggleVisibility(acc.id, 'secretKey')}
                        className="p-1 text-text-tertiary hover:text-text-primary transition-colors shrink-0"
                      >
                        {isVisible(acc.id, 'secretKey') ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {acc.exchange === 'OKX' && (
                <div className="space-y-2">
                  <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">PASSPHRASE</label>
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-3 border border-border-default rounded-xl">
                    <Lock className="w-3 h-3 text-text-muted shrink-0" />
                    {editingId === acc.id ? (
                      <div className="relative flex-1">
                        <input
                          type={isVisible(acc.id, 'passphrase') ? "text" : "password"}
                          value={editForm.passphrase}
                          onChange={(e) => setEditForm({ ...editForm, passphrase: e.target.value })}
                          placeholder={t('apikeys.leaveBlankToSkip')}
                          className="bg-transparent border-none outline-none text-sm font-mono text-text-secondary w-full pr-8"
                        />
                        <button
                          onClick={() => toggleVisibility(acc.id, 'passphrase')}
                          className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-text-tertiary hover:text-text-primary transition-colors"
                        >
                          {isVisible(acc.id, 'passphrase') ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ) : (
                      <div className="relative flex-1 min-w-0 flex items-center justify-between gap-2">
                        <span className="text-sm font-mono text-text-secondary min-w-0 flex-1 truncate whitespace-nowrap">
                          {acc._decryptionFailed ? t('apikeys.decryptionFailed') : (isVisible(acc.id, 'passphrase') ? acc._fullPassphrase || acc.passphrase || '••••••••' : acc.passphrase || '••••••••')}
                        </span>
                        <button
                          onClick={() => toggleVisibility(acc.id, 'passphrase')}
                          className="p-1 text-text-tertiary hover:text-text-primary transition-colors shrink-0"
                        >
                          {isVisible(acc.id, 'passphrase') ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {accounts.length === 0 && !loading && (
          <div className="lg:col-span-2">
            <EmptyState
              icon={<Key className="w-full h-full" />}
              title={t('apikeys.noAccounts')}
              description={t('apikeys.addFirstAccount')}
              variant="card"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-12">
        <div className="bg-brand-blue/5 border border-brand-blue/20 rounded-2xl p-6">
          <div className="flex gap-4">
            <div className="w-12 h-12 rounded-full bg-brand-blue/10 flex items-center justify-center shrink-0">
              <Lock className="w-6 h-6 text-brand-blue" />
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-text-secondary">{t('apikeys.masterKeyConfig')}</h4>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${isMasterKeySet ? 'bg-trade-green' : (mkStatus?.hasAccounts ? 'bg-brand-yellow' : 'bg-trade-red')}`}></div>
                  <span className="text-2xs font-bold text-text-tertiary">
                    {isMasterKeySet ? (mkStatus?.isMemory ? t('apikeys.configuredMemory') : t('apikeys.configuredPersistent')) : (mkStatus?.hasAccounts ? t('apikeys.notConfiguredPlaintext') : t('apikeys.notConfigured'))}
                  </span>
                </div>
              </div>

              <div className="text-sm text-text-secondary leading-relaxed space-y-1">
                <p>{t('apikeys.masterKeyDesc1')}</p>
                <p>{t('apikeys.masterKeyDesc2')}</p>
                {showMasterKeyInput ? (
                  <div className="mt-3 space-y-3">
                    <div className="relative group">
                      <input
                        type={masterKeyVisible ? "text" : "password"}
                        value={masterKey}
                        onChange={(e) => setMasterKey(e.target.value)}
                        placeholder={t('apikeys.enterMasterKey')}
                        className="w-full bg-surface-1 border border-border-default rounded-lg px-4 py-2.5 text-sm text-text-secondary focus:border-focus-ring outline-none transition-all placeholder-text-muted disabled:bg-white/5 disabled:border-border-subtle disabled:text-text-muted disabled:cursor-not-allowed pr-10"
                      />
                      <button
                        onClick={() => setMasterKeyVisible(!masterKeyVisible)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-secondary transition-colors"
                      >
                        {masterKeyVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="primary" onClick={handleSaveMasterKey}>{t('apikeys.saveAndReEncrypt')}</Button>
                      <Button onClick={() => setShowMasterKeyInput(false)}>{t('common.cancel')}</Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-3">
                    <Button
                      onClick={() => setShowMasterKeyInput(true)}
                    >
                      {isMasterKeySet ? t('apikeys.modifyMasterKey') : t('apikeys.configureNow')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-brand-yellow/5 border border-brand-yellow/20 rounded-2xl p-6">
          <div className="flex gap-4">
            <div className="w-12 h-12 rounded-full bg-brand-yellow/10 flex items-center justify-center shrink-0">
              <Shield className="w-6 h-6 text-brand-yellow" />
            </div>
            <div className="space-y-1">
              <h4 className="font-bold text-text-secondary">{t('apikeys.securityTips')}</h4>
              <p className="text-sm text-text-secondary leading-relaxed">
                1. <strong>{t('apikeys.securityTip1Title')}</strong>{t('apikeys.securityTip1Desc')}<br/>
                2. <strong>{t('apikeys.securityTip2Title')}</strong>{t('apikeys.securityTip2Desc')}<br/>
                3. <strong>{t('apikeys.securityTip3Title')}</strong>{t('apikeys.securityTip3Desc')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {showAddModal && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAddModal(false); }}
        >
          <div
            className="bg-surface-2 border border-border-default rounded-2xl w-full max-w-md p-8 space-y-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-text-secondary flex items-center gap-2">
                <Plus className="w-5 h-5 text-brand-yellow" />
                {t('apikeys.addNewAccount')}
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-text-tertiary hover:text-text-primary">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-6">
              <div className="space-y-3">
                <label className="text-xs font-bold text-text-tertiary uppercase tracking-widest">{t('apikeys.selectExchange')}</label>
                <div className="grid grid-cols-2 gap-3">
                  {[Exchange.OKX, Exchange.BINANCE].map(ex => (
                    <button
                      key={ex}
                      onClick={() => setNewAcc({ ...newAcc, exchange: ex })}
                      className={`py-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-2 ${
                        newAcc.exchange === ex
                          ? 'bg-brand-yellow/10 border-brand-yellow text-brand-yellow shadow-lg shadow-brand-yellow/10'
                          : 'bg-white/5 border-border-default text-text-tertiary hover:border-border-default hover:text-text-secondary'
                      }`}
                    >
                      <img src={`/${ex.toLowerCase()}.png`} alt={ex} className="w-20 h-20 rounded-xl" />
                      <span className="text-xs font-black uppercase tracking-wider">{ex}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-tertiary uppercase tracking-widest">{t('apikeys.accountName')}</label>
                  <div className="relative group">
                    <input
                      type="text"
                      value={newAcc.name}
                      onChange={(e) => setNewAcc({ ...newAcc, name: e.target.value })}
                      className="w-full bg-white/5 border border-border-default rounded-xl px-4 py-2.5 text-sm text-text-primary focus:border-focus-ring focus:ring-1 focus:ring-focus-ring outline-none transition-all placeholder-text-muted"
                      placeholder={t('apikeys.accountNamePlaceholder')}
                    />
                  </div>
                </div>
                <div className="space-y-2 flex flex-col">
                  <label className="text-xs font-bold text-text-tertiary uppercase tracking-widest">{t('apikeys.identifyColor')}</label>
                  <div className="flex items-center gap-3 h-[38px]">
                    {PRESET_COLORS.map(c => (
                      <button
                        key={c.value}
                        onClick={() => setNewAcc({ ...newAcc, color: c.value })}
                        className={`w-5 h-5 rounded border-2 transition-all ${
                          newAcc.color === c.value ? 'border-white scale-110 shadow-lg' : 'border-transparent opacity-40 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: c.value }}
                        title={c.name}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-2 border-t border-border-default">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-tertiary uppercase tracking-widest">API Key</label>
                  <div className="relative group">
                    <input
                      type={addVisible.apiKey ? "text" : "password"}
                      value={newAcc.apiKey}
                      onChange={(e) => setNewAcc({ ...newAcc, apiKey: e.target.value })}
                      className="w-full bg-white/5 border border-border-default rounded-xl px-4 py-2.5 text-sm text-text-primary focus:border-focus-ring focus:ring-1 focus:ring-focus-ring outline-none transition-all placeholder-text-muted disabled:bg-white/5 disabled:border-border-subtle disabled:text-text-muted disabled:cursor-not-allowed font-mono pr-10"
                      placeholder={t('apikeys.apiKeyPlaceholder')}
                    />
                    <button
                      onClick={() => setAddVisible(prev => ({ ...prev, apiKey: !prev.apiKey }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-secondary transition-colors"
                    >
                      {addVisible.apiKey ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-tertiary uppercase tracking-widest">Secret Key</label>
                  <div className="relative group">
                    <input
                      type={addVisible.secretKey ? "text" : "password"}
                      value={newAcc.secretKey}
                      onChange={(e) => setNewAcc({ ...newAcc, secretKey: e.target.value })}
                      className="w-full bg-white/5 border border-border-default rounded-xl px-4 py-2.5 text-sm text-text-primary focus:border-focus-ring focus:ring-1 focus:ring-focus-ring outline-none transition-all placeholder-text-muted disabled:bg-white/5 disabled:border-border-subtle disabled:text-text-muted disabled:cursor-not-allowed font-mono pr-10"
                      placeholder={t('apikeys.secretKeyPlaceholder')}
                    />
                    <button
                      onClick={() => setAddVisible(prev => ({ ...prev, secretKey: !prev.secretKey }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-secondary transition-colors"
                    >
                      {addVisible.secretKey ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {newAcc.exchange === Exchange.OKX && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-tertiary uppercase tracking-widest">Passphrase</label>
                    <div className="relative group">
                      <input
                        type={addVisible.passphrase ? "text" : "password"}
                        value={newAcc.passphrase}
                        onChange={(e) => setNewAcc({ ...newAcc, passphrase: e.target.value })}
                        className="w-full bg-white/5 border border-border-default rounded-xl px-4 py-2.5 text-sm text-text-primary focus:border-focus-ring focus:ring-1 focus:ring-focus-ring outline-none transition-all placeholder-text-muted disabled:bg-white/5 disabled:border-border-subtle disabled:text-text-muted disabled:cursor-not-allowed font-mono pr-10"
                        placeholder={t('apikeys.passphrasePlaceholder')}
                      />
                      <button
                        onClick={() => setAddVisible(prev => ({ ...prev, passphrase: !prev.passphrase }))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-secondary transition-colors"
                      >
                        {addVisible.passphrase ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 flex gap-3">
              <Button variant="primary" size="md" className="rounded-xl flex-1" onClick={handleAddAccount}>
                {t('apikeys.confirmAdd')}
              </Button>
              <Button size="md" className="rounded-xl flex-1" onClick={() => setShowAddModal(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {saveStatus && (
        <div className={`fixed bottom-8 right-8 px-6 py-3 rounded-xl font-bold shadow-2xl animate-in slide-in-from-bottom-4 duration-300 z-[var(--z-modal)] ${
          saveStatus.startsWith('×') ? 'bg-trade-red text-text-primary' : 'bg-trade-green text-text-primary'
        }`}>
          {saveStatus}
        </div>
      )}

      <ConfirmModal
        open={!!confirmModal?.isOpen}
        message={confirmModal?.message || ''}
        onClose={() => setConfirmModal(null)}
        onConfirm={() => confirmModal?.onConfirm()}
      />
    </div>
  );
});
