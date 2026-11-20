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

// Keep loaded workspaces through the current app session. Auth clears the cache at session changes.
const workspaceCache = { gcTime: Infinity };
queryClient.setQueryDefaults(['admin'], workspaceCache);
queryClient.setQueryDefaults(['audit'], workspaceCache);
queryClient.setQueryDefaults(['settings', 'admin'], workspaceCache);
queryClient.setQueryDefaults(['cash-shifts'], workspaceCache);
queryClient.setQueryDefaults(['prep-stations'], workspaceCache);
