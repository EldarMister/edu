import { useConnectionStatus } from '@/lib/socket';

/** Индикатор соединения. compact — только точка (для шапки кухни). */
export function ConnectionStatus({ compact = false }: { compact?: boolean }) {
  const online = useConnectionStatus();
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className={`h-2 w-2 rounded-full ${online ? 'bg-success' : 'bg-danger'}`} />
      {!compact && (
        <span className={online ? 'text-text-secondary' : 'text-danger'}>
          {online ? 'Онлайн' : 'Нет соединения'}
        </span>
      )}
    </span>
  );
}

/** Баннер при потере соединения (ТЗ §9). */
export function OfflineBanner() {
  const online = useConnectionStatus();
  if (online) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] bg-danger px-4 py-2 text-center text-sm font-medium text-white shadow-soft">
      Нет соединения с сервером. Переподключаемся…
    </div>
  );
}
