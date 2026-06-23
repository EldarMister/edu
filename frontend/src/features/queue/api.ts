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

/** Публичное табло очереди — без авторизации, опрос раз в 5 секунд.
 *  code — короткий код табло (/q/CODE), cafe — id кафе (совместимость). */
export function useQueueBoard({ code, cafe }: { code?: string | null; cafe?: string | null }) {
  return useQuery({
    queryKey: ['queue', 'board', code ?? null, cafe ?? null],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (code) params.code = code;
      else if (cafe) params.cafe = cafe;
      return (await api.get<QueueBoard>('/queue', { params })).data;
    },
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
  });
}
