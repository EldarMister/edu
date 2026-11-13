import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PrepStationEntry } from '@/types';

const stationKey = ['prep-stations'];
const defaultStations: PrepStationEntry[] = [
  { id: 'kitchen', name: 'Кухня', isActive: true, isBuiltIn: true },
  { id: 'bar', name: 'Бар', isActive: true, isBuiltIn: true },
];

export function usePrepStations(enabled = true) {
  const query = useQuery({
    queryKey: stationKey,
    queryFn: async () => (await api.get<PrepStationEntry[]>('/prep-stations')).data,
    staleTime: 60_000,
    enabled,
  });
  return { ...query, stations: query.data ?? defaultStations };
}

export function usePrepStationMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: stationKey });
  const create = useMutation({
    mutationFn: async (name: string) =>
      (await api.post<PrepStationEntry>('/prep-stations', { name })).data,
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; name?: string; isActive?: boolean }) =>
      (await api.patch<PrepStationEntry>(`/prep-stations/${encodeURIComponent(id)}`, patch)).data,
    onSuccess: refresh,
  });
  return { create, update };
}

export function prepStationOptions(stations: PrepStationEntry[], selected?: string) {
  return [
    ...stations
      .filter((station) => station.isActive || station.id === selected)
      .map((station) => ({ value: station.id, label: station.name, translate: station.isBuiltIn })),
    { value: 'none', label: 'Без отправки' },
  ];
}
