import { useMemo, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import type { Position } from '../types/trading.ts';

const pnlKey = (p: Position): string => `${p._accountId ?? ''}|${p.instId}|${p.posSide}`;

const fmtPnl = (v: number): string => {
  if (Math.abs(v) < 0.005) return '0';
  const truncated = Math.trunc(v * 100) / 100;
  if (truncated === 0) return '0';
  const s = truncated.toString();
  return v > 0 ? '+' + s : s;
};

interface BatchClosePnlProps {
  positions: Position[];
  livePositions?: Position[];
  className?: string;
}

export const BatchClosePnl: FC<BatchClosePnlProps> = ({ positions, livePositions, className }) => {
  const { t } = useTranslation();
  const total = useMemo(() => {
    const live = new Map<string, Position>();
    for (const lp of livePositions || []) live.set(pnlKey(lp), lp);
    return positions.reduce((sum, p) => {
      const cur = live.get(pnlKey(p)) || p;
      const upl = parseFloat(cur?.upl || '0') || 0;
      const realizedPnl = parseFloat(cur?.realizedPnl || '0') || 0;
      return sum + upl + realizedPnl;
    }, 0);
  }, [positions, livePositions]);

  return (
    <div className={`flex items-center gap-2 px-1 pt-1 border-t border-border-subtle/50 ${className || ''}`}>
      <span className="text-xs text-text-tertiary">{t('position.closedPnl')}</span>
      <span className={`text-sm font-bold font-mono ${total >= 0 ? 'text-trade-green' : 'text-trade-red'}`}>
        {fmtPnl(total)}
      </span>
    </div>
  );
};

export default BatchClosePnl;
