import React, { memo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Edit3, Trash2, Play, Square, ArrowUpToLine, Copy } from 'lucide-react';
import CompactButton from './CompactButton.tsx';
import ConfirmModal from './ConfirmModal.tsx';
import { Spinner } from './Spinner';
import { Badge } from './Badge.tsx';
import { shortcutKeyToBadge } from './ShortcutKeyInput.tsx';
import CoinIcon from './CoinIcon.tsx';

interface ConfigCardProps {
  name: string;
  isRunning: boolean;
  isSelected?: boolean;
  testMode?: boolean;
  onClick?: () => void;
  onEdit: () => void;
  onDuplicate?: () => void;
  onPin?: () => void;
  onDelete: () => void;
  onStart: () => void;
  onStop: () => void;
  children: ReactNode;
  showStatus?: boolean;
  showActions?: boolean;
  showStartStop?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  deleteConfirmMsg?: string;
  batchMode?: boolean;
  isBatchSelected?: boolean;
  onToggleSelect?: () => void;
  shortcutKey?: string;
  instId?: string;
  extraBadge?: React.ReactNode;
}

const ConfigCard = memo(({
  name,
  isRunning,
  isSelected = false,
  testMode = false,
  onClick,
  onEdit,
  onDuplicate,
  onPin,
  onDelete,
  onStart,
  onStop,
  children,
  showStatus = true,
  showActions = true,
  showStartStop = true,
  icon: Icon,
  deleteConfirmMsg,
  batchMode = false,
  isBatchSelected = false,
  onToggleSelect,
  shortcutKey,
  extraBadge,
  instId,
}: ConfigCardProps) => {
  const { t } = useTranslation();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
      className={`group relative bg-surface-2 border rounded-2xl p-3 cursor-pointer transition-all shadow-sm ${
        isSelected
          ? 'border-brand-blue/50 bg-brand-blue/[0.08] shadow-[0_0_6px_color-mix(in_srgb,var(--color-brand-blue)_50%,transparent)]'
          : 'border-border-default hover:border-border-strong hover:bg-surface-3'
      }`}
    >
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {batchMode ? (
          <label
            className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={isBatchSelected}
              onChange={() => onToggleSelect?.()}
              onClick={(e) => e.stopPropagation()}
              className="rounded border-border-default bg-surface-1 text-brand-yellow focus:ring-focus-ring focus:ring-offset-0 cursor-pointer shrink-0"
            />
            {showStatus && <div className={`w-2 h-2 rounded-full shrink-0 ${isRunning ? 'bg-trade-green shadow-[0_0_6px_color-mix(in_srgb,var(--color-trade-green)_50%,transparent)] animate-pulse' : 'bg-surface-4'}`} />}
            {Icon && <Icon className="w-4 h-4 text-text-tertiary" />}
            {instId && <CoinIcon symbol={instId.split("-")[0]} size={16} />}
            <span className="text-sm font-bold text-text-primary">{name || t('ui.configCard.unnamed')}</span>
            {shortcutKey && (
              <span className="px-1.5 py-0.5 rounded text-2xs font-mono bg-surface-3 text-text-secondary border border-border-default">
                {shortcutKeyToBadge(shortcutKey)}
              </span>
            )}
            {extraBadge}
          </label>
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {showStatus && <div className={`w-2 h-2 rounded-full shrink-0 ${isRunning ? 'bg-trade-green shadow-[0_0_6px_color-mix(in_srgb,var(--color-trade-green)_50%,transparent)] animate-pulse' : 'bg-surface-4'}`} />}
            {Icon && <Icon className="w-4 h-4 text-text-tertiary" />}
            {instId && <CoinIcon symbol={instId.split("-")[0]} size={16} />}
            <span className="text-sm font-bold text-text-primary">{name || t('ui.configCard.unnamed')}</span>
            {shortcutKey && (
              <span className="px-1.5 py-0.5 rounded text-2xs font-mono bg-surface-3 text-text-secondary border border-border-default">
                {shortcutKeyToBadge(shortcutKey)}
              </span>
            )}
            {extraBadge}
          </div>
        )}

        {showStatus && isRunning && (
          <Badge variant="success" className="gap-1">
            <Spinner size="sm" className="text-trade-green" />
            {t('ui.configCard.running')}
          </Badge>
        )}

        {showActions && (
          <div className="flex items-center gap-1.5 ml-auto">
            <CompactButton
              isSquare
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              disabled={isRunning}
              title={t('ui.configCard.editConfig')}
            >
              <Edit3 className="w-3.5 h-3.5" />
            </CompactButton>

            {onDuplicate && (
              <CompactButton
                isSquare
                onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
                disabled={isRunning}
                title={t('ui.configCard.duplicateConfig')}
              >
                <Copy className="w-3.5 h-3.5" />
              </CompactButton>
            )}

            {onPin && (
              <CompactButton
                isSquare
                onClick={(e) => { e.stopPropagation(); onPin(); }}
                title={t('ui.configCard.pinToTop')}
              >
                <ArrowUpToLine className="w-3.5 h-3.5" />
              </CompactButton>
            )}

            <CompactButton
              variant="danger"
              isSquare
              className="text-text-tertiary hover:text-trade-red"
              onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
              disabled={isRunning}
              title={t('ui.configCard.deleteConfig')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </CompactButton>

            {showStartStop && (
              isRunning ? (
                <CompactButton
                  variant="danger"
                  onClick={(e) => { e.stopPropagation(); onStop(); }}
                  title={t('ui.configCard.stop')}
                >
                  <Square className="w-3.5 h-3.5" />
                  {t('ui.configCard.stop')}
                </CompactButton>
              ) : (
                <CompactButton
                  variant={testMode ? 'surface' : 'secondary'}
                  onClick={(e) => { e.stopPropagation(); onStart(); }}
                  title={t('ui.configCard.start')}
                >
                  <Play className="w-3.5 h-3.5" />
                  {testMode ? t('ui.configCard.simulation') : t('ui.configCard.start')}
                </CompactButton>
              )
            )}
          </div>
        )}
      </div>

      <div className="text-xs text-text-tertiary leading-relaxed mt-2">
        {children}
      </div>

      <ConfirmModal
        open={showDeleteConfirm}
        title={t('ui.configCard.confirmDelete')}
        message={deleteConfirmMsg || t('ui.configCard.deleteConfirmMsg', { name })}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          setShowDeleteConfirm(false);
          onDelete();
        }}
      />
    </div>
  );
});

ConfigCard.displayName = 'ConfigCard';

export default ConfigCard;
