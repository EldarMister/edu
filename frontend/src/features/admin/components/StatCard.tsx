import type { ReactNode } from 'react';

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
  const iconColor: Record<string, string> = {
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    muted: 'text-text-muted',
  };

  return (
    <div className="group rounded-lg border border-border bg-white p-3 transition-shadow duration-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-widest text-text-muted">{label}</p>
        <span className={`[&>svg]:h-3.5 [&>svg]:w-3.5 shrink-0 ${iconColor[tone]} opacity-60`}>
          {icon}
        </span>
      </div>
      <p className="mt-2 text-[22px] font-semibold leading-none tracking-tight text-text-primary">
        {value}
      </p>
    </div>
  );
}

export function StatCardsRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{children}</div>;
}
