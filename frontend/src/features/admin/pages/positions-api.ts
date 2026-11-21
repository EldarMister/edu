import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { EmployeePermissions, Role } from '@/types';

export type PositionRole = Extract<Role, 'ADMIN' | 'WAITER' | 'KITCHEN' | 'BAR'>;
export const POSITION_ROLES: { value: PositionRole; label: string }[] = [
  { value: 'ADMIN', label: 'Панель управления' },
  { value: 'WAITER', label: 'Касса и обслуживание' },
  { value: 'KITCHEN', label: 'Экран кухни' },
  { value: 'BAR', label: 'Экран бара' },
];

export type AssignablePosition = Pick<StaffPosition, 'id' | 'name' | 'role' | 'permissions'>;
export function useAssignableStaffPositions(enabled: boolean) {
  return useQuery({ queryKey: ['admin', 'staff', 'positions'], enabled,
    queryFn: async () => (await api.get<AssignablePosition[]>('/admin/staff/positions')).data });
}

export interface StaffPosition {
  id: string;
  name: string;
  role: PositionRole;
  fixedWorkspace?: 'admin' | 'terminal' | 'production' | null;
  permissions: EmployeePermissions;
  employees: number;
  salary?: PositionSalary;
  salaryEffectiveMonth?: string | null;
}

export type PositionSalary = { hourly: number; perShift: number; monthly: number; personalPercent: number; shiftPercent: number };

const key = ['admin', 'positions'];
const endpoint = '/admin/positions';

export function useStaffPositions(enabled: boolean) {
  return useQuery({ queryKey: key, enabled, queryFn: async () => (await api.get<StaffPosition[]>(endpoint)).data });
}

export function useStaffPositionMutations() {
  const qc = useQueryClient();
  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ['admin', 'staff'] }),
      qc.invalidateQueries({ queryKey: ['admin', 'finance'] }),
    ]);
  }
  const save = useMutation({
    mutationFn: ({ id, name, role, permissions, salary }: Pick<StaffPosition, 'name' | 'role' | 'permissions' | 'salary'> & { id?: string }) =>
      id ? api.patch(endpoint + '/' + id, { name, permissions, salary }) : api.post(endpoint, { name, role, permissions, salary }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: ({ id, replacementPositionId }: { id: string; replacementPositionId?: string | null }) =>
      api.delete(endpoint + '/' + id, { data: { replacementPositionId } }),
    onSuccess: refresh,
  });
  return { save, remove };
}
