import React from 'react';
import { ChevronDown } from 'lucide-react';
import { INPUT_BASE } from './inputStyles.ts';

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  className?: string;
  containerClassName?: string;
  children?: React.ReactNode;
};

export default function Select({ className = '', containerClassName = '', children, ...props }: SelectProps) {
  const finalClassName = props.disabled
    ? `${INPUT_BASE} appearance-none pr-10 w-full !text-text-muted`
    : `${INPUT_BASE} appearance-none pr-10 w-full ${className}`;
    
  return (
    <div className={`relative ${containerClassName}`}>
      <select
        className={finalClassName}
        {...props}
      >
        {children}
      </select>
      <div className={`absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none ${props.disabled ? 'text-text-muted' : 'text-text-muted'}`}>
        <ChevronDown className="w-4 h-4" />
      </div>
    </div>
  );
}
