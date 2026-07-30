import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FileSearch } from 'lucide-react';
import { Spinner } from '../../ui/Spinner.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';
import Button from '../../ui/Button.tsx';
import { BacktestReportPanel } from '../BacktestReportPanel.tsx';
import type { FtBacktestResultDetail } from '../../types/freqtrade.ts';

type ReportPhase = 'idle' | 'detecting' | 'downloading' | 'running' | 'done' | 'error';

export interface BacktestReportAreaProps {
  phase: ReportPhase;
  result: FtBacktestResultDetail | null;
  liveOnlyCount: number;
  errorMsg: string;
  onRetry: () => void;
  timerangeFrom?: string;
  timerangeTo?: string;
}

export default function BacktestReportArea({
  phase,
  result,
  liveOnlyCount,
  errorMsg,
  onRetry,
  timerangeFrom,
  timerangeTo,
}: BacktestReportAreaProps) {
  const { t } = useTranslation();

  if (phase === 'idle') {
    return (
      <EmptyState
        icon={<FileSearch className="w-full h-full" />}
        title={t('backtest.resultPlaceholder')}
        description={t('backtest.resultPlaceholderHint')}
        variant="card"
        minHeight="lg"
      />
    );
  }

  if (phase === 'detecting') {
    return <Spinner size="lg" label={t('backtest.detecting')} />;
  }

  if (phase === 'downloading') {
    return <Spinner size="lg" label={t('backtest.downloading')} />;
  }

  if (phase === 'running') {
    return <Spinner size="lg" label={t('backtest.running')} />;
  }

  if (phase === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <AlertTriangle className="w-10 h-10 text-trade-red" />
        <p className="text-sm text-trade-red text-center max-w-md">
          {errorMsg?.startsWith('i18n:') ? t(errorMsg.slice(5)) : errorMsg}
        </p>
        <Button variant="primary" size="sm" className="rounded-xl" onClick={onRetry}>
          {t('backtest.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <BacktestReportPanel
        result={result}
        loading={false}
        liveOnlyCount={liveOnlyCount}
        timerangeFrom={timerangeFrom}
        timerangeTo={timerangeTo}
      />
    </div>
  );
}
