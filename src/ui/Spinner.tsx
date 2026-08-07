import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | number;
  label?: React.ReactNode;
  progress?: number;
  className?: string;
}

const sizeMap: Record<string, number> = {
  xs: 12,
  sm: 16,
  md: 24,
  lg: 32,
};

function getAutoProgress(label: React.ReactNode): number {
  const text = String(label ?? '');
  if (text.includes('环境') || text.includes('detecting')) return 15;
  if (text.includes('下载') || text.includes('downloading')) return 50;
  if (text.includes('运行') || text.includes('running')) return 80;
  return 30;
}

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  label,
  progress,
  className = '',
}) => {
  const px = typeof size === 'number' ? size : sizeMap[size] ?? 24;
  const icon = <Loader2 size={px} className={`animate-spin text-brand-yellow ${className}`} />;

  const [animated, setAnimated] = useState(progress ?? getAutoProgress(label));
  useEffect(() => {
    if (progress != null) {
      setAnimated(progress);
      return;
    }
    const target = getAutoProgress(label);
    setAnimated((prev) => (target > prev ? target : prev));
    const id = setInterval(() => {
      setAnimated((prev) => {
        if (prev >= target + 12) return prev;
        return Math.min(target + 12, prev + 0.5);
      });
    }, 250);
    return () => clearInterval(id);
  }, [progress, label]);

  if (label != null) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-64 gap-4">
        {icon}
        <p className="text-text-tertiary text-sm">{label}</p>
        <div className="w-60 h-1 bg-surface-3 rounded overflow-hidden">
          <div
            className="h-full bg-brand-yellow rounded transition-all duration-300 ease-out"
            style={{ width: `${Math.round(animated)}%` }}
          />
        </div>
        <p className="text-2xs text-text-muted font-mono">{Math.round(animated)}%</p>
      </div>
    );
  }

  return icon;
};
