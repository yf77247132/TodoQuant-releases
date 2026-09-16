import React from 'react';

type DividedRowsProps = React.HTMLAttributes<HTMLTableSectionElement> & {
  children: React.ReactNode;
};

export function DividedRows({ className = '', children, ...rest }: DividedRowsProps) {
  return (
    <tbody className={`divide-y divide-subtle${className ? ' ' + className : ''}`} {...rest}>
      {children}
    </tbody>
  );
}
