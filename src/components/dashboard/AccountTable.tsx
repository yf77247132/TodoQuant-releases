import DashedHint from '../../ui/DashedHint'
import { DividedRows } from '../../ui/Divider'
import React, { useState, useMemo, memo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Account } from '../../types/trading.ts';
import { ChevronDown, Filter, Plus, Shield } from 'lucide-react';
import Button from '../../ui/Button.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { ACCOUNT_FIELDS } from '../../constants/accountFields.ts';
import { DEFAULT_ACCOUNT_COLORS } from '../../constants/colors.ts';
import { Tooltip } from '../../ui/Tooltip.tsx';
import { fmt as fmtUtil } from './sharedUtils.tsx';

interface AccountTableProps {
  accounts: Account[];
  accountNames: Record<number, string>;
  accountExchanges: Record<number, string>;
  accountColors: Record<number, string>;
  accountIdNames?: Record<string, string>;
  accountIdColors?: Record<string, string>;
  accountIdExchanges?: Record<string, string>;
  wsStatus: Record<string, { connected: boolean, status?: string }>;
  onAddFirstAccount?: () => void;
  privacyMode?: boolean;
  emptyIcon?: React.ReactNode;
}

const fmt = (n: string | number, digits = 2) => fmtUtil(n, undefined, digits);

const AccountRow = memo(({ a, i: _i, accountNames, accountExchanges, accountColors, accountIdNames, accountIdColors, accountIdExchanges, wsInfo, privacyMode }: {
  a: Account;
  i: number;
  accountNames: Record<number, string>;
  accountExchanges: Record<number, string>;
  accountColors: Record<number, string>;
  accountIdNames?: Record<string, string>;
  accountIdColors?: Record<string, string>;
  accountIdExchanges?: Record<string, string>;
  wsInfo: { connected: boolean, status?: string } | undefined;
  privacyMode?: boolean;
}) => {
  const { t } = useTranslation();
  const isConnected = wsInfo?.connected;
  const isLoggingIn = wsInfo?.status === 'logging_in';
  const name = (a._accountId && accountIdNames?.[a._accountId]) || accountNames[a._account] || `#${a._account}`;
  const exchange = (a._accountId && accountIdExchanges?.[a._accountId])
    || accountExchanges[a._account]
    || (a._accountId ? (accountExchanges as Record<string, string>)[a._accountId] : undefined)
    || '--';
  const color = (a._accountId && accountIdColors?.[a._accountId]) || accountColors[a._account] || DEFAULT_ACCOUNT_COLORS[a._account % DEFAULT_ACCOUNT_COLORS.length];
  const usdtDetail = a.details?.find((d) => d.ccy === 'USDT');
  const mask = (v: string) => privacyMode ? '****' : v;

  return (
    <tr className="hover:bg-surface-3 transition-colors">
      <td className="px-3 py-2">
        <span className="font-bold" style={{ color }}>
          {name}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className="px-1.5 py-0.5 rounded bg-white/5 text-text-tertiary text-2xs uppercase font-bold">
          {exchange}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-trade-green shadow-[0_0_8px_color-mix(in_srgb,var(--color-trade-green)_50%,transparent)]' : isLoggingIn ? 'bg-brand-yellow animate-pulse' : 'bg-trade-red'}`}></div>
          <span className={isConnected ? 'text-trade-green' : isLoggingIn ? 'text-brand-yellow/80' : 'text-trade-red'}>
            {isConnected ? t('account.connected') : isLoggingIn ? t('account.loggingIn') : t('account.disconnected')}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 text-left font-mono text-brand-yellow">
        {isConnected && a.valuation?.totalBal ? mask(fmt(a.valuation.totalBal, 2)) : '-'}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {isConnected ? mask(fmt(usdtDetail?.availBal || '0', 2)) : '-'}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {isConnected ? mask(fmt(usdtDetail?.frozenBal || '0', 2)) : '-'}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {isConnected && a.savingsUsdt ? mask(fmt(a.savingsUsdt, 2)) : '-'}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {isConnected && a.savingsUsdc ? mask(fmt(a.savingsUsdc, 2)) : '-'}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {isConnected && a.valuation?.funding ? mask(fmt(a.valuation.funding, 2)) : '-'}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {isConnected && a.valuation?.trading ? mask(fmt(a.valuation.trading, 2)) : '-'}
      </td>
      <td className="px-3 py-2 text-left font-mono text-text-primary">
        {isConnected && a.valuation?.earn ? mask(fmt(a.valuation.earn, 2)) : '-'}
      </td>
    </tr>
  );
});

AccountRow.displayName = 'AccountRow';

