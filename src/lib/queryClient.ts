import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      
      refetchOnWindowFocus: true,
      
      refetchOnReconnect: true,
      
      retry: 2,
      
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      
      gcTime: 5 * 60 * 1000,
    },
    mutations: {
      retry: 1,
    },
  },
});
