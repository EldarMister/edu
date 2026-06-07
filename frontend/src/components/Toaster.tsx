import { useEffect } from 'react';
import { useNotifications } from '@/store/notifications';
import type { NotificationType } from '@/types';

function Toast({ id, message, type = 'info' }: { id: string; message: string; type?: NotificationType }) {
  const dismiss = useNotifications((s) => s.dismiss);
  useEffect(() => {
    const t = setTimeout(() => dismiss(id), type === 'error' ? 4000 : 2800);
    return () => clearTimeout(t);
  }, [id, dismiss, type]);

  return (
    <div
      className="pointer-events-auto w-fit max-w-[calc(100vw-24px)] rounded-xl border border-border bg-white px-4 py-2.5 shadow-soft animate-[fadeIn_.15s_ease-out] sm:max-w-sm"
      onClick={() => dismiss(id)}
      role="status"
    >
      <p className="min-w-0 truncate whitespace-nowrap text-sm text-text-primary">{message}</p>
    </div>
  );
}

/** Стек тостов поверх интерфейса. */
export function Toaster() {
  const toasts = useNotifications((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-50 flex max-w-[calc(100vw-24px)] flex-col items-end gap-2 sm:max-w-sm">
      {toasts.map((t) => (
        <Toast key={t.id} id={t.id} message={t.message} type={t.type} />
      ))}
    </div>
  );
}
