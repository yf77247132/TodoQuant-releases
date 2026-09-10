import * as React from 'react';
import i18next from 'i18next';
import Button from '../ui/Button.tsx';
import { frontendErrorReporter } from '../services/frontendErrorReporter.ts';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  componentName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    try {
      frontendErrorReporter.reportReactError(error, errorInfo);
    } catch (reportError) {
      console.error('[ErrorBoundary] Failed to report error:', reportError);
    }

    console.error('错误边界捕获到错误:', error, errorInfo);
    
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    this.setState({
      errorInfo
    });
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  handleCopy = (): void => {
    if (!this.state.error) return;
    const text = [
      this.state.error.toString(),
      '',
      'Stack:',
      this.state.errorInfo?.componentStack || '(no stack)',
    ].join('\n');
    navigator.clipboard.writeText(text).then(
      () => console.log('[ErrorBoundary] 错误信息已复制到剪贴板'),
      (e) => console.error('[ErrorBoundary] 复制失败:', e),
    );
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-surface-0 flex items-center justify-center p-4">
          <div className="bg-surface-3 rounded-2xl p-8 max-w-2xl w-full border border-border-default">
            <div className="text-center">
              <div className="text-6xl mb-4">⚠️</div>
              <h1 className="text-2xl font-bold text-[var(--color-brand-yellow)] mb-4">
                {i18next.t('nav.error.title')}
              </h1>
              <p className="text-gray-400 mb-6">
                {i18next.t('nav.error.description')}
              </p>
              
              {this.state.error && (
                <div className="text-left bg-surface-0 rounded p-4 mb-6 overflow-auto max-h-40">
                  <p className="text-trade-red font-mono text-sm">
                    {this.state.error.toString()}
                  </p>
                </div>
              )}

              <div className="flex gap-4 justify-center flex-wrap">
                <Button
                  variant="primary"
                  onClick={() => window.location.reload()}
                >
                  {i18next.t('nav.error.refresh')}
                </Button>
                <Button
                  onClick={this.handleReset}
                >
                  {i18next.t('nav.error.retry')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={this.handleCopy}
                >
                  {i18next.t('nav.error.copyError')}
                </Button>
              </div>

              {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
                <details className="mt-6 text-left">
                  <summary className="cursor-pointer text-gray-400 hover:text-text-primary mb-2">
                    {i18next.t('nav.error.details')}
                  </summary>
                  <pre className="bg-surface-0 rounded p-4 overflow-auto max-h-60 text-xs text-gray-400">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function useErrorHandler() {
  const [error, setError] = React.useState<Error | null>(null);

  const resetError = React.useCallback(() => {
    setError(null);
  }, []);

  React.useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setError(event.error || new Error(event.message));
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      setError(event.reason || new Error(String(event.reason)));
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return { error, resetError };
}

export function ErrorFallback({ 
  error, 
  resetError 
}: { 
  error: Error; 
  resetError: () => void;
}) {
  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-4">
      <div className="bg-surface-3 rounded-2xl p-6 max-w-md w-full border border-border-default">
        <div className="text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <h2 className="text-xl font-bold text-[var(--color-brand-yellow)] mb-3">
            {i18next.t('nav.error.componentTitle')}
          </h2>
          <p className="text-gray-400 text-sm mb-4">
            {error.message}
          </p>
          <Button
            variant="primary"
            onClick={resetError}
          >
            {i18next.t('nav.error.retry')}
          </Button>
        </div>
      </div>
    </div>
  );
}
