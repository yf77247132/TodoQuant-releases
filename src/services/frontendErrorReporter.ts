
interface FrontendError {
  type: 'runtime' | 'unhandled' | 'resource' | 'network' | 'performance';
  level: 'critical' | 'high' | 'medium' | 'low' | 'info';
  errorClass?: 'USER' | 'SYSTEM' | 'API';
  message: string;
  stack?: string;
  componentStack?: string;
  url: string;
  userAgent: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

interface PerformanceMetrics {
  fcp?: number;
  lcp?: number;
  fid?: number;
  cls?: number;
  loadTime: number;
  domReady: number;
  fps?: number;
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

class FrontendErrorReporter {
  private static instance: FrontendErrorReporter;
  private errorQueue: FrontendError[] = [];
  private isReporting = false;
  private reportedErrors = new Set<string>();
  private performanceObserver: PerformanceObserver | null = null;
  private frameCount = 0;
  private lastFrameTime = performance.now();
  private fps = 0;
  private fpsRafId: number | null = null;
  private readonly onWindowError = this.handleError.bind(this);
  private readonly onUnhandledRejection = this.handleUnhandledRejection.bind(this);
  private readonly onWindowLoad = this.handleLoad.bind(this);
  private readonly onResourceError = this.handleResourceError.bind(this);

  private constructor() {
    this.init();
  }

  static getInstance(): FrontendErrorReporter {
    if (!FrontendErrorReporter.instance) {
      FrontendErrorReporter.instance = new FrontendErrorReporter();
    }
    return FrontendErrorReporter.instance;
  }

  private init(): void {
    window.addEventListener('error', this.onWindowError);
    window.addEventListener('unhandledrejection', this.onUnhandledRejection);
    window.addEventListener('load', this.onWindowLoad);

    window.addEventListener('error', this.onResourceError, true);

    this.initPerformanceMonitoring();

    this.startFPSMonitoring();
  }

  destroy(): void {
    window.removeEventListener('error', this.onWindowError);
    window.removeEventListener('unhandledrejection', this.onUnhandledRejection);
    window.removeEventListener('load', this.onWindowLoad);
    window.removeEventListener('error', this.onResourceError, true);

    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
      this.performanceObserver = null;
    }

    if (this.fpsRafId !== null) {
      cancelAnimationFrame(this.fpsRafId);
      this.fpsRafId = null;
    }
  }

  private handleError(event: ErrorEvent): void {
    const error: FrontendError = {
      type: 'runtime',
      level: 'high',
      errorClass: 'SYSTEM',
      message: event.message,
      stack: event.error?.stack,
      url: event.filename || window.location.href,
      userAgent: navigator.userAgent,
      timestamp: Date.now(),
      details: {
        lineno: event.lineno,
        colno: event.colno
      }
    };

    this.reportError(error);
  }

  private handleUnhandledRejection(event: PromiseRejectionEvent): void {
    const error: FrontendError = {
      type: 'unhandled',
      level: 'high',
      errorClass: 'SYSTEM',
      message: String(event.reason),
      stack: event.reason instanceof Error ? event.reason.stack : undefined,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: Date.now()
    };

    this.reportError(error);
  }

  private handleResourceError(event: Event): void {
    const target = event.target as HTMLElement;
    if (target.tagName) {
      const src = (target as HTMLImageElement).src || (target as HTMLScriptElement).src || (target as HTMLLinkElement).href || '';

      if (src.includes('crypto-icons')) return;

      const error: FrontendError = {
        type: 'resource',
        level: 'medium',
        errorClass: 'SYSTEM',
        message: `资源加载失败(${target.tagName}): ${src || '未知资源'}`,
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: Date.now(),
        details: {
          src,
          tagName: target.tagName
        }
      };

      this.reportError(error);
    }
  }

  private handleLoad(): void {
    setTimeout(() => {
      this.collectPerformanceMetrics();
    }, 0);
  }

  private initPerformanceMonitoring(): void {
    try {
      if ('PerformanceObserver' in window) {
        this.performanceObserver = new PerformanceObserver((list) => {
          void list.getEntries();
        });
        this.performanceObserver.observe({ entryTypes: ['largest-contentful-paint'] });
      }
    } catch (error) {
      console.warn('[FrontendErrorReporter] PerformanceObserver init failed:', error);
    }
  }

