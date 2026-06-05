import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { TableBadge } from '@/components/StatusBadge';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { StatCard, StatCardsRow } from '../components/StatCard';
import { IconHall, IconTables, IconCheck, IconClock, IconEdit, IconTrash, IconPlus } from '../components/icons';
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

  const [hallModal, setHallModal] = useState<AdminHall | null | 'new'>(null);
  const [tableModal, setTableModal] = useState<{ hall: AdminHall; table: AdminTableItem | null } | null>(null);

  const o = overview.data;

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

  return (
    <div className="space-y-4">
      <StatCardsRow>
        <StatCard label="Всего залов" value={o?.hallsCount ?? '—'} icon={<IconHall />} tone="primary" />
        <StatCard label="Всего столов" value={o?.tablesCount ?? '—'} icon={<IconTables />} tone="warning" />
        <StatCard label="Активных столов" value={o?.activeTablesCount ?? '—'} icon={<IconCheck />} tone="success" />
        <StatCard label="Занятых столов" value={o?.occupiedCount ?? '—'} icon={<IconClock />} tone="muted" />
      </StatCardsRow>

      <div className="flex items-center justify-end gap-2">
        <button className="btn-secondary btn-md" onClick={() => setHallModal('new')}>
          <IconPlus className="h-4 w-4" /> Добавить зал
        </button>
      </div>

      {hallsQ.isLoading ? (
        <div className="flex justify-center py-12 text-primary">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="space-y-3">
          {hallsQ.data?.map((hall) => (
            <div key={hall.id} className="card overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-border p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <IconHall className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-text-primary">{hall.name}</p>
                    <p className="text-xs text-text-muted">{hall.tables.length} столов</p>
                  </div>
                  {!hall.isActive && (
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-text-muted">отключён</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="btn-secondary btn-md"
                    onClick={() => setTableModal({ hall, table: null })}
                  >
                    <IconPlus className="h-4 w-4" /> Стол
                  </button>
                  <IconBtn onClick={() => setHallModal(hall)} title="Изменить зал">
                    <IconEdit className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn onClick={() => delHall(hall)} title="Удалить зал" danger>
                    <IconTrash className="h-4 w-4" />
                  </IconBtn>
                </div>
              </div>

              {hall.tables.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-text-muted">В зале пока нет столов</p>
              ) : (
                <ul className="divide-y divide-border">
                  {hall.tables.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-[15px] font-medium text-text-primary">
                          {t.number}
                        </span>
                        <div>
                          <p className="text-[15px] font-medium text-text-primary">Стол {t.number}</p>
                          <p className="text-xs text-text-muted">{t.seats} мест</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <TableBadge status={t.status} />
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
              )}
            </div>
          ))}
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
        danger ? 'text-text-light hover:text-danger' : 'text-text-light hover:text-primary'
      }`}
    >
      {children}
    </button>
  );
}
