
import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, LineChart } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip.tsx';
import DashedHint from '../ui/DashedHint.tsx';
import { fmt } from './dashboard/sharedUtils.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import type { FtBacktestResultDetail } from '../types/freqtrade.ts';
import { ftPairToOkxPair } from '../freqtrade/strategyGenerator.ts';

interface BacktestReportPanelProps {
  result: FtBacktestResultDetail | null;
  loading?: boolean;
  liveOnlyCount?: number;
  actions?: React.ReactNode;
  timerangeFrom?: string;
  timerangeTo?: string;
}

function fmtPct(value: number): string {
  return `${parseFloat((value * 100).toFixed(2))}%`;
}

function fmtMoney(value: number): string {
  return parseFloat(value.toFixed(2)).toString();
}

function formatDuration(dur: string): string {
  if (!dur || dur === '-') return '-';
  if (/[hms]/.test(dur) && !dur.match(/^\d+:\d+:\d+$/)) return dur;
  const match = dur.match(/^(\d+):(\d+):(\d+)$/);
  if (match) {
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (h > 0) return `${h}h${m}m`;
    return `${m}m`;
  }
  return dur;
}

const EXIT_REASON_KEY_MAP: Record<string, string> = {
  roi: 'backtest.exitReason.roi',
  stop_loss: 'backtest.exitReason.stopLoss',
  trailing_stop_loss: 'backtest.exitReason.trailingStopLoss',
  exit_signal: 'backtest.exitReason.exitSignal',
  force_exit: 'backtest.exitReason.forceExit',
  emergency_exit: 'backtest.exitReason.emergencyExit',
  custom_exit: 'backtest.exitReason.customExit',
  partial_exit: 'backtest.exitReason.partialExit',
};

function translateExitReason(t: (key: string) => string, reason: string): string {
  if (!reason) return '-';
  const base = reason.replace(/_\d+$/, '');
  const i18nKey = EXIT_REASON_KEY_MAP[base];
  return i18nKey ? t(i18nKey) : reason;
}

function SummaryCards({ summary }: { summary: FtBacktestResultDetail['summary'] }) {
  const { t } = useTranslation();

  const cards = [
    { label: t('backtest.report.initialCapital'), value: summary.startingBalance != null ? fmtMoney(summary.startingBalance) : '-', color: 'text-text-primary' },
    { label: t('backtest.report.finalCapital'), value: summary.finalBalance != null ? fmtMoney(summary.finalBalance) : '-', color: summary.finalBalance != null && summary.finalBalance >= (summary.startingBalance ?? 0) ? 'text-trade-green' : 'text-trade-red' },
    { label: t('backtest.report.totalProfitRate'), value: fmtPct(summary.profitTotal), color: summary.profitTotal >= 0 ? 'text-trade-green' : 'text-trade-red' },
    { label: t('backtest.report.totalProfit'), value: fmtMoney(summary.profitTotalAbs), color: summary.profitTotalAbs >= 0 ? 'text-trade-green' : 'text-trade-red' },
    { label: t('backtest.report.winRate'), value: fmtPct(summary.winRate), color: summary.winRate >= 0.5 ? 'text-trade-green' : 'text-trade-red' },
    { label: t('backtest.report.tradeCount'), value: String(summary.tradeCount), color: 'text-text-primary' },
    { label: t('backtest.report.profitLoss'), value: `${summary.winningTrades}/${summary.losingTrades}`, color: 'text-text-primary' },
    { label: t('backtest.report.maxDrawdown'), value: fmtPct(summary.maxDrawdown), color: 'text-trade-red', tip: summary.drawdownStart ? t('backtest.report.drawdownRange', { start: summary.drawdownStart.slice(0, 10), end: summary.drawdownEnd?.slice(0, 10) || '' }) : undefined },
    { label: t('backtest.report.avgProfit'), value: fmtPct(summary.avgProfit), color: summary.avgProfit >= 0 ? 'text-trade-green' : 'text-trade-red' },
    { label: t('backtest.report.avgDuration'), value: formatDuration(summary.avgDuration), color: 'text-text-tertiary' },
  ];

  if (summary.sharpe != null) cards.push({ label: t('backtest.report.sharpe'), value: fmt(summary.sharpe, undefined, 2), color: 'text-text-primary' });
  if (summary.sortino != null) cards.push({ label: t('backtest.report.sortino'), value: fmt(summary.sortino, undefined, 2), color: 'text-text-primary' });
  if (summary.calmar != null) cards.push({ label: t('backtest.report.calmar'), value: fmt(summary.calmar, undefined, 2), color: 'text-text-primary' });
  if (summary.sqn != null) cards.push({ label: t('backtest.report.sqn'), value: fmt(summary.sqn, undefined, 2), color: 'text-text-primary' });
  if (summary.profitFactor != null) cards.push({ label: t('backtest.report.profitFactor'), value: fmt(summary.profitFactor, undefined, 2), color: 'text-text-primary' });
  if (summary.expectancy != null) cards.push({ label: t('backtest.report.expectancy'), value: fmt(summary.expectancy, undefined, 2), color: 'text-text-primary' });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {cards.map((card, idx) => (
        <div key={idx} className="bg-surface-2 border border-border-subtle rounded px-3 py-2">
          <div className="text-xs text-text-tertiary mb-0.5">
            {card.tip ? (
              <Tooltip content={card.tip} placement="top">
                <DashedHint className="cursor-help">{card.label}</DashedHint>
              </Tooltip>
            ) : card.label}
          </div>
          <div className={`text-lg font-semibold ${card.color}`}>{card.value}</div>
        </div>
      ))}
    </div>
  );
}

