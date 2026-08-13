import React from 'react';
import Button from './Button.tsx';

interface CompactButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'secondary' | 'danger' | 'surface' | 'ghost';
  isSquare?: boolean;
  children: React.ReactNode;
}

export default function CompactButton({
  variant = 'surface',
  isSquare = false,
  className = '',
  children,
  ...rest
}: CompactButtonProps) {
  return (
    <Button
      variant={variant}
      size="xs"
      className={`rounded ${isSquare ? 'w-6 h-6 !px-0 flex items-center justify-center' : ''} ${className}`}
      {...rest}
    >
      {children}
    </Button>
  );
}
