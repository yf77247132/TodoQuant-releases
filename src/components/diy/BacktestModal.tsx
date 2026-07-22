import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { MODAL_BG } from '../../ui/inputStyles.ts';
import BacktestPanel, { type BacktestPanelProps } from './BacktestPanel.tsx';
import type { ConditionTemplate } from '../../types/diy.ts';

interface BacktestModalProps {
  open: boolean;
  onClose: () => void;
  conditionTemplates: ConditionTemplate[];
  timezone?: string;
}

export default function BacktestModal({
  open,
  onClose,
  conditionTemplates,
  timezone,
}: BacktestModalProps) {
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-confirm)] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      data-modal-open="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`relative w-full max-w-3xl max-h-[85vh] overflow-y-auto ${MODAL_BG} border border-border-default rounded-xl shadow-2xl animate-in zoom-in-95 duration-200`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-4 right-4 z-10">
          <button
            className="p-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-4 transition-colors"
            onMouseDown={(e) => { e.stopPropagation(); onClose(); }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <BacktestPanel
            conditionTemplates={conditionTemplates}
            timezone={timezone}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export { BacktestPanel, type BacktestPanelProps, buildRoiFromRows, buildConditionDescription, type RoiRow };
