import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import { useAuth } from '@/store/auth';

export type ShiftRequestStatus = 'pending' | 'rejected';
export const shiftRequestKey = ['staff', 'shift-start-request'] as const;

export function useShiftStartRequest(enabled: boolean) {
  const qc = useQueryClient();
  const id = useAuth((state) => state.user?.id);
  const refresh = () => { if (enabled) void qc.invalidateQueries({ queryKey: shiftRequestKey }); };
  useSocketEvent('staff:shift_request_updated', refresh);
  useSocketEvent('waiter:shift_started', refresh);
  return useQuery({
    queryKey: [...shiftRequestKey, id], enabled: !!id && enabled, refetchInterval: 10_000,
    queryFn: async ({ signal }) => (await api.get<{ status: ShiftRequestStatus } | null>('/staff/shifts/start-request', { signal })).data || null,
  });
}
