import { Fragment, useState } from 'react';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { money } from '@/lib/format';
import {
  purchaseNumber,
  qty,
  useProductionJournal,
  usePurchase,
  usePurchases,
  type WarehouseLocation,
} from './api';
import { useStockDocuments, type StockDocumentKind, type StockDocumentStatus } from './stock-documents-api';
import { documentLabel, documentStatus, formatDocumentDate, WRITEOFF_REASONS } from './stock-document-format';
import { QueryState } from './WarehouseUi';
import { unitLabel } from './units';

export function SupplyList({
  warehouseId,
  onOpen,
  onCreate,
  onReturn,
}: {
  warehouseId?: string;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onReturn: () => void;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState<string>();
  const query = usePurchases({ warehouseId, search, status });
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <input
          className="input h-10 min-w-40 flex-1 sm:max-w-xs"
          aria-label="Поиск поставок"
          placeholder="Поставщик или номер"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          ariaLabel="Статус поставки"
          value={status}
          onChange={setStatus}
          className="h-10 min-w-36"
          options={[
            { value: '', label: 'Все статусы' },
            { value: 'draft', label: 'Черновики' },
            { value: 'completed', label: 'Проведённые' },
            { value: 'cancelled', label: 'Сторнированные' },
          ]}
        />
        <div className="ml-auto flex gap-2">
          <button className="btn-secondary btn-md" onClick={onReturn}>
            Возврат поставщику
          </button>
          <button className="btn-primary btn-md" onClick={onCreate}>
            + Добавить
          </button>
        </div>
      </div>
      <QueryState pending={query.isPending} error={query.error} empty={query.isSuccess && !query.data.length}>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-border bg-background/50 text-xs text-text-muted">
              <tr>
                {['№', 'Дата', 'Поставщик', 'Комментарий', 'Статус', 'Сумма', ''].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.data?.map((p) => (
                <Fragment key={p.id}>
                  <tr className="border-b border-border hover:bg-background/50">
                    <td className="px-4 py-3">
                      <button className="font-medium text-primary" onClick={() => onOpen(p.id)}>
                        {purchaseNumber(p.number)}
                      </button>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDocumentDate(p.date)}</td>
                    <td className="px-4 py-3">{p.supplier}</td>
                    <td className="max-w-48 truncate px-4 py-3">{p.note || '—'}</td>
                    <td className="px-4 py-3">{purchaseStatus(p.status)}</td>
                    <td className="px-4 py-3 whitespace-nowrap font-medium">{money(p.totalAmount)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button
                          className="text-primary"
                          aria-expanded={expanded === p.id}
                          onClick={() => setExpanded(expanded === p.id ? undefined : p.id)}
                        >
                          Детали
                        </button>
                        <button className="text-primary" onClick={() => onOpen(p.id)}>
                          {p.status === 'draft' ? 'Ред.' : 'Открыть'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === p.id && (
                    <tr>
                      <td colSpan={7} className="bg-background/60 p-4">
                        <SupplyLines id={p.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-medium">
                <td className="px-4 py-3" colSpan={5}>
                  Итого по списку
                </td>
                <td className="px-4 py-3" colSpan={2}>
                  {money(query.data?.reduce((sum, p) => sum + p.totalAmount, 0) ?? 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {query.data?.map((p) => (
            <div key={p.id} className="space-y-3 p-4">
              <button
                className="flex w-full items-start justify-between gap-3 text-left"
                onClick={() => onOpen(p.id)}
              >
                <span>
                  <span className="block font-medium text-primary">
                    {purchaseNumber(p.number)} · {p.supplier}
                  </span>
                  <span className="text-xs text-text-muted">
                    {formatDocumentDate(p.date)} · {purchaseStatus(p.status)}
                  </span>
                </span>
                <span className="text-sm font-medium">{money(p.totalAmount)}</span>
              </button>
              {p.note && <p className="text-sm text-text-secondary">{p.note}</p>}
              <button
                className="text-sm text-primary"
                aria-expanded={expanded === p.id}
                onClick={() => setExpanded(expanded === p.id ? undefined : p.id)}
              >
                Детали
              </button>
              {expanded === p.id && <SupplyLines id={p.id} />}
            </div>
          ))}
        </div>
      </QueryState>
    </div>
  );
}
function purchaseStatus(status: string) {
  return status === 'draft' ? 'Черновик' : status === 'completed' ? 'Проведена' : 'Сторнирована';
}
function SupplyLines({ id }: { id: string }) {
  const q = usePurchase(id);
  return (
    <QueryState pending={q.isPending} error={q.error}>
      <div className="rounded-xl border border-border bg-white text-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_80px_80px] gap-2 border-b border-border px-3 py-2 text-xs text-text-muted">
          <span>Товар</span>
          <span>Количество</span>
          <span className="text-right">Сумма</span>
        </div>
        {q.data?.items?.map((i) => (
          <div key={i.id} className="grid grid-cols-[minmax(0,1fr)_80px_80px] gap-2 px-3 py-2">
            <span>{i.ingredientName}</span>
            <span>{qty(i.quantity, i.unit)}</span>
            <span className="text-right">{money(i.total)}</span>
          </div>
        ))}
      </div>
    </QueryState>
  );
}

export function DocumentList({
  kind,
  warehouseId,
  locations,
  onOpen,
  onCreate,
}: {
  kind: StockDocumentKind;
  warehouseId: string;
  locations: WarehouseLocation[];
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const query = useStockDocuments(warehouseId, kind);
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
  const rows = (query.data ?? []).filter(
    (d) =>
      (!status || d.status === status) &&
      (!reason || d.reason === reason) &&
      `${documentLabel(d)} ${d.note ?? ''} ${d.createdByName ?? ''}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const names = new Map(locations.map((l) => [l.id, l.name]));
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <input
          className="input h-10 min-w-40 flex-1 sm:max-w-xs"
          aria-label="Поиск документов"
          placeholder="Документ, сотрудник, комментарий"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          ariaLabel="Статус документа"
          value={status}
          onChange={setStatus}
          className="h-10 min-w-36"
          options={[
            { value: '', label: 'Все статусы' },
            ...['draft', 'submitted', 'posted', 'reversed'].map((v) => ({
              value: v,
              label: documentStatus(v as StockDocumentStatus),
            })),
          ]}
        />
        {kind === 'writeoff' && (
          <Select
            ariaLabel="Причина списания"
            value={reason}
            onChange={setReason}
            className="h-10 min-w-36"
            options={[{ value: '', label: 'Все причины' }, ...WRITEOFF_REASONS]}
          />
        )}
        <button className="btn-primary btn-md ml-auto" onClick={onCreate}>
          + Добавить
        </button>
      </div>
      <QueryState pending={query.isPending} error={query.error} empty={query.isSuccess && !rows.length}>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-border bg-background/50 text-xs text-text-muted">
              <tr>
                {[
                  'Дата',
                  'Документ',
                  'Склад',
                  kind === 'inventory' ? 'Тип' : 'Комментарий',
                  'Сотрудник',
                  'Статус',
                  ...(costs ? ['Сумма'] : []),
                ].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((d) => (
                <tr key={d.id} className="hover:bg-background/50">
                  <td className="px-4 py-3 whitespace-nowrap">{formatDocumentDate(d.createdAt)}</td>
                  <td className="px-4 py-3">
                    <button className="font-medium text-primary" onClick={() => onOpen(d.id)}>
                      {documentLabel(d)}
                    </button>
                    <p className="text-xs text-text-muted">{d.itemsCount} позиций</p>
                  </td>
                  <td className="px-4 py-3">
                    {names.get(d.warehouseId) ?? 'Склад'}
                    {d.destinationWarehouseId && ` → ${names.get(d.destinationWarehouseId) ?? 'Склад'}`}
                  </td>
                  <td className="px-4 py-3">
                    {kind === 'inventory'
                      ? d.mode === 'full'
                        ? 'Полная'
                        : 'Частичная'
                      : kind === 'writeoff'
                        ? (WRITEOFF_REASONS.find((r) => r.value === d.reason)?.label ?? d.note ?? '—')
                        : d.note || '—'}
                  </td>
                  <td className="px-4 py-3">{d.createdByName || '—'}</td>
                  <td className="px-4 py-3">{documentStatus(d.status)}</td>
                  {costs && (
                    <td className="px-4 py-3 font-medium">
                      {d.varianceValue == null ? '—' : money(d.varianceValue)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {rows.map((d) => (
            <button key={d.id} className="block w-full space-y-2 p-4 text-left" onClick={() => onOpen(d.id)}>
              <span className="flex justify-between gap-2 text-sm">
                <span className="font-medium text-primary">{documentLabel(d)}</span>
                <span>{documentStatus(d.status)}</span>
              </span>
              <span className="block text-xs text-text-muted">
                {formatDocumentDate(d.createdAt)} · {names.get(d.warehouseId)}
                {d.destinationWarehouseId ? ` → ${names.get(d.destinationWarehouseId)}` : ''}
              </span>
              <span className="flex justify-between gap-2 text-sm">
                <span>{d.note || `${d.itemsCount} позиций`}</span>
                {costs && <span>{d.varianceValue == null ? '—' : money(d.varianceValue)}</span>}
              </span>
            </button>
          ))}
        </div>
      </QueryState>
    </div>
  );
}

export function ProductionList({
  warehouseId,
  onOpen,
  onCreate,
}: {
  warehouseId: string;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const query = useProductionJournal(warehouseId);
  const [search, setSearch] = useState('');
  const rows = (query.data ?? []).filter((m) =>
    m.ingredientName.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap gap-2 border-b border-border p-4">
        <input
          className="input h-10 min-w-40 flex-1 sm:max-w-xs"
          aria-label="Поиск производства"
          placeholder="Полуфабрикат"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn-primary btn-md ml-auto" onClick={onCreate}>
          + Произвести
        </button>
      </div>
      <QueryState pending={query.isPending} error={query.error} empty={query.isSuccess && !rows.length}>
        <div className="divide-y divide-border">
          {rows.map((m) => (
            <button
              key={m.id}
              className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left"
              onClick={() => onOpen(m.id)}
            >
              <span>
                <span className="block text-sm font-medium text-primary">{m.ingredientName}</span>
                <span className="text-xs text-text-muted">
                  {formatDocumentDate(m.producedAt)}
                  {m.batchNumber ? ` · № ${m.batchNumber}` : ''}
                  {m.reversedAt ? ' · Сторнирована' : ''}
                </span>
              </span>
              <span className="text-sm">{qty(m.actualQuantity, unitLabel(m.unit))}</span>
            </button>
          ))}
        </div>
      </QueryState>
    </div>
  );
}
