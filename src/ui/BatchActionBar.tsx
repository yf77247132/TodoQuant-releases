import { memo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square, X } from 'lucide-react';
import Button from './Button.tsx';

interface BatchActionBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBatchStart: () => void;
  onBatchStop: () => void;
  onExitBatchMode: () => void;
}

const BatchActionBar = memo(({
  selectedCount,
  totalCount,
  onSelectAll,
  onDeselectAll,
  onBatchStart,
  onBatchStop,
  onExitBatchMode,
}: BatchActionBarProps) => {
  const { t } = useTranslation();
  const checkboxRef = useRef<HTMLInputElement>(null);

  const isAllSelected = selectedCount === totalCount && totalCount > 0;
  const isPartial = selectedCount > 0 && selectedCount < totalCount;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = isPartial;
    }
  }, [isPartial]);

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-brand-blue/10 border border-brand-blue/20 mb-3">
      <label className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors shrink-0 cursor-pointer">
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={isAllSelected}
          onChange={() => isAllSelected ? onDeselectAll() : onSelectAll()}
          className="rounded border-border-default bg-surface-1 text-brand-yellow focus:ring-focus-ring focus:ring-offset-0 cursor-pointer"
        />
        <span className="text-text-primary font-medium">
          {t('batch.selectedCount', { count: selectedCount })}
        </span>
      </label>

      <div className="flex-1" />

      <Button
        variant="secondary"
        onClick={onBatchStart}
        disabled={selectedCount === 0}
      >
        <Play className="w-3 h-3" />
        {t('batch.start')}
      </Button>

      <Button
        variant="danger"
        onClick={onBatchStop}
        disabled={selectedCount === 0}
      >
        <Square className="w-3 h-3" />
        {t('batch.stop')}
      </Button>

      <Button
        variant="ghost"
        onClick={onExitBatchMode}
        title={t('batch.exit')}
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
});

BatchActionBar.displayName = 'BatchActionBar';

export default BatchActionBar;
