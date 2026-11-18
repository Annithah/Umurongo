import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/ui';
import { I18nProvider } from './lib/i18n';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    // Socket events trigger refetches. The 60 s poll is only a safety net if an event is missed.
    queries: { retry: 1, refetchOnWindowFocus: true, refetchInterval: 60_000, staleTime: 2_000 },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <BrowserRouter>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </BrowserRouter>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
