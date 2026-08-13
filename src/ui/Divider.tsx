import React from 'react';

type DividerProps = React.HTMLAttributes<HTMLDivElement>;

export function Divider({ className = '', ...rest }: DividerProps) {
  return (
    <div className={`border-t border-border-subtle${className ? ' ' + className : ''}`} role="separator" aria-hidden="true" {...rest} />
  );
}

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

type DividedListProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
};

export function DividedList({ className = '', children, ...rest }: DividedListProps) {
  return (
    <div className={`divide-y divide-subtle${className ? ' ' + className : ''}`} {...rest}>
      {children}
    </div>
  );
}
