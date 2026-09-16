import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  color?: string;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = React.memo(({ label, value, color, className }) => (
  <div className={`bg-surface-2 border border-border-default rounded-2xl p-4 flex flex-col shadow-sm ${className || ''}`}>
    <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1">{label}</span>
    <span className={`text-xl font-bold ${color || 'text-text-primary'}`}>{value}</span>
  </div>
));

StatCard.displayName = 'StatCard';
