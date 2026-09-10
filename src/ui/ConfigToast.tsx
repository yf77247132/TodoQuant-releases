import { createPortal } from 'react-dom';
import { Check, XCircle } from 'lucide-react';

interface ToastProps {
  message: string;
  type: 'success' | 'error';
}

export default function ConfigToast({ message, type }: ToastProps) {
  return createPortal(
    <div className={`fixed bottom-8 right-8 px-5 py-3 rounded-xl text-text-primary font-bold shadow-2xl z-[var(--z-tooltip)] animate-in fade-in slide-in-from-bottom-4 duration-300 flex items-center gap-2.5 ${
      type === 'success' ? 'bg-trade-green' : 'bg-trade-red'
    }`}>
      {type === 'success' ? (
        <Check className="w-4 h-4 flex-shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 flex-shrink-0" />
      )}
      {message}
    </div>,
    document.body
  );
}
