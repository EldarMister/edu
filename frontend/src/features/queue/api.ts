import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type QueueStatus =
  | 'sent_to_kitchen'
  | 'accepted_by_kitchen'
  | 'cooking'
  | 'partially_rejected'
  | 'ready';

export interface QueueOrder {
  id: string;
  orderNumber: string;
  tableNumber: number;
  status: QueueStatus;
  createdAt: string;
  updatedAt: string;
}

export interface QueueBoard {
  enabled: boolean;
  mode: 'table' | 'number';
  cafeName: string;
  preparing: QueueOrder[];
  ready: QueueOrder[];
}

/** Публичное табло очереди — без авторизации, опрос раз в 5 секунд. */
export function useQueueBoard() {
  return useQuery({
    queryKey: ['queue', 'board'],
    queryFn: async () => (await api.get<QueueBoard>('/queue')).data,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
  });
}
