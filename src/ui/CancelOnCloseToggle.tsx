import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import Switch from './Switch.tsx';

interface CancelOnCloseToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
}

export const CancelOnCloseToggle: FC<CancelOnCloseToggleProps> = ({ checked, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between bg-surface-1 border border-border-subtle rounded-xl px-4 py-2.5">
      <div className="space-y-0.5">
        <span className="text-sm font-semibold text-text-secondary">{t('position.cancelOrdersOnCloseLabel')}</span>
        <p className="text-xs text-text-muted">{checked ? t('position.cancelOrdersOnCloseOn') : t('position.cancelOrdersOnCloseOff')}</p>
      </div>
      <Switch checked={checked} onChange={onChange} size="sm" />
    </div>
  );
};

export default CancelOnCloseToggle;
