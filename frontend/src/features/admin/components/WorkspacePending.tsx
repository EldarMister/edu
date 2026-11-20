import { useT } from '@/lib/i18n';

export function WorkspacePending() {
  const t = useT();
  return (
    <div className="workspace-pending grid gap-4 px-4 py-5" role="status" aria-busy="true">
      <span className="sr-only">{t('Загрузка')}</span>
      <div className="h-3 w-28 max-w-full rounded bg-border/50" aria-hidden="true" />
      <div className="h-3 w-3/5 max-w-xs rounded bg-border/30" aria-hidden="true" />
      <div className="h-3 w-2/5 max-w-56 rounded bg-border/30" aria-hidden="true" />
    </div>
  );
}
