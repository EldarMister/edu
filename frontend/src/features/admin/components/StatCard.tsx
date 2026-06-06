import type { ReactNode } from 'react';

/** Карточка-метрика в верхней части каждого раздела (как в референсах). */
export function StatCard({
  label,
  value,
  icon,
  tone = 'primary',
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'muted';
}) {
  const tones: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-danger/10 text-danger',
    muted: 'bg-slate-100 text-text-muted',
  };
  return (
    <div className="card flex items-center gap-3 p-3.5 sm:gap-3.5 sm:p-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11 ${tones[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="break-words text-[13px] leading-snug text-text-muted sm:text-sm">{label}</p>
        <p className="mt-0.5 text-xl font-semibold leading-tight text-text-primary">{value}</p>
      </div>
    </div>
  );
}

export function StatCardsRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}
