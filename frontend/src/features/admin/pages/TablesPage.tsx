import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import { IconEdit, IconTrash, IconPlus } from '../components/icons';
import {
  useAdminHalls,
  useTablesOverview,
  useHallMutations,
  useTableMutations,
  type AdminHall,
  type AdminTableItem,
} from '../api';

export function TablesPage() {
  const overview = useTablesOverview();
  const hallsQ = useAdminHalls();
  const { remove: removeHall } = useHallMutations();
  const { remove: removeTable } = useTableMutations();
  const push = useNotifications((s) => s.push);
  const tr = useT();

  const [hallModal, setHallModal] = useState<AdminHall | null | 'new'>(null);
  const [tableModal, setTableModal] = useState<{ hall: AdminHall; table: AdminTableItem | null } | null>(null);
  const [collapsedHalls, setCollapsedHalls] = useState<Set<string>>(() => new Set());
  const [accordionReady, setAccordionReady] = useState(false);

  const o = overview.data;
  const halls = hallsQ.data ?? [];

  useEffect(() => {
    if (accordionReady || halls.length === 0) return;
    setCollapsedHalls(new Set(halls.slice(1).map((hall) => hall.id)));
    setAccordionReady(true);
  }, [accordionReady, halls]);

  async function delHall(h: AdminHall) {
    if (!confirm(`Удалить зал «${h.name}»?`)) return;
    try {
      await removeHall.mutateAsync(h.id);
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }
  async function delTable(t: AdminTableItem) {
    if (!confirm(`Удалить стол №${t.number}?`)) return;
    try {
      await removeTable.mutateAsync(t.id);
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  function toggleHall(id: string) {
    setCollapsedHalls((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-secondary">
          <Sum label={tr('Залов')} value={o?.hallsCount ?? '—'} />
          <Sep />
          <Sum label={tr('Столов')} value={o?.tablesCount ?? '—'} />
          <Sep />
          <Sum label={tr('Активных')} value={o?.activeTablesCount ?? '—'} />
          <Sep />
          <Sum label={tr('Занятых')} value={o?.occupiedCount ?? '—'} />
        </div>
        <button className="btn-secondary btn-md" onClick={() => setHallModal('new')}>
          <IconPlus className="h-4 w-4" /> {tr('Добавить зал')}
        </button>
      </div>

      {hallsQ.isLoading ? (
        <div className="flex justify-center py-12 text-primary">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="space-y-3">
          {halls.map((hall) => {
            const collapsed = collapsedHalls.has(hall.id);
            return (
              <div key={hall.id} className="overflow-hidden rounded-xl border border-border bg-white">
                <div
                  className={`flex items-center justify-between gap-3 px-4 py-3 ${
                    collapsed ? '' : 'border-b border-border'
                  }`}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => toggleHall(hall.id)}
                    aria-expanded={!collapsed}
                  >
                    <Chevron expanded={!collapsed} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-text-primary">{hall.name}</span>
                      <span className="block text-xs text-text-muted">{hall.tables.length} {tr('столов')}</span>
                    </span>
                  </button>
                  {!hall.isActive && (
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-text-muted">{tr('отключён')}</span>
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      className="btn-secondary btn-md h-9 px-3"
                      onClick={() => setTableModal({ hall, table: null })}
                    >
                      <IconPlus className="h-4 w-4" /> {tr('Стол')}
                    </button>
                    <IconBtn onClick={() => setHallModal(hall)} title="Изменить зал">
                      <IconEdit className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn onClick={() => delHall(hall)} title="Удалить зал" danger>
                      <IconTrash className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn onClick={() => toggleHall(hall.id)} title={collapsed ? 'Развернуть' : 'Свернуть'}>
                      <Chevron expanded={!collapsed} />
                    </IconBtn>
                  </div>
                </div>

                {!collapsed && (
                  hall.tables.length === 0 ? (
                    <p className="px-4 py-5 text-center text-sm text-text-muted">{tr('В зале пока нет столов')}</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {hall.tables.map((t) => (
                        <li key={t.id} className="flex items-center justify-between gap-3 px-6 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-[15px] font-medium text-text-primary">
                              {t.number}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[15px] font-medium text-text-primary">{tr('Стол')} {t.number}</p>
                              <p className="text-xs text-text-muted">{t.seats} {tr('мест')}</p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <AdminTableBadge status={t.status} />
                            <IconBtn onClick={() => setTableModal({ hall, table: t })} title="Изменить">
                              <IconEdit className="h-4 w-4" />
                            </IconBtn>
                            <IconBtn onClick={() => delTable(t)} title="Удалить" danger>
                              <IconTrash className="h-4 w-4" />
                            </IconBtn>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      {hallModal !== null && (
        <HallModal hall={hallModal === 'new' ? null : hallModal} onClose={() => setHallModal(null)} />
      )}
      {tableModal && (
        <TableModal
          hall={tableModal.hall}
          table={tableModal.table}
          onClose={() => setTableModal(null)}
        />
      )}
    </div>
  );
}

function Sum({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span>
      {label}: <span className="font-medium text-text-primary">{value}</span>
    </span>
  );
}

function Sep() {
  return <span className="text-text-light">|</span>;
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-text-secondary transition-transform ${expanded ? 'rotate-180' : ''}`}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function AdminTableBadge({ status }: { status: AdminTableItem['status'] }) {
  const tr = useT();
  if (status === 'free') {
    return (
      <span className="inline-flex items-center rounded-md bg-success/10 px-2 py-0.5 text-[12px] font-medium text-success">
        {tr('Свободен')}
      </span>
    );
  }
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">
        {tr('Готов')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md bg-orange-100 px-2 py-0.5 text-[12px] font-medium text-orange-600">
      {tr('Готовится')}
    </span>
  );
}

function HallModal({ hall, onClose }: { hall: AdminHall | null; onClose: () => void }) {
  const isEdit = !!hall;
  const { create, update } = useHallMutations();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState(hall?.name ?? '');
  const [isActive, setIsActive] = useState(hall?.isActive ?? true);
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  async function onSubmit() {
    setError('');
    if (!name.trim()) {
      setError('Укажите название');
      return;
    }
    try {
      if (isEdit) await update.mutateAsync({ id: hall!.id, name: name.trim(), isActive });
      else await create.mutateAsync({ name: name.trim() });
      push({ message: isEdit ? 'Зал обновлён' : 'Зал добавлен', at: new Date().toISOString() });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Изменить зал' : 'Новый зал'}
      footer={
        <button className="btn-primary btn-lg w-full font-semibold" disabled={pending} onClick={onSubmit}>
          {pending ? <Spinner /> : isEdit ? 'Сохранить' : 'Добавить'}
        </button>
      }
    >
      <div className="space-y-3">
        <Field label="Название зала">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Основной зал" />
        </Field>
        {isEdit && (
          <label className="flex items-center gap-2.5 text-sm text-text-secondary">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Зал активен
          </label>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function TableModal({
  hall,
  table,
  onClose,
}: {
  hall: AdminHall;
  table: AdminTableItem | null;
  onClose: () => void;
}) {
  const isEdit = !!table;
  const { create, update } = useTableMutations();
  const push = useNotifications((s) => s.push);
  const [number, setNumber] = useState(table ? String(table.number) : '');
  const [seats, setSeats] = useState(table ? String(table.seats) : '2');
  const [isActive, setIsActive] = useState(table?.isActive ?? true);
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  async function onSubmit() {
    setError('');
    if (!number || !seats) {
      setError('Укажите номер и количество мест');
      return;
    }
    try {
      if (isEdit) {
        await update.mutateAsync({ id: table!.id, number: Number(number), seats: Number(seats), isActive });
        push({ message: 'Стол обновлён', at: new Date().toISOString() });
      } else {
        await create.mutateAsync({ hallId: hall.id, number: Number(number), seats: Number(seats) });
        push({ message: 'Стол добавлен', at: new Date().toISOString() });
      }
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Стол №${table!.number}` : `Новый стол · ${hall.name}`}
      footer={
        <button className="btn-primary btn-lg w-full font-semibold" disabled={pending} onClick={onSubmit}>
          {pending ? <Spinner /> : isEdit ? 'Сохранить' : 'Добавить'}
        </button>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Номер стола">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </Field>
          <Field label="Мест">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
            />
          </Field>
        </div>
        {isEdit && (
          <label className="flex items-center gap-2.5 text-sm text-text-secondary">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Стол активен
          </label>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text-secondary">{label}</label>
      {children}
    </div>
  );
}
function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-lg p-2 transition-colors hover:bg-background ${
        danger ? 'text-danger hover:bg-danger/5' : 'text-text-light hover:text-primary'
      }`}
    >
      {children}
    </button>
  );
}
