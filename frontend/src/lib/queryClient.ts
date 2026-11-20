import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

// Keep visited admin sections available while navigating, with normal stale-data refreshes.
const workspaceCache = { gcTime: 20 * 60_000 };
queryClient.setQueryDefaults(['admin'], workspaceCache);
queryClient.setQueryDefaults(['audit'], workspaceCache);
queryClient.setQueryDefaults(['settings', 'admin'], workspaceCache);
