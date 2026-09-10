import { useTranslation } from 'react-i18next';
import Select from './Select.tsx';

interface AccountOption {
  id: string;
  name: string;
  color?: string;
}

interface AccountSelectProps {
  value: string;
  onChange: (value: string) => void;
  accounts: AccountOption[];
  label?: string;
  className?: string;
}

export default function AccountSelect({
  value,
  onChange,
  accounts,
  label,
  className = '',
}: AccountSelectProps) {
  const { t } = useTranslation();
  const displayLabel = label ?? t('ui.accountSelect.label');
  const currentAccount = accounts.find(a => a.id === value);
  const currentColor = currentAccount?.color || 'var(--color-text-secondary)';

  return (
    <div className={`space-y-2 ${className}`}>
      {displayLabel && <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">{displayLabel}</label>}
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ color: currentColor }}
        className="font-bold"
      >
        {accounts.map((acc) => {
          return (
            <option
              key={acc.id}
              value={acc.id}
              className="bg-surface-1"
              style={{ color: acc.color || 'var(--color-text-secondary)' }}
            >
              {acc.name}
            </option>
          );
        })}
      </Select>
    </div>
  );
}
