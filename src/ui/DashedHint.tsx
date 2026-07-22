import React from 'react';

type DashedHintProps = React.HTMLAttributes<HTMLElement> & {
  children: React.ReactNode;
  as?: React.ElementType;
};

export default function DashedHint({
  children,
  className = '',
  as: Tag = 'span',
  ...rest
}: DashedHintProps) {
  return (
    <Tag className={`border-b border-dashed border-gray-500 transition-colors hover:border-white${className ? ' ' + className : ''}`} {...rest}>
      {children}
    </Tag>
  );
}
