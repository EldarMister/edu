import { useState } from 'react';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { money } from '@/lib/format';
import { StatCard, StatCardsRow } from '../../components/StatCard';
import { IconPlus, IconTrash, IconReconcile } from '../../components/icons';
import {
  useMovements,
  useMovementsSummary,
  qty,
  type MovementsFilter,
  type StockMovement,
  type StockMovementType,
} from './api';

const TYPE_BADGE: Record<StockMovementType, { label: string; tone: 'success' | 'danger' | 'primary' | 'muted' }> = {
  purchase: { label: 'Приход', tone: 'success' },
  sale: { label: 'Списание', tone: 'danger' },
  return: { label: 'Возврат', tone: 'primary' },
  correction: { label: 'Коррекция', tone: 'muted' },
  cancel: { label: 'Отмена', tone: 'muted' },
};

const SOURCE_LABEL: Record<string, string> = {
  purchase: 'Закупка',
  order: 'Заказ',
  manual: 'Вручную',
};

const emptyFilter: MovementsFilter = {
  from: '',
  to: '',
  type: '',
  sourceType: '',
  search: '',
};

export function MovementsTab() {
  const [filter, setFilter] = useState<MovementsFilter>(emptyFilter);

  const movementsQ = useMovements(filter);
  const summaryQ = useMovementsSummary(filter);
  const s = summaryQ.data;

  function patch(p: Partial<MovementsFilter>) {
    setFilter((cur) => ({ ...cur, ...p }));
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <input
          className="input h-9 w-[150px]"
          type="date"
          value={filter.from}
          onChange={(e) => patch({ from: e.target.value })}
        />
        <input
          className="input h-9 w-[150px]"
          type="date"
          value={filter.to}
          onChange={(e) => patch({ to: e.target.value })}
        />
        <input
          className="input h-9 flex-1 sm:max-w-[200px]"
          placeholder="Поиск по ингредиенту"
          value={filter.search}
          onChange={(e) => patch({ search: e.target.value })}
        />
        <Select
          className="h-9 w-[150px]"
          value={filter.type ?? ''}
          onChange={(v) => patch({ type: v })}
          options={[
            { value: '', label: 'Все типы' },
            { value: 'purchase', label: 'Приход' },
            { value: 'sale', label: 'Списание' },
            { value: 'return', label: 'Возврат' },
            { value: 'correction', label: 'Коррекция' },
          ]}
        />
        <Select
          className="h-9 w-[160px]"
          value={filter.sourceType ?? ''}
          onChange={(v) => patch({ sourceType: v })}
          options={[
            { value: '', label: 'Все источники' },
            { value: 'purchase', label: 'Закупка' },
            { value: 'order', label: 'Заказ' },
            { value: 'manual', label: 'Вручную' },
          ]}
        />
        <button className="btn-secondary btn-md" onClick={() => setFilter(emptyFilter)}>
          Сбросить фильтры
        </button>
      </div>

      <StatCardsRow>
        <StatCard
          label="Приход"
          value={s ? qtyOrDash(s.income) : '—'}
          icon={<IconPlus />}
          tone="success"
        />
        <StatCard
          label="Списание"
          value={s ? qtyOrDash(s.writeoff) : '—'}
          icon={<IconTrash />}
          tone="danger"
        />
        <StatCard label="Возвраты" value={s ? qtyOrDash(s.returns) : '—'} icon={<IconReconcile />} tone="primary" />
      </StatCardsRow>

      <div className="card overflow-hidden">
        {movementsQ.isLoading ? (
          <div className="flex justify-center py-12 text-primary">
            <Spinner className="h-6 w-6" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-border bg-background/50 text-left text-xs text-text-muted">
                  <th className="px-3 py-2.5 font-medium">Дата и время</th>
                  <th className="px-3 py-2.5 font-medium">Ингредиент</th>
                  <th className="px-3 py-2.5 font-medium">Тип</th>
                  <th className="px-3 py-2.5 font-medium">Источник</th>
                  <th className="px-3 py-2.5 font-medium">Документ</th>
                  <th className="px-3 py-2.5 text-right font-medium">Было</th>
                  <th className="px-3 py-2.5 text-right font-medium">Изменение</th>
                  <th className="px-3 py-2.5 text-right font-medium">Стало</th>
                  <th className="px-3 py-2.5 text-right font-medium">Себестоимость</th>
                  <th className="px-3 py-2.5 font-medium">Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {movementsQ.data?.map((m) => (
                  <MovementRow key={m.id} m={m} />
                ))}
                {movementsQ.data?.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-10 text-center text-text-muted">
                      Движений не найдено
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card flex items-start gap-3 p-4 text-sm text-text-secondary">
        <span className="mt-0.5 text-primary">
          <IconReconcile className="h-5 w-5" />
        </span>
        <p>
          При продаже блюда ингредиенты списываются автоматически по техкарте. При отмене или отказе выполняется обратный
          возврат.
        </p>
      </div>
    </div>
  );
}

function MovementRow({ m }: { m: StockMovement }) {
  const badge = TYPE_BADGE[m.type];
  const positive = m.change > 0;
  return (
    <tr className="border-b border-border last:border-0 hover:bg-background/60">
      <td className="px-3 py-2.5 text-text-secondary">{formatDateTime(m.createdAt)}</td>
      <td className="px-3 py-2.5 font-medium text-text-primary">{m.ingredientName}</td>
      <td className="px-3 py-2.5">
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </td>
      <td className="px-3 py-2.5 text-text-secondary">{SOURCE_LABEL[m.sourceType] ?? m.sourceType}</td>
      <td className="px-3 py-2.5 text-text-secondary">{m.documentLabel ?? '—'}</td>
      <td className="px-3 py-2.5 text-right text-text-secondary">{qty(m.beforeStock, m.unit)}</td>
      <td className={`px-3 py-2.5 text-right font-medium ${positive ? 'text-success' : 'text-danger'}`}>
        {positive ? '+' : ''}
        {qty(m.change, m.unit)}
      </td>
      <td className="px-3 py-2.5 text-right font-medium text-text-primary">{qty(m.afterStock, m.unit)}</td>
      <td className="px-3 py-2.5 text-right text-text-secondary">{money(m.costAtMoment)}</td>
      <td className="px-3 py-2.5 text-text-secondary">{m.comment ?? '—'}</td>
    </tr>
  );
}

function qtyOrDash(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'success' | 'danger' | 'primary' | 'muted' }) {
  const cls = {
    success: 'bg-success/10 text-success',
    danger: 'bg-danger/10 text-danger',
    primary: 'bg-primary/10 text-primary',
    muted: 'bg-slate-100 text-text-muted',
  }[tone];
  return <span className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}
