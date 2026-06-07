import { useEffect, useState } from 'react';
import { useNotifications } from '@/store/notifications';
import type { AppNotification, NotificationType } from '@/types';

const TOAST_EXIT_MS = 260;

type RenderedToast = AppNotification & { exiting?: boolean };

function Toast({
  id,
  message,
  type = 'info',
  exiting = false,
}: {
  id: string;
  message: string;
  type?: NotificationType;
  exiting?: boolean;
}) {
  const dismiss = useNotifications((s) => s.dismiss);
  useEffect(() => {
    if (exiting) return;
    const t = setTimeout(() => dismiss(id), type === 'error' ? 4000 : 2800);
    return () => clearTimeout(t);
  }, [id, dismiss, exiting, type]);

  return (
    <div
      className={`toast-shell ${exiting ? 'toast-shell-exit' : ''}`}
      aria-hidden={exiting}
    >
      <div
        className="pointer-events-auto w-fit max-w-[calc(100vw-24px)] rounded-xl border border-border bg-white px-4 py-2.5 shadow-soft sm:max-w-sm"
        onClick={() => dismiss(id)}
        role="status"
      >
        <p className="min-w-0 truncate whitespace-nowrap text-sm text-text-primary">{message}</p>
      </div>
    </div>
  );
}

/** Стек тостов поверх интерфейса. */
export function Toaster() {
  const toasts = useNotifications((s) => s.toasts);
  const [rendered, setRendered] = useState<RenderedToast[]>([]);

  useEffect(() => {
    setRendered((prev) => {
      const nextById = new Map(toasts.map((t) => [t.id, t]));
      const prevIds = new Set(prev.map((t) => t.id));
      const next: RenderedToast[] = [];

      for (const item of prev) {
        const active = nextById.get(item.id);
        if (active) next.push({ ...active, exiting: false });
        else next.push({ ...item, exiting: true });
      }

      for (const item of toasts) {
        if (!prevIds.has(item.id)) next.push({ ...item, exiting: false });
      }

      return next;
    });
  }, [toasts]);

  useEffect(() => {
    if (!rendered.some((t) => t.exiting)) return;
    const timer = setTimeout(() => {
      setRendered((items) => items.filter((t) => !t.exiting));
    }, TOAST_EXIT_MS);
    return () => clearTimeout(timer);
  }, [rendered]);

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-50 flex max-w-[calc(100vw-24px)] flex-col items-end sm:max-w-sm">
      {rendered.map((t) => (
        <Toast key={t.id} id={t.id} message={t.message} type={t.type} exiting={t.exiting} />
      ))}
    </div>
  );
}
