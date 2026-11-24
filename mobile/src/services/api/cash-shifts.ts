import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

const endpoint = '/cash-shifts';
const key = ['cash-shifts'] as const;

export type CurrentCashShift = { id: string; expectedAmount: number };
type CashShiftState = { enabled: boolean; requireClosedOrders: boolean; current: CurrentCashShift | null };
type CashOperationKind = 'income' | 'expense' | 'collection';
type CashCategory = { id: string; name: string; kind: 'income' | 'expense' | 'both' };

export function useCashAccess() {
  const user = useAuth((state) => state.user);
  const finance = user?.role === 'OWNER' || (user?.role === 'ADMIN' && user.permissions?.sections?.finance === true);
  const cashier = user?.permissions?.actions?.financeCashShifts === true;
  return { canView: finance || cashier, canManage: finance ? !user?.permissions?.readOnlySections?.includes('finance') : cashier,
    canCloseStaff: user?.role === 'OWNER' || user?.permissions?.actions?.closeShift === true };
}

export function useCashShiftState(enabled: boolean) {
  return useQuery({ queryKey: key, enabled, retry: false, refetchInterval: 15_000,
    queryFn: async () => (await api.get<CashShiftState>(endpoint)).data });
}

export function useCashCategories(enabled: boolean) {
  return useQuery({ queryKey: [...key, 'categories'], enabled,
    queryFn: async () => (await api.get<CashCategory[]>(endpoint + '/operation-categories')).data });
}

export function useChangeCashShift() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (values: { amount: number; shiftId?: string; expectedAmount?: number; closingComment?: string; closeEmployeeShifts?: boolean }) =>
      api.post(endpoint + (values.shiftId ? '/close' : '/open'), values),
    onSettled: (_, __, values) => Promise.all([
      cache.invalidateQueries({ queryKey: key }),
      values.closeEmployeeShifts ? cache.invalidateQueries({ queryKey: ['waiter', 'shift'] }) : undefined,
    ]),
  });
}

export function useCashOperation() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ shiftId, ...values }: { shiftId: string; amount: number; kind: CashOperationKind; note: string; requestKey: string; categoryId?: string }) =>
      api.post(`${endpoint}/${shiftId}/operations`, values),
    onSettled: () => cache.invalidateQueries({ queryKey: key }),
  });
}
