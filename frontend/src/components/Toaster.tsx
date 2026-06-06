import { useEffect } from 'react';
import { useNotifications } from '@/store/notifications';
import type { NotificationType } from '@/types';

const STYLES: Record<NotificationType, { bar: string; dot: string }> = {
  info: { bar: 'border-l-primary', dot: 'bg-primary' },
  success: { bar: 'border-l-success', dot: 'bg-success' },
  error: { bar: 'border-l-danger', dot: 'bg-danger' },
};

function Toast({ id, message, type = 'info' }: { id: string; message: string; type?: NotificationType }) {
  const dismiss = useNotifications((s) => s.dismiss);
  useEffect(() => {
    const t = setTimeout(() => dismiss(id), type === 'error' ? 4000 : 2800);
    return () => clearTimeout(t);
  }, [id, dismiss, type]);

  const s = STYLES[type];
  return (
    <div
      className={`card pointer-events-auto flex items-start gap-3 border-l-4 px-4 py-3 shadow-soft animate-[fadeIn_.15s_ease-out] ${s.bar}`}
      onClick={() => dismiss(id)}
      role="status"
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
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
        <Toast key={t.id} id={t.id} message={t.message} type={t.type} />
      ))}
    </div>
  );
}
