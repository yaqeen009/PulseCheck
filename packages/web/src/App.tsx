import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setUnauthorizedHandler } from '@/lib/api-client';
import { AppRoutes } from '@/router';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // One retry absorbs a transient blip; a consistently failing API should
        // not be hammered.
        retry: 1,
        staleTime: 5_000,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

/**
 * Bridges the API client's 401 signal into React state: cached data is dropped
 * and the browser is sent to the login screen.
 */
function UnauthorizedBridge() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  React.useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.clear();
      navigate('/login', { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate, queryClient]);

  return null;
}

export function App() {
  const [queryClient] = React.useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <BrowserRouter>
          <UnauthorizedBridge />
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
