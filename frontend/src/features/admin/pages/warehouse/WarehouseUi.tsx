import type { ReactNode } from 'react';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';

export function QueryState({
  pending,
  error,
  empty,
  children,
}: {
  pending?: boolean;
  error?: unknown;
  empty?: boolean;
  children?: ReactNode;
}) {
  if (pending)
    return (
      <div className="flex justify-center p-10">
        <Spinner />
      </div>
    );
  if (error)
    return (
      <p role="alert" className="p-4 text-sm text-danger">
        {apiError(error)}
      </p>
    );
  if (empty)
    return (
      <div className="px-4 py-12 text-center">
        <p className="font-medium text-text-primary">Ничего не найдено</p>
        <p className="mt-1 text-sm text-text-muted">
          Измените поиск или фильтры, либо добавьте первую запись.
        </p>
      </div>
    );
  return <>{children}</>;
}

export function DocumentFooter({ children, total }: { children: ReactNode; total?: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.025)]">
      <div className="flex flex-wrap gap-2">{children}</div>
      {total != null && <div className="text-sm font-medium text-text-primary">{total}</div>}
    </div>
  );
}

export function DocumentField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid items-start gap-1.5 text-sm sm:grid-cols-[190px_minmax(0,1fr)] sm:gap-5">
      <span className="pt-2.5 text-text-secondary">{label}</span>
      <span className="block min-w-0 sm:max-w-xl">{children}</span>
    </label>
  );
}
