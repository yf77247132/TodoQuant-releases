import { Plus, type LucideIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import Button from './Button.tsx';

interface ConfigHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  iconColor?: string;
  addLabel?: string;
  onAdd?: () => void;
  actions?: ReactNode;
}

export default function ConfigHeader({
  icon: Icon,
  title,
  subtitle,
  iconColor = 'text-text-primary',
  addLabel,
  onAdd,
  actions,
}: ConfigHeaderProps) {
  return (
    <div className="shrink-0 h-7 flex items-center">
      <div className="flex items-center justify-between w-full h-full">
        <div className="flex items-center gap-3">
          <Icon className={`w-5 h-5 ${iconColor}`} strokeWidth={2} />
          <div className="flex items-baseline gap-2.5">
            <h2 className="font-bold text-text-secondary text-base">{title}</h2>
            {subtitle && (
              <p className="text-xs text-text-tertiary">{subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {actions}
          {addLabel && onAdd && (
            <Button onClick={onAdd}>
              <Plus className="w-3 h-3" />
              {addLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
