import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import Button from './Button.tsx';

interface ConfirmModalProps {
  open: boolean;
  title?: string;
  message: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  confirmLabel?: string;
  cancelLabel?: string;
}

export default function ConfirmModal({
  open,
  title,
  message,
  onClose,
  onConfirm,
  confirmLabel,
  cancelLabel,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  if (!open) return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-[var(--z-confirm)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      data-modal-open="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="relative w-full max-w-sm bg-surface-2 border border-border-default p-6 rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-text-secondary mb-2">{title || t('ui.confirmModal.defaultTitle')}</h3>
        <p className="text-sm text-text-secondary leading-relaxed mb-6">{message}</p>
        
        <div className="flex justify-end gap-3">
          <Button 
            variant="ghost"
            size="md"
            onClick={onClose}
            className="rounded-xl"
          >
            {cancelLabel || t('ui.confirmModal.cancel')}
          </Button>
          <Button
            variant="primary"
            size="md"
            className="rounded-xl"
            onClick={async () => {
              try {
                await onConfirm();
                onClose();
              } catch {
              }
            }}
          >
            {confirmLabel || t('ui.confirmModal.confirm')}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