  private collectPerformanceMetrics(): void {
    const timing = performance.timing;
    const metrics: PerformanceMetrics = {
      loadTime: timing.loadEventEnd - timing.navigationStart,
      domReady: timing.domContentLoadedEventEnd - timing.navigationStart
    };

    if ('PerformancePaintTiming' in window) {
      const paintEntries = performance.getEntriesByType('paint');
      const fcp = paintEntries.find(entry => entry.name === 'first-contentful-paint');
      if (fcp) {
        metrics.fcp = fcp.startTime;
      }
    }

    if ('memory' in performance) {
      const mem = (performance as any).memory;
      metrics.memory = {
        usedJSHeapSize: mem.usedJSHeapSize,
        totalJSHeapSize: mem.totalJSHeapSize,
        jsHeapSizeLimit: mem.jsHeapSizeLimit
      };
    }

    metrics.fps = this.fps;

    this.reportPerformance(metrics);
  }

  private startFPSMonitoring(): void {
    const measureFPS = () => {
      this.frameCount++;
      const now = performance.now();
      const delta = now - this.lastFrameTime;

      if (delta >= 1000) {
        this.fps = Math.round((this.frameCount * 1000) / delta);
        this.frameCount = 0;
        this.lastFrameTime = now;

        if (this.fps > 0 && this.fps < 10) {
          this.reportPerformance({
            loadTime: 0,
            domReady: 0,
            fps: this.fps
          });
        }
      }

      this.fpsRafId = requestAnimationFrame(measureFPS);
    };

    this.fpsRafId = requestAnimationFrame(measureFPS);
  }

  reportReactError(error: Error, errorInfo: { componentStack?: string }): void {
    const frontendError: FrontendError = {
      type: 'runtime',
      level: 'critical',
      errorClass: 'SYSTEM',
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: Date.now()
    };

    this.reportError(frontendError);
  }

  reportNetworkError(url: string, error: Error): void {
    const frontendError: FrontendError = {
      type: 'network',
      level: 'high',
      errorClass: 'API',
      message: `网络请求失败: ${url}`,
      stack: error.stack,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: Date.now(),
      details: { requestUrl: url }
    };

    this.reportError(frontendError);
  }

  private reportError(error: FrontendError): void {
    if (!error.errorClass) {
      error.errorClass = error.type === 'network' ? 'API' : 'SYSTEM';
    }

    if (
      !error.message ||
      error.message === "Script error." || 
      error.message.includes("tradingview") || 
      (error.url && error.url.includes("tradingview")) ||
      (error.stack && error.stack.includes("tradingview")) ||
      (error.details && JSON.stringify(error.details).includes("tradingview"))
    ) {
      return;
    }

    const errorKey = `${error.type}:${error.message}:${error.url}`;
    
    if (this.reportedErrors.has(errorKey)) {
      return;
    }
    this.reportedErrors.add(errorKey);

    this.errorQueue.push(error);

    this.flushErrorQueue();
  }

  private reportPerformance(metrics: PerformanceMetrics): void {
    fetch('/api/errors/performance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metrics)
    }).catch(err => {
      console.warn('[FrontendErrorReporter] Failed to report performance:', err);
    });
  }

  private async flushErrorQueue(): Promise<void> {
    if (this.isReporting || this.errorQueue.length === 0) {
      return;
    }

    this.isReporting = true;
    const errors = [...this.errorQueue];

    try {
      this.errorQueue = [];

      const response = await fetch('/api/errors/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ errors })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setTimeout(() => {
        errors.forEach(error => {
          const errorKey = `${error.type}:${error.message}:${error.url}`;
          this.reportedErrors.delete(errorKey);
        });
      }, 5 * 60 * 1000);

    } catch (error) {
      console.warn('[前端错误监控] 上报错误失败:', error);
      this.errorQueue.unshift(...errors);
    } finally {
      this.isReporting = false;
    }
  }

  getFPS(): number {
    return this.fps;
  }

  reportManualError(message: string, level: 'critical' | 'high' | 'medium' | 'low' | 'info', details?: Record<string, unknown>): void {
    const error: FrontendError = {
      type: 'runtime',
      level,
      errorClass: 'SYSTEM',
      message,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: Date.now(),
      details
    };

    this.reportError(error);
  }
}

export const frontendErrorReporter = FrontendErrorReporter.getInstance();
export default frontendErrorReporter;
