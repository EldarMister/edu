import { useConnectionStatus } from '@/lib/socket';

export function ConnectionStatus() {
  const online = useConnectionStatus();
  const status = online ? 'Онлайн' : 'Нет соединения';
  return (
    <span role="status" title={status} className="inline-flex shrink-0 items-center">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${online ? 'bg-success' : 'bg-danger'}`} />
      <span className="sr-only">{status}</span>
    </span>
  );
}

/** Баннер при потере соединения (ТЗ §9). */
export function OfflineBanner({ inHeader = false }: { inHeader?: boolean } = {}) {
  const online = useConnectionStatus();
  if (online) return null;
  return (
    <div role="status" className={`bg-danger px-4 py-2 text-center text-sm font-medium text-white ${inHeader ? 'absolute inset-0 z-10 flex items-center justify-center' : 'pointer-events-none fixed inset-x-0 top-0 z-[70] shadow-soft'}`}>
      Нет соединения с сервером. Переподключаемся…
    </div>
  );
}
