import React from 'react';
import { ChartCandlestick } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from './Tooltip.tsx';
import { jumpToTvChart } from '../lib/tvSymbolRequest.ts';

interface KlineIconButtonProps {
  instId: string;
  size?: number;
  className?: string;
}

export default function KlineIconButton({ instId, size = 14, className = '' }: KlineIconButtonProps) {
  const { t } = useTranslation();
  return (
    <Tooltip content={t('position.clickToChart')}>
      <button
        type="button"
        className={`inline-flex items-center justify-center rounded p-0.5 text-text-tertiary hover:text-trade-green hover:bg-surface-3 transition-colors cursor-pointer shrink-0 ${className}`}
        onClick={(e: React.MouseEvent) => { e.stopPropagation(); jumpToTvChart(instId); }}
      >
        <ChartCandlestick style={{ width: size, height: size }} />
      </button>
    </Tooltip>
  );
}
