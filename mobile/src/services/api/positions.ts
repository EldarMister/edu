import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { EmployeePermissions, Role } from '@/types';

export type PositionRole = Exclude<Role, 'OWNER'>;
export type PositionSalary = { hourly: number; perShift: number; monthly: number; personalPercent: number; shiftPercent: number };

export interface StaffPosition {
  id: string;
  name: string;
  role: PositionRole;
  fixedWorkspace?: 'admin' | 'terminal' | 'production' | null;
  permissions: EmployeePermissions;
  employees: number;
  salary: PositionSalary;
}

type AssignablePosition = Pick<StaffPosition, 'id' | 'name' | 'role' | 'permissions'>;
const positionsKey = ['admin', 'positions'];
const endpoint = '/admin/positions';

export function useAssignableStaffPositions(enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'staff', 'positions'],
    enabled,
    queryFn: async () => (await api.get<AssignablePosition[]>('/admin/staff/positions')).data,
  });
}

export function useStaffPositions(enabled: boolean) {
  return useQuery({
    queryKey: positionsKey,
    enabled,
    queryFn: async () => (await api.get<StaffPosition[]>(endpoint)).data,
  });
}

export function useStaffPositionMutations() {
  const queryClient = useQueryClient();
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: positionsKey }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'staff'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'finance'] }),
    ]);
  }
  const save = useMutation({
    mutationFn: ({ id, role, ...body }: Pick<StaffPosition, 'name' | 'role' | 'permissions' | 'salary'> & { id?: string }) =>
      id ? api.patch<StaffPosition>(endpoint + '/' + id, body).then((response) => response.data)
        : api.post<StaffPosition>(endpoint, { ...body, role }).then((response) => response.data),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: ({ id, replacementPositionId }: { id: string; replacementPositionId?: string }) =>
      api.delete(endpoint + '/' + id, { data: { replacementPositionId } }),
    onSuccess: refresh,
  });
  return { save, remove };
}
