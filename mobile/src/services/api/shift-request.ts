import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSocketEvent } from '@/services/socket';
import { useAuth } from '@/store/auth';

export const shiftRequestKey = ['staff', 'shift-start-request'] as const;
export function useShiftStartRequest(enabled: boolean) {
  const qc = useQueryClient();
  const userId = useAuth((state) => state.user?.id);
  const refresh = () => { if (enabled) void qc.invalidateQueries({ queryKey: shiftRequestKey }); };
  useSocketEvent('staff:shift_request_updated', refresh, [qc, enabled]);
  useSocketEvent('waiter:shift_started', refresh, [qc, enabled]);
  return useQuery({
    queryKey: [...shiftRequestKey, userId], enabled: !!userId && enabled, refetchInterval: 10_000,
    queryFn: async ({ signal }) => (await api.get<{ status: 'pending' | 'rejected' } | null>('/staff/shifts/start-request', { signal })).data || null,
  });
}
