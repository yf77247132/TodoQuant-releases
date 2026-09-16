import { useEffect, useRef } from 'react';

export const usePerformanceMonitoring = (intervalMs: number = 2000): null => {
  const lastFrameTime = useRef<number>(0);
  const frameCount = useRef<number>(0);
  const fps = useRef<number>(60);

  useEffect(() => {
    lastFrameTime.current = performance.now();
    let animationId: number;

    const calculateFPS = (currentTime: number) => {
      frameCount.current++;
      const delta = currentTime - lastFrameTime.current;

      if (delta >= 1000) {
        if (document.hidden || delta > 2000) {
          fps.current = 60;
        } else {
          fps.current = Math.round((frameCount.current * 1000) / delta);
        }
        frameCount.current = 0;
        lastFrameTime.current = currentTime;
      }

      animationId = requestAnimationFrame(calculateFPS);
    };

    animationId = requestAnimationFrame(calculateFPS);

    const reportMetrics = async () => {
      if (fps.current >= 40) return;

      try {
        let memory = 0;
        let memoryLimit = 0;

        if ('memory' in performance) {
          const mem = (performance as any).memory;
          memory = mem.usedJSHeapSize;
          memoryLimit = mem.jsHeapSizeLimit;
        }

        await fetch('/api/errors/performance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fps: fps.current,
            memory,
            memoryLimit,
          }),
        });
      } catch (error) {
        console.warn('[usePerformanceMonitoring] Failed to report metrics:', error);
      }
    };

    const intervalId = setInterval(reportMetrics, Math.max(intervalMs, 5000));

    return () => {
      cancelAnimationFrame(animationId);
      clearInterval(intervalId);
    };
  }, [intervalMs]);

  return null;
};
