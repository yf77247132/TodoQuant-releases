import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ArrowUpDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import CoinIcon from '../ui/CoinIcon.tsx';
import { Tooltip } from '../ui/Tooltip.tsx';
import DashedHint from '../ui/DashedHint.tsx';
import { fmt } from './dashboard/sharedUtils.tsx';
import type { TickerData } from '../../services/MarketScanner.ts';

type SortField = 'change24h' | 'changeToday' | 'last' | 'volCcy24h';
type SortOrder = 'desc' | 'asc';

interface MarketMonitorModuleProps {
  onJumpToDIY?: (instId: string) => void;
}

export default React.memo(function MarketMonitorModule({ onJumpToDIY }: MarketMonitorModuleProps) {
  const { t } = useTranslation();
  const [sortBy, setSortBy] = useState<SortField>('changeToday');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [search, setSearch] = useState('');

  const { data: restData } = useQuery({
    queryKey: ['market', 'tickers'],
    queryFn: async () => {
      const res = await fetch('/api/market/tickers?exchange=okx&limit=999&sortBy=changeToday&order=desc');
      if (!res.ok) return { data: [] as TickerData[], total: 0, fetchedAt: 0 };
      return res.json() as Promise<{ ok: boolean; data: TickerData[]; total: number; fetchedAt: number }>;
    },
    refetchInterval: 5000,
    placeholderData: (prev) => prev,
  });

  const tickers = restData?.data || [];

  const filteredTickers = useMemo(() => {
    let list = tickers;
    if (search) {
      const q = search.toUpperCase();
      list = list.filter(t => t.instId.toUpperCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const diff = a[sortBy] - b[sortBy];
      return sortOrder === 'desc' ? -diff : diff;
    });
  }, [tickers, search, sortBy, sortOrder]);

  const toggleSort = useCallback((field: SortField) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  }, [sortBy]);

  const handleRowClick = useCallback((instId: string) => {
    if (onJumpToDIY) onJumpToDIY(instId);
  }, [onJumpToDIY]);

  const formatChange = (val: number | undefined) => {
    if (val == null || isNaN(val)) return <span className="font-mono text-text-muted">-</span>;
    const isPositive = val >= 0;
    return (
      <span className={`font-mono ${isPositive ? 'text-trade-green' : 'text-trade-red'}`}>
        {isPositive ? '+' : ''}{val.toFixed(2)}%
      </span>
    );
  };

  const formatPrice = (price: number | undefined, instId: string) => (price == null || isNaN(price)) ? '-' : fmt(price, instId);

  const formatVolume = (val: number | undefined) => {
    if (val == null || isNaN(val)) return '-';
    if (val >= 1e9) return `${(val / 1e9).toFixed(2)}B`;
    if (val >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
    if (val >= 1e3) return `${(val / 1e3).toFixed(2)}K`;
    return val.toFixed(2);
  };

  const getVolumeCcy = (instId: string) => {
    const parts = instId.split('-');
    if (parts.length >= 3 && parts[2] === 'SWAP') return parts[0];
    if (parts.length >= 2) return parts[1];
    return '';
  };

  const PriceRange = ({ low, high, last, instId }: { low?: number; high?: number; last?: number; instId: string }) => {
    if (low == null || high == null || last == null || isNaN(low) || isNaN(high) || isNaN(last)) {
      return <span className="font-mono text-text-muted text-[10px]">-</span>;
    }
    const range = high - low;
    const pos = range > 0 ? Math.max(0, Math.min(1, (last - low) / range)) : 0.5;
    return (
      <div className="flex flex-col gap-0.5 min-w-[70px]">
        <div className="relative h-3.5">
          <div className="absolute inset-x-0 bottom-1 h-px bg-text-muted/40" />
          <div
            className="absolute -translate-x-1/2 text-text-primary text-[10px] leading-none"
            style={{ left: `${pos * 100}%`, bottom: '4px' }}
          >
            ▼
          </div>
        </div>
        <div className="flex justify-between gap-1 text-[10px] text-text-tertiary font-mono leading-none">
          <span>{formatPrice(low, instId)}</span>
          <span>{formatPrice(high, instId)}</span>
        </div>
      </div>
    );
  };

  const sortIcon = (field: SortField) => (
    <ArrowUpDown className={`w-3 h-3 inline ml-1 transition-colors group-hover:text-white ${sortBy === field ? 'text-brand-yellow' : 'text-text-muted'}`} />
  );

  const getSymbol = (instId: string) => instId.split('-')[0];

  return (
    <div className="bg-surface-2 border border-border-default rounded-2xl shadow-sm overflow-hidden flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-2 border-b border-border-subtle">
        <Search className="w-4 h-4 text-text-muted shrink-0" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('monitor.searchPlaceholder')}
          className="flex-1 px-2 py-1 text-xs bg-surface-1 border border-border-default rounded text-text-primary focus:border-focus-ring focus:outline-none"
        />
        <span className="text-xs text-text-muted shrink-0">
          {filteredTickers.length}/{tickers.length}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
        <table className="w-full text-left text-xs whitespace-nowrap border-collapse">
          <thead className="bg-surface-2 text-text-tertiary sticky top-0 z-[var(--z-dropdown)]">
            <tr>
              <th className="px-3 py-2 font-medium w-[40px] text-left">#</th>
              <th className="px-3 py-2 font-medium text-left">{t('monitor.instId')}</th>
              <th className="px-3 py-2 font-medium text-left">
                <button onClick={() => toggleSort('last')} className="group inline-flex items-center transition-colors hover:text-white">
                  {t('monitor.lastPrice')}{sortIcon('last')}
                </button>
              </th>
              <th className="px-3 py-2 font-medium text-left">
                <button onClick={() => toggleSort('change24h')} className="group inline-flex items-center transition-colors hover:text-white">
                  {t('monitor.change24h')}{sortIcon('change24h')}
                </button>
              </th>
              <th className="px-3 py-2 font-medium text-left">
                <button onClick={() => toggleSort('changeToday')} className="group inline-flex items-center transition-colors hover:text-white">
                  {t('monitor.changeToday')}{sortIcon('changeToday')}
                </button>
              </th>
              <th className="px-3 py-2 font-medium text-left">
                <Tooltip content={t('monitor.volCcy24hTips')}>
                  <DashedHint>{t('monitor.volCcy24h')}</DashedHint>
                </Tooltip>
              </th>
              <th className="px-3 py-2 font-medium text-left">
                <Tooltip content={t('monitor.range24hTips')}>
                  <DashedHint>{t('monitor.range24h')}</DashedHint>
                </Tooltip>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredTickers.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-text-muted">
                  {t('monitor.noData')}
                </td>
              </tr>
            ) : (
              filteredTickers.map((ticker, idx) => (
                <tr
                  key={ticker.instId}
                  onClick={() => handleRowClick(ticker.instId)}
                  className="hover:bg-surface-3/50 transition-colors border-b border-border-subtle"
                >
                  <td className="px-3 py-2 text-text-muted font-mono align-middle">{idx + 1}</td>
                  <td className="px-3 py-2 align-middle">
                    <div className="flex items-center gap-1.5 font-mono text-text-primary">
                      <CoinIcon symbol={getSymbol(ticker.instId)} size={16} />
                      {ticker.instId}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-text-primary align-middle">{formatPrice(ticker.last, ticker.instId)}</td>
                  <td className="px-3 py-2 align-middle">{formatChange(ticker.change24h)}</td>
                  <td className="px-3 py-2 align-middle">{formatChange(ticker.changeToday)}</td>
                  <td className="px-3 py-2 font-mono text-text-tertiary align-middle">{formatVolume(ticker.volCcy24h)} <span className="text-text-muted">{getVolumeCcy(ticker.instId)}</span></td>
                  <td className="px-3 py-2 align-middle">
                    <PriceRange low={ticker.low24h} high={ticker.high24h} last={ticker.last} instId={ticker.instId} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="px-3 py-1.5 bg-surface-2 border-t border-border-subtle text-xs text-text-muted">
        {restData?.fetchedAt ? (
          <span>{t('monitor.lastUpdate')}: {new Date(restData.fetchedAt).toLocaleTimeString()}</span>
        ) : (
          <span>{t('monitor.loading')}</span>
        )}
        <span className="ml-2">OKX SWAP</span>
      </div>
    </div>
  );
});