function EquityCurve({ dailyStats, drawdownStart, drawdownEnd }: {
  dailyStats: FtBacktestResultDetail['dailyStats'];
  drawdownStart?: string;
  drawdownEnd?: string;
}) {
  const { t } = useTranslation();

  const [hovered, setHovered] = React.useState<number | null>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const rafRef = React.useRef<number | null>(null);

  if (!dailyStats || dailyStats.length === 0) {
    return (
      <div className="bg-surface-2 border border-border-subtle rounded p-4 text-center text-text-tertiary text-sm">
        {t('backtest.report.noDailyStats')}
      </div>
    );
  }

  const width = 700;
  const height = 200;
  const paddingX = 50;
  const paddingY = 20;
  const chartW = width - paddingX * 2;
  const chartH = height - paddingY * 2;

  const balances = dailyStats.map(d => d.balance);
  const minBalance = Math.min(...balances);
  const maxBalance = Math.max(...balances);
  const balanceRange = maxBalance - minBalance || 1;

  const pointCoords = dailyStats.map((d, i) => ({
    x: paddingX + (i / (dailyStats.length - 1)) * chartW,
    y: paddingY + chartH - ((d.balance - minBalance) / balanceRange) * chartH,
    date: d.date,
    balance: d.balance,
  }));
  const linePath = `M${pointCoords.map(p => `${p.x},${p.y}`).join(' L')}`;
  const yTicks = [minBalance, (minBalance + maxBalance) / 2, maxBalance];

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (rafRef.current != null) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const viewBoxX = ((e.clientX - rect.left) / rect.width) * width;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      let nearest = 0;
      let minDist = Infinity;
      for (let i = 0; i < pointCoords.length; i++) {
        const d = Math.abs(pointCoords[i].x - viewBoxX);
        if (d < minDist) { minDist = d; nearest = i; }
      }
      setHovered(nearest);
    });
  };

  const handleMouseLeave = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setHovered(null);
  };

  const hoveredPoint = hovered != null ? pointCoords[hovered] : null;

  return (
    <div className="bg-surface-2 border border-border-subtle rounded p-3">
      <div className="text-sm text-text-tertiary mb-2">{t('backtest.report.equityCurve')}</div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {yTicks.map((val, idx) => {
          const y = paddingY + chartH - ((val - minBalance) / balanceRange) * chartH;
          return (
            <g key={idx}>
              <line x1={paddingX} y1={y} x2={width - paddingX} y2={y} stroke="var(--color-border-subtle)" strokeWidth="0.5" />
              <text x={paddingX - 4} y={y + 3} textAnchor="end" fill="var(--color-text-tertiary)" fontSize="9">{fmtMoney(val)}</text>
            </g>
          );
        })}
        <path d={linePath} fill="none" stroke="var(--color-trade-green)" strokeWidth="1.5" />

        {(() => {
          if (!drawdownStart || !drawdownEnd) return null;
          const ds = drawdownStart.slice(0, 10);
          const de = drawdownEnd.slice(0, 10);
          let i1 = 0, i2 = 0, found1 = false;
          for (let i = 0; i < dailyStats.length; i++) {
            const d = String(dailyStats[i].date).slice(0, 10);
            if (!found1 && d >= ds) { i1 = i; found1 = true; }
            if (d >= de) { i2 = i; break; }
            i2 = i;
          }
          const p1 = pointCoords[i1];
          const p2 = pointCoords[i2];
          if (!p1 || !p2) return null;
          return (
            <g>
              <rect x={p1.x} y={paddingY} width={p2.x - p1.x} height={chartH} fill="var(--color-trade-red)" fillOpacity="0.08" />
              <line x1={p1.x} y1={paddingY} x2={p1.x} y2={paddingY + chartH} stroke="var(--color-trade-red)" strokeWidth="1" strokeDasharray="3,3" />
              <line x1={p2.x} y1={paddingY} x2={p2.x} y2={paddingY + chartH} stroke="var(--color-trade-red)" strokeWidth="1" strokeDasharray="3,3" />
            </g>
          );
        })()}

        <text x={paddingX} y={height - 2} fill="var(--color-text-muted)" fontSize="8">{dailyStats[0]?.date}</text>
        <text x={width - paddingX} y={height - 2} textAnchor="end" fill="var(--color-text-muted)" fontSize="8">{dailyStats[dailyStats.length - 1]?.date}</text>

        {hoveredPoint && (
          <g>
            <line x1={hoveredPoint.x} y1={paddingY} x2={hoveredPoint.x} y2={paddingY + chartH} stroke="var(--color-text-tertiary)" strokeWidth="0.5" strokeOpacity="0.5" />
            <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={3} fill="var(--color-trade-green)" stroke="var(--color-bg-dark)" strokeWidth="1" />
            <rect
              x={hoveredPoint.x - 60} y={hoveredPoint.y - 28 < paddingY ? hoveredPoint.y + 10 : hoveredPoint.y - 28}
              width={120} height={24} rx={4}
              fill="var(--color-surface-3)" stroke="var(--color-border-default)" strokeWidth="0.5"
            />
            <text
              x={hoveredPoint.x} y={hoveredPoint.y - 28 < paddingY ? hoveredPoint.y + 24 : hoveredPoint.y - 14}
              textAnchor="middle" fill="var(--color-text-secondary)" fontSize="9"
            >
              {hoveredPoint.date}  {fmtMoney(hoveredPoint.balance)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

function TradesTable({ trades }: { trades: FtBacktestResultDetail['trades'] }) {
  const { t } = useTranslation();

  if (!trades || trades.length === 0) {
    return (
      <div className="bg-surface-2 border border-border-subtle rounded p-4 text-center text-text-tertiary text-sm">
        {t('backtest.report.noTrades')}
      </div>
    );
  }

  const hasLeverage = trades.some(t => t.leverage != null && t.leverage > 1);

  return (
    <div className="bg-surface-2 border border-border-subtle rounded overflow-hidden">
      <div className="text-xs text-text-tertiary px-3 py-2 border-b border-border-subtle">
        {t('backtest.report.tradeDetailCount', { count: trades.length })}
      </div>
      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-surface-1 sticky top-0">
            <tr className="text-text-tertiary">
              <th className="text-left px-2 py-1.5 font-normal">{t('backtest.report.pair')}</th>
              <th className="text-left px-2 py-1.5 font-normal">{t('backtest.report.direction')}</th>
              {hasLeverage && <th className="text-left px-2 py-1.5 font-normal">{t('backtest.report.leverage')}</th>}
              <th className="text-left px-2 py-1.5 font-normal">{t('backtest.report.openRate')}</th>
              <th className="text-left px-2 py-1.5 font-normal">{t('backtest.report.closeRate')}</th>
              <th className="text-left px-2 py-1.5 font-normal">{t('backtest.report.profit')}</th>
              <th className="text-left px-2 py-1.5 font-normal">{t('backtest.report.profitRate')}</th>
              <th className="text-left px-2 py-1.5 font-normal">{t('backtest.report.duration')}</th>
              <th className="text-left px-2 py-1.5 font-normal">{t('backtest.report.exitReason')}</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade, idx) => (
              <tr key={idx} className="border-t border-border-subtle hover:bg-surface-3">
                <td className="px-2 py-1 text-text-primary">{ftPairToOkxPair(trade.pair)}</td>
                <td className={`px-2 py-1 ${trade.direction === 'long' ? 'text-trade-green' : 'text-trade-red'}`}>
                  {trade.direction === 'long' ? t('backtest.report.long') : t('backtest.report.short')}
                </td>
                {hasLeverage && (
                  <td className="px-2 py-1 text-text-tertiary">
                    {trade.leverage != null && trade.leverage > 1 ? `${trade.leverage}x` : '-'}
                  </td>
                )}
                <td className="px-2 py-1 text-text-primary font-mono">{fmt(trade.openRate)}</td>
                <td className="px-2 py-1 text-text-primary font-mono">{fmt(trade.closeRate)}</td>
                <td className={`px-2 py-1 font-mono ${trade.profit >= 0 ? 'text-trade-green' : 'text-trade-red'}`}>
                  {fmtMoney(trade.profit)}
                </td>
                <td className={`px-2 py-1 font-mono ${trade.profitRatio >= 0 ? 'text-trade-green' : 'text-trade-red'}`}>
                  {fmtPct(trade.profitRatio)}
                </td>
                <td className="px-2 py-1 text-text-tertiary">{formatDuration(trade.duration)}</td>
                <td className="px-2 py-1 text-text-tertiary">{translateExitReason(t, trade.exitReason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmtDateRange(s?: string): string {
  if (!s || s.length !== 8) return s || '';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export function BacktestReportPanel({ result, loading, liveOnlyCount, actions, timerangeFrom, timerangeTo }: BacktestReportPanelProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="bg-surface-2 border border-border-subtle rounded p-8 text-center">
        <div className="text-text-tertiary text-sm">{t('backtest.running')}</div>
        <div className="mt-2 w-32 h-1 bg-surface-4 rounded mx-auto animate-pulse" />
      </div>
    );
  }

  if (!result) {
    return (
      <EmptyState
        title={t('backtest.report.noResult')}
        minHeight="sm"
      />
    );
  }

  const actualStart = String(result.summary.backtestStart ?? '').slice(0, 10);
  const actualEnd = String(result.summary.backtestEnd ?? '').slice(0, 10);
  const userStart = fmtDateRange(timerangeFrom);
  const userEnd = fmtDateRange(timerangeTo);

  return (
    <div className="space-y-3">
      {liveOnlyCount != null && liveOnlyCount > 0 && (
        <div className="flex items-start gap-2 p-2.5 bg-amber-400/10 border border-amber-400/20 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <span className="text-2xs text-amber-400 leading-relaxed">
            {t('backtest.report.liveOnlyDisclaimer', { count: liveOnlyCount })}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-secondary flex items-center gap-2">
          <LineChart className="w-4 h-4 text-trade-green" />
          {t('backtest.report.title')}
        </h3>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {(userStart || userEnd) && (
        <div className="text-2xs text-text-muted flex flex-wrap items-center gap-x-2">
          <span>{t('backtest.report.timerangeLabel')}: {userStart} ~ {userEnd}</span>
          {actualStart && actualEnd && (actualStart !== userStart || actualEnd !== userEnd) && (
            <span className="text-text-tertiary">({t('backtest.report.dataRange', { start: actualStart, end: actualEnd })})</span>
          )}
        </div>
      )}

      <SummaryCards summary={result.summary} />
      <EquityCurve dailyStats={result.dailyStats} drawdownStart={result.summary.drawdownStart} drawdownEnd={result.summary.drawdownEnd} />
      <TradesTable trades={result.trades} />
    </div>
  );
}
