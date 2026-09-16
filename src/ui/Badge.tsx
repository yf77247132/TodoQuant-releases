import React from 'react';

interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
  className?: string;
}

const variantClasses: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-surface-3 text-text-tertiary',
  success: 'bg-trade-green/10 text-trade-green',
  warning: 'bg-brand-yellow/10 text-brand-yellow',
  danger: 'bg-trade-red/10 text-trade-red',
};

export const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  children,
  className = '',
}) => {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-2xs font-medium ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
};