export const AccountTable: React.FC<AccountTableProps> = memo(({ accounts, accountNames, accountExchanges, accountColors, accountIdNames, accountIdColors, accountIdExchanges, wsStatus, onAddFirstAccount, privacyMode, emptyIcon }) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  const filteredAccounts = useMemo(() => {
    if (!filter) return accounts;
    return accounts.filter(a => {
      if (!a) return false;
      const name = (a._accountId && accountIdNames?.[a._accountId]) || accountNames[a._account] || `#${a._account}`;
      return name === filter;
    });
  }, [accounts, filter, accountNames, accountIdNames]);

  const uniqueAccounts = useMemo(() => {
    const accs = new Set<string>();
    accounts.forEach(a => {
      if (!a) return;
      accs.add((a._accountId && accountIdNames?.[a._accountId]) || accountNames[a._account] || `#${a._account}`);
    });
    return Array.from(accs);
  }, [accounts, accountNames, accountIdNames]);

  const handleFilterClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom, left: rect.left });
    setActiveFilter(!activeFilter);
  }, [activeFilter]);

  const handleSelectFilter = useCallback((opt: string | null) => {
    setFilter(opt);
    setActiveFilter(false);
  }, []);

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon ?? <Shield className="w-full h-full" />}
        title={t('account.noAccounts')}
        action={onAddFirstAccount ? (
          <Button variant="secondary" onClick={onAddFirstAccount}>
            <Plus className="w-3.5 h-3.5" />
            {t('ui.configListLayout.addFirstConfig')}
          </Button>
        ) : undefined}
        minHeight="md"
      />
    );
  }

  return (
    <>
      <div className="overflow-auto custom-scrollbar max-h-[500px]">
        <table className="w-full text-left text-xs whitespace-nowrap">
        <thead className="bg-surface-2 text-text-tertiary sticky top-0 z-10">
          <tr>
            <th className="px-3 py-2 font-medium">
              <div className="relative inline-block group">
                <button
                  onClick={handleFilterClick}
                  className={`flex items-center gap-1 hover:text-text-primary transition-colors py-1 ${filter ? 'text-brand-yellow' : ''}`}
                >
                  {t('account.account')}
                  {filter ? <Filter size={10} /> : <ChevronDown size={10} />}
                </button>

                {activeFilter && createPortal(
                  <>
                    <div className="fixed inset-0 z-[var(--z-modal)]" onMouseDown={(e) => { if (e.target === e.currentTarget) setActiveFilter(false); }} />
                    <div
                      style={{
                        position: 'fixed',
                        top: dropdownPos.top,
                        left: dropdownPos.left,
                        zIndex: 101
                      }}
                      className="mt-1 w-36 bg-dropdown-hover border border-border-default rounded-md shadow-2xl py-1 flex flex-col max-h-[160px] overflow-y-auto custom-scrollbar"
                    >
                      <button
                        onClick={() => handleSelectFilter(null)}
                        className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-2xs text-text-secondary transition-colors"
                      >
                        {t('account.all')}
                      </button>
                      {uniqueAccounts.map(opt => (
                        <button
                          key={opt}
                          onClick={() => handleSelectFilter(opt)}
                          className={`w-full text-left px-3 py-1.5 hover:bg-white/5 text-2xs transition-colors ${filter === opt ? 'text-brand-yellow font-bold bg-brand-yellow/5' : 'text-text-primary'}`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </>,
                  document.body
                )}
              </div>
            </th>
            <th className="px-3 py-2 font-medium">{t('account.exchange')}</th>
            <th className="px-3 py-2 font-medium">{t('account.loginStatus')}</th>
            <th className="px-3 py-2 font-medium text-left">{t('account.valuation')}</th>
            <th className="px-3 py-2 font-medium text-left">
              <Tooltip content={t('account.availableBalanceTooltip')} className="inline-flex items-center">
                <DashedHint className="cursor-help">
                  {t(ACCOUNT_FIELDS.AVAILABLE_BALANCE)}
                </DashedHint>
              </Tooltip>
            </th>
            <th className="px-3 py-2 font-medium text-left">
              <Tooltip content={t('account.frozenBalanceTooltip')} className="inline-flex items-center">
                <DashedHint className="cursor-help">
                  {t('account.frozenBalance')}
                </DashedHint>
              </Tooltip>
            </th>
            <th className="px-3 py-2 font-medium text-left">
              <Tooltip content={t('account.savingsUsdtTooltip')} className="inline-flex items-center">
                <DashedHint className="cursor-help">
                  {t('account.savingsUsdt')}
                </DashedHint>
              </Tooltip>
            </th>
            <th className="px-3 py-2 font-medium text-left">
              <Tooltip content={t('account.savingsUsdcTooltip')} className="inline-flex items-center">
                <DashedHint className="cursor-help">
                  {t('account.savingsUsdc')}
                </DashedHint>
              </Tooltip>
            </th>
            <th className="px-3 py-2 font-medium text-left">{t('account.fundingAccount')}</th>
            <th className="px-3 py-2 font-medium text-left">
              <Tooltip content={t('account.tradingAccountTooltip')} className="inline-flex items-center">
                <DashedHint className="cursor-help">
                  {t('account.tradingAccount')}
                </DashedHint>
              </Tooltip>
            </th>
            <th className="px-3 py-2 font-medium text-left">
              <Tooltip content={t('account.earnAccountTooltip')} className="inline-flex items-center">
                <DashedHint className="cursor-help">
                  {t('account.earnAccount')}
                </DashedHint>
              </Tooltip>
            </th>
          </tr>
        </thead>
        <DividedRows>
          {filteredAccounts.map((a, i) => (
            <AccountRow
              key={`${a._accountId || a._account}-${i}`}
              a={a}
              i={i}
              accountNames={accountNames}
              accountExchanges={accountExchanges}
              accountColors={accountColors}
              accountIdNames={accountIdNames}
              accountIdColors={accountIdColors}
              accountIdExchanges={accountIdExchanges}
              wsInfo={wsStatus[a._account]}
              privacyMode={privacyMode}
            />
          ))}
        </DividedRows>
      </table>
      </div>
    </>
  );
});
AccountTable.displayName = 'AccountTable';
