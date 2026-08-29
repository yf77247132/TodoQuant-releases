import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { queryClient } from './lib/queryClient.ts';
import './index.css';

type ConsolePatchMeta = typeof globalThis & {
  __todoquantConsolePatched?: boolean;
  __todoquantOriginalConsoleError?: typeof console.error;
};

const patchMeta = globalThis as ConsolePatchMeta;
if (!patchMeta.__todoquantConsolePatched) {
  patchMeta.__todoquantOriginalConsoleError = console.error;
  patchMeta.__todoquantConsolePatched = true;

  console.error = (...args) => {
    const msg = args[0];
    const msgStr = typeof msg === 'string' ? msg : msg instanceof Error ? msg.message : String(msg);
    const arg1Str = args[1]
      ? typeof args[1] === 'string'
        ? args[1]
        : args[1] instanceof Error
          ? args[1].message
          : String(args[1])
      : '';

    if (
      msgStr === 'Script error.' ||
      msgStr.includes('tradingview') ||
      arg1Str.includes('tradingview') ||
      arg1Str.includes('Script error.')
    ) {
      return;
    }

    patchMeta.__todoquantOriginalConsoleError?.apply(console, args);
  };
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element "#root" not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
