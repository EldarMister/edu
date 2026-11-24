import type { MouseEventHandler } from 'react';
import { IconEdit, IconEye } from './icons';

export function RowIconButton({ icon, label, expanded, onClick }: {
  icon: 'edit' | 'details';
  label: string;
  expanded?: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
}) {
  const Icon = icon === 'edit' ? IconEdit : IconEye;
  return (
    <button type="button" aria-label={label} title={label} aria-expanded={expanded} onClick={onClick}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary aria-expanded:bg-primary/10">
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
