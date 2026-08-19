import React from 'react';
import { FileX2 } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  variant?: 'default' | 'card' | 'minimal';
  minHeight?: 'sm' | 'md' | 'lg';
}

const ICON_WRAP: Record<string, string> = {
  default: 'w-10 h-10',
  card: 'w-12 h-12',
  minimal: 'w-12 h-12',
};

const CONTAINER_PAD: Record<string, string> = {
  default: 'py-12 px-4',
  card: 'py-20 px-6',
  minimal: 'py-20 px-4',
};

const OPACITY: Record<string, string> = {
  default: 'opacity-30',
  card: 'opacity-40',
  minimal: 'opacity-5',
};

const TITLE_SIZE: Record<string, string> = {
  default: 'text-sm',
  card: 'text-base',
  minimal: 'text-sm',
};

const DESC_SIZE: Record<string, string> = {
  default: 'text-xs',
  card: 'text-sm',
  minimal: 'text-xs',
};

const MIN_H: Record<string, string> = {
  sm: 'min-h-[120px]',
  md: 'min-h-[200px]',
  lg: 'min-h-[300px]',
};

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  variant = 'default',
  minHeight = 'md',
}) => {
  const containerClass = [
    'flex flex-col items-center justify-center text-center',
    CONTAINER_PAD[variant],
    MIN_H[minHeight],
    variant === 'card' ? 'border-2 border-dashed border-border-default rounded-2xl bg-white/5' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={containerClass}>
      <div className={`mb-3 text-text-tertiary ${OPACITY[variant]} ${ICON_WRAP[variant]} flex items-center justify-center`}>
        {icon || <FileX2 className="w-full h-full" />}
      </div>
      <h3 className={`${TITLE_SIZE[variant]} font-medium text-text-muted mb-1`}>
        {title}
      </h3>
      {description && (
        <p className={`${DESC_SIZE[variant]} text-text-tertiary max-w-sm ${action ? 'mb-4' : ''}`}>
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
};
