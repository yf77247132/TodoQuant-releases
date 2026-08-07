
import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { safeStorageGet, safeStorageSet } from '../lib/safeStorage';

interface DraggableSplitterProps {
  storageKey: string;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  onRatioChange?: (ratio: number) => void;
  direction?: 'horizontal' | 'vertical';
  className?: string;
  children: [ReactNode, ReactNode];
  allowOverflow?: boolean;
  heightBasis?: string;
}

function clampRatio(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function DraggableSplitter({
  storageKey,
  defaultRatio = 0.7,
  minRatio = 0.3,
  maxRatio = 0.85,
  onRatioChange,
  direction = 'horizontal',
  className = '',
  allowOverflow = false,
  heightBasis,
  children,
}: DraggableSplitterProps) {
  const [ratio, setRatio] = useState(() => {
    const saved = safeStorageGet<number | null>(storageKey, null);
    return saved !== null ? clampRatio(saved, minRatio, maxRatio) : clampRatio(defaultRatio, minRatio, maxRatio);
  });

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerRect = useRef({ top: 0, left: 0, width: 0, height: 0 });
  const ratioRef = useRef(ratio);
  useEffect(() => { ratioRef.current = ratio; }, [ratio]);

  const isHorizontal = direction === 'horizontal';

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();

      const container = containerRef.current;
      if (!container) return;

      containerRect.current = container.getBoundingClientRect();

      setIsDragging(true);
    },
    [],
  );

  const handleOverlayMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRect.current;
      let newRatio: number;
      if (isHorizontal) {
        newRatio = (e.clientY - rect.top) / rect.height;
      } else {
        newRatio = (e.clientX - rect.left) / rect.width;
      }

      newRatio = clampRatio(newRatio, minRatio, maxRatio);
      setRatio(newRatio);
      onRatioChange?.(newRatio);
    },
    [isHorizontal, minRatio, maxRatio, onRatioChange],
  );

  const handleOverlayMouseUp = useCallback(() => {
    setIsDragging(false);
    safeStorageSet(storageKey, ratioRef.current);
  }, [storageKey]);

  const splitterClasses = isHorizontal
    ? 'w-full h-1 cursor-row-resize'
    : 'h-full w-1 cursor-col-resize';

  const dotOrientation = isHorizontal ? 'flex-row gap-1' : 'flex-col gap-1';

  const sizeStyle = isHorizontal
    ? (heightBasis
        ? { height: `calc(${ratio} * (${heightBasis}))` }
        : { height: `${ratio * 100}%` })
    : { width: `${ratio * 100}%` };

  return (
    <div
      ref={containerRef}
      className={`flex ${isHorizontal ? 'flex-col' : 'flex-row'} w-full h-full ${className}`}
    >
      <div style={sizeStyle} className="overflow-hidden min-h-0 min-w-0">
        {children[0]}
      </div>

      <div
        onMouseDown={handleMouseDown}
        className={`
          relative flex items-center justify-center shrink-0
          ${splitterClasses}
          bg-surface-3 hover:bg-brand-yellow/50
          transition-all duration-150
          group
        `}
      >
        <div className={`flex ${dotOrientation} items-center justify-center opacity-40 group-hover:opacity-80 transition-opacity`}>
          <span className="block w-1 h-1 rounded-full bg-text-muted" />
          <span className="block w-1 h-1 rounded-full bg-text-muted" />
          <span className="block w-1 h-1 rounded-full bg-text-muted" />
        </div>
      </div>

      <div className={`flex-1 ${allowOverflow ? 'overflow-visible' : 'overflow-hidden'} min-h-0 min-w-0`}>
        {children[1]}
      </div>

      {isDragging && (
        <div
          className="fixed inset-0 z-[9999]"
          style={{ cursor: isHorizontal ? 'row-resize' : 'col-resize' }}
          onMouseMove={handleOverlayMouseMove}
          onMouseUp={handleOverlayMouseUp}
        />
      )}
    </div>
  );
}
