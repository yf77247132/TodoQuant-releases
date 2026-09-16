import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'neutral' | 'surface' | 'danger' | 'ghost' | 'outline';
type ButtonSize = 'xs' | 'sm' | 'md' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-yellow text-black hover:bg-brand-yellow/90',
  secondary: 'bg-brand-yellow/15 text-brand-yellow hover:bg-brand-yellow/25',
  neutral: 'bg-surface-3 hover:bg-surface-4 text-text-secondary hover:text-text-primary',
  surface: 'bg-surface-4 hover:bg-surface-5 text-text-secondary hover:text-text-primary',
  danger: 'bg-trade-red/15 text-trade-red hover:bg-trade-red/25',
  ghost: 'text-text-tertiary hover:text-text-primary hover:bg-surface-4/40',
  outline: 'bg-transparent border border-border-default text-text-secondary hover:text-text-primary',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-xs rounded',
  sm: 'h-7 px-3 text-xs rounded-lg',
  md: 'h-9 px-4 text-sm rounded-lg',
  icon: 'p-1.5 rounded-lg',
};

export default function Button({
  variant = 'surface',
  size = 'sm',
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 font-medium transition-colors select-none active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
