import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import { useAuth } from '@/store/auth';

export interface PreparationStation {
  id: string;
  name: string;
  isActive: boolean;
  isBuiltIn: boolean;
}

const defaults: PreparationStation[] = [
  { id: 'kitchen', name: 'Кухня', isActive: true, isBuiltIn: true },
  { id: 'bar', name: 'Бар', isActive: true, isBuiltIn: true },
];

export function usePreparationStations(enabled = true) {
  const userId = useAuth((state) => state.user?.id);
  return useQuery({
    queryKey: ['prep-stations', userId],
    queryFn: async () => (await api.get<PreparationStation[]>('/prep-stations')).data,
    placeholderData: defaults,
    staleTime: 30_000,
    enabled: enabled && !!userId,
  });
}

export function usePreparationStationUpdates() {
  const qc = useQueryClient();
  useSocketEvent('settings:updated', () => {
    void qc.invalidateQueries({ queryKey: ['prep-stations'] });
  }, [qc]);
}

export function useSavePreparationStation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id?: string; name?: string; isActive?: boolean }) =>
      (await (id ? api.patch<PreparationStation>(`/prep-stations/${id}`, patch) : api.post<PreparationStation>('/prep-stations', patch))).data,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['prep-stations'] });
    },
  });
}

export function routingOptions(stations: PreparationStation[], selected?: string | null) {
  const options = stations.filter((station) => station.isActive || station.id === selected).map((station) => ({
    value: station.id,
    label: station.isActive ? station.name : `${station.name} (архив)`,
  }));
  if (selected && selected !== 'none' && !options.some((option) => option.value === selected)) {
    options.push({ value: selected, label: 'Недоступная станция' });
  }
  return [...options, { value: 'none', label: 'Без отправки' }];
}
