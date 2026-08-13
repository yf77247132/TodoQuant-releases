import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import Button from './Button.tsx';

interface ConfigModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  saveLabel?: string;
  onSave: () => void | Promise<void>;
  onSaveAndStart?: () => void | Promise<void>;
  isLive?: boolean;
  statusMsg?: string;
  children: ReactNode;
  preview?: ReactNode;
  maxWidth?: string;
}

export default function ConfigModal({
  open,
  title,
  onClose,
  saveLabel,
  onSave,
  onSaveAndStart,
  isLive = false,
  statusMsg = '',
  children,
  preview,
  maxWidth,
}: ConfigModalProps) {
  const { t } = useTranslation();
  if (!open) return null;

  const effectiveMaxWidth = maxWidth ?? (preview ? 'max-w-2xl' : 'max-w-md');

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-dropdown)] flex items-center justify-center p-4"
      data-modal-open="true"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      />

      <div className={`relative w-full bg-surface-2 border border-border-default rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${effectiveMaxWidth}`}>
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border-default">
          <h3 className="text-base font-bold text-text-secondary">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-3 transition-colors">
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        <div className={`flex max-h-[80vh] bg-surface-2 ${preview ? '' : 'overflow-y-auto custom-scrollbar'}`}>
          <div className={`px-6 py-5 space-y-4 ${preview ? 'flex-1 min-w-0 overflow-y-auto custom-scrollbar' : ''}`}>
            {statusMsg && (
              <div className={`text-xs font-medium px-3 py-1.5 rounded-lg ${
                statusMsg.startsWith('✓') ? 'bg-trade-green/10 text-trade-green' :
                statusMsg.includes('正在') ? 'bg-brand-blue/10 text-brand-blue' :
                'bg-trade-red/10 text-trade-red'
              }`}>
                {statusMsg}
              </div>
            )}
            {children}
          </div>
          {preview && (
            <div className="w-[320px] shrink-0 border-l border-border-default bg-surface-1 px-3 py-4 overflow-y-auto overflow-x-auto">
              {preview}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-default bg-surface-1">
          <Button
            variant="ghost"
            size="md"
            onClick={onClose}
            className="rounded-xl"
          >
            {t('ui.configModal.cancel')}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={onSave}
            className="rounded-xl"
          >
            {saveLabel || t('ui.configModal.saveConfig')}
          </Button>
          {onSaveAndStart && (
            <Button
              variant={isLive ? 'secondary' : undefined}
              size="md"
              onClick={onSaveAndStart}
              className="rounded-xl border-none"
            >
              {t('ui.configModal.saveAndStart')}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
