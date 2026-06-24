import { QueryClient } from '@tanstack/react-query';

/**
 * Единый QueryClient. Кэшируем серверные данные; меню/категории живут дольше,
 * а столы/заказы обновляются через Socket.IO + точечный invalidate.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
