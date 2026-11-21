import { useT } from '@/lib/i18n';

const rowWidths = ['w-4/5', 'w-3/5', 'w-2/3', 'w-5/6', 'w-1/2'];
const chartHeights = ['h-1/3', 'h-1/2', 'h-2/5', 'h-2/3', 'h-1/2', 'h-3/4', 'h-2/3'];

export function WorkspacePending({ layout = 'table' }: { layout?: 'table' | 'overview' }) {
  const t = useT();
  return (
    <div className="workspace-pending" role="status" aria-busy="true">
      <span className="sr-only">{t('Загрузка')}</span>
      {layout === 'overview' ? (
        <div className="grid gap-4" aria-hidden="true">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {[0, 1].map((card) => <div key={card} className="card grid gap-3 p-4 sm:p-5">
              <div className="workspace-skeleton h-3 w-3/4 max-w-40" />
              <div className="workspace-skeleton h-7 w-1/2 max-w-28" />
            </div>)}
          </div>
          <div className="card space-y-5 p-4 sm:p-5">
            <div className="workspace-skeleton h-4 w-2/5 max-w-48" />
            <div className="flex h-40 items-end justify-between gap-3 border-b border-border px-2 sm:h-52 sm:gap-6">
              {chartHeights.map((height, index) => <div key={index} className={`workspace-skeleton w-full max-w-20 ${height}`} />)}
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card" aria-hidden="true">
          <div className="grid grid-cols-[2fr_1fr_1fr] items-center gap-4 border-b border-border/70 bg-background/60 px-4 py-4 sm:grid-cols-[2fr_1fr_1fr_1fr] sm:gap-6 sm:px-5">
            <div className="workspace-skeleton h-3 w-3/4 max-w-40" />
            <div className="workspace-skeleton h-3 w-3/4 max-w-24" />
            <div className="workspace-skeleton h-3 w-1/2 max-w-24" />
            <div className="workspace-skeleton hidden h-3 w-2/3 max-w-24 sm:block" />
          </div>
          <div className="divide-y divide-border/50">
            {rowWidths.map((width) => <div key={width} className="grid min-h-12 grid-cols-[2fr_1fr_1fr] items-center gap-4 px-4 sm:grid-cols-[2fr_1fr_1fr_1fr] sm:gap-6 sm:px-5">
              <div className={`workspace-skeleton h-3.5 max-w-52 ${width}`} />
              <div className="workspace-skeleton h-3 w-3/4 max-w-28" />
              <div className="workspace-skeleton h-3 w-1/2 max-w-24" />
              <div className={`workspace-skeleton hidden h-3 max-w-20 sm:block ${width}`} />
            </div>)}
          </div>
        </div>
      )}
    </div>
  );
}
