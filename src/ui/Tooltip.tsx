import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: string | React.ReactNode;
  children: React.ReactNode;
  className?: string;
  showDelay?: number;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, className = 'relative inline', showDelay = 150 }) => {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const triggerRectRef = useRef<DOMRect | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (!triggerRef.current) return;
    showTimerRef.current = setTimeout(() => {
      const el = triggerRef.current;
      if (!el) return;
      if (!el.matches(':hover')) return;
      const rect = el.getBoundingClientRect();
      triggerRectRef.current = rect;
      setPosition({ top: rect.top, left: rect.right + 8 });
    }, showDelay);
  }, [showDelay]);

  const handleMouseLeave = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    setPosition(null);
  }, []);

  useEffect(() => {
    return () => {
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
      }
    };
  }, []);

  const isOpen = position !== null;
  useEffect(() => {
    if (!isOpen) return;
    const hideIfOutside = (e: MouseEvent) => {
      const el = triggerRef.current;
      const target = e.target as Node | null;
      if (!el || !target || !el.contains(target)) setPosition(null);
    };
    const hide = () => setPosition(null);
    document.addEventListener('mousemove', hideIfOutside, true);
    document.addEventListener('mousedown', hide, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('mousemove', hideIfOutside, true);
      document.removeEventListener('mousedown', hide, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, [isOpen]);

  return (
    <>
      <div
        ref={triggerRef}
        className={className}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
      {position &&
        createPortal(
          <div
            className="fixed px-3 py-2 bg-surface-4 border border-border-default text-text-primary text-3xs rounded shadow-lg whitespace-pre-wrap break-words max-w-[320px] leading-relaxed"
            style={{ top: position.top, left: position.left, zIndex: 'var(--z-tooltip)' }}
            ref={(el) => {
              if (!el) return;
              const triggerRect = triggerRectRef.current;
              if (!triggerRect) return;

              const gap = 8;
              const viewportWidth = document.documentElement.clientWidth;
              const viewportHeight = window.innerHeight;
              const tooltipWidth = el.offsetWidth;
              const tooltipHeight = el.offsetHeight;

              let nextLeft = triggerRect.right + gap;
              let nextTop = triggerRect.top;

              if (nextLeft + tooltipWidth > viewportWidth - gap) {
                nextLeft = triggerRect.left - tooltipWidth - gap;
              }

              if (nextLeft < gap) nextLeft = gap;
              if (nextLeft + tooltipWidth > viewportWidth - gap) {
                nextLeft = Math.max(gap, viewportWidth - tooltipWidth - gap);
              }

              if (nextTop + tooltipHeight > viewportHeight - gap) {
                nextTop = Math.max(gap, viewportHeight - tooltipHeight - gap);
              }

              if (nextLeft !== position.left || nextTop !== position.top) {
                setPosition({ top: nextTop, left: nextLeft });
              }
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
};
