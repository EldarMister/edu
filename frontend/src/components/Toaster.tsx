import { useEffect } from 'react';
import { useNotifications } from '@/store/notifications';

function Toast({ id, message }: { id: string; message: string }) {
  const dismiss = useNotifications((s) => s.dismiss);
  useEffect(() => {
    const t = setTimeout(() => dismiss(id), 2500);
    return () => clearTimeout(t);
  }, [id, dismiss]);

  return (
    <div
      className="card pointer-events-auto flex items-start gap-3 px-4 py-3 shadow-soft animate-[fadeIn_.15s_ease-out]"
      onClick={() => dismiss(id)}
      role="status"
    >
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
      <p className="text-sm text-text-primary">{message}</p>
    </div>
  );
}

/** Стек тостов поверх интерфейса. */
export function Toaster() {
  const toasts = useNotifications((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed right-0 top-3 z-50 flex w-full max-w-sm flex-col gap-2 px-3 sm:right-3">
      {toasts.map((t) => (
        <Toast key={t.id} id={t.id} message={t.message} />
      ))}
    </div>
  );
}
