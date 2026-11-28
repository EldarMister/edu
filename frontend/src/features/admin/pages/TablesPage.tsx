import { WorkspaceHeaderActions } from './WorkspaceHeader';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { DeleteNameField } from '../components/DeleteNameField';
import { captureDeletionEffect } from '../components/deletion-effect';
import { Spinner } from '@/components/Spinner';
import { WorkspacePending } from '../components/WorkspacePending';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { tableLabel } from '@/lib/format';
import { useNotifications } from '@/store/notifications';
import { IconEdit, IconTrash, IconPlus, IconQr } from '../components/icons';
import { TableQrModal } from '../components/TableQrModal';
import { HallFloorPlanEditor } from '../components/HallFloorPlanEditor';
import { TableEditor } from '../components/TableEditor';
import { usePageFilter } from './warehouse/workspace-route';
import { usePublicSettings } from '@/features/settings/api';
import {
  useAdminHalls,
  useTablesOverview,
  useHallMutations,
  useFloorPlanMutations,
  useTableMutations,
  type AdminHall,
  type AdminTableItem,
} from '../api';

export function TablesPage() {
  const editable = usePermissions().canEditSection('tables');
  const overview = useTablesOverview();
  const hallsQ = useAdminHalls();
  const settings = usePublicSettings();
  const { setMode } = useFloorPlanMutations();
  const [view, setView] = usePageFilter('view');
  const { remove: removeHall } = useHallMutations();
  const { remove: removeTable } = useTableMutations();
  const push = useNotifications((s) => s.push);
  const tr = useT();

  const [hallModal, setHallModal] = useState<AdminHall | null | 'new'>(null);
  const [hallToDelete, setHallToDelete] = useState<{ hall: AdminHall; confirmation: string } | null>(null);
  const hallDeleteConfirmed = !!hallToDelete && hallToDelete.confirmation.trim() === hallToDelete.hall.name.trim();
  const [tableModal, setTableModal] = useState<{ hall: AdminHall; table: AdminTableItem | null; copy?: AdminTableItem } | null>(null);
  const [tableToDelete, setTableToDelete] = useState<AdminTableItem | null>(null);
  const [qrModal, setQrModal] = useState<{ table: AdminTableItem; hallName: string } | null>(null);
  const [collapsedHalls, setCollapsedHalls] = useState<Set<string>>(() => new Set());
  const [accordionReady, setAccordionReady] = useState(false);

  const o = overview.data;
  const halls = hallsQ.data ?? [];
  const tableToDeleteHall = halls.find((hall) => hall.id === tableToDelete?.hallId);
  const mapView = view !== 'list';

  async function changeMode(useMap: boolean) {
    if (!editable || setMode.isPending) return;
    try {
      await setMode.mutateAsync(useMap);
    } catch (error) {
      push({ message: apiError(error), type: 'error', at: new Date().toISOString() });
    }
  }

  useEffect(() => {
    if (accordionReady || halls.length === 0) return;
    setCollapsedHalls(new Set(halls.slice(1).map((hall) => hall.id)));
    setAccordionReady(true);
  }, [accordionReady, halls]);

  async function delHall() {
    if (!editable || !hallToDelete || !hallDeleteConfirmed || removeHall.isPending) return;
    try {
      await removeHall.mutateAsync(hallToDelete.hall.id);
      setHallToDelete(null);
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }
  function requestTableDelete(table: AdminTableItem) {
    if (!editable || removeTable.isPending) return;
    removeTable.reset();
    setTableToDelete(table);
  }

  function confirmTableDelete() {
    if (!editable || !tableToDelete || removeTable.isPending) return;
    const playEffect = captureDeletionEffect(`hall-table-${tableToDelete.id}`);
    removeTable.mutate(tableToDelete.id, {
      onSuccess: () => {
        setTableToDelete(null);
        playEffect?.();
      },
    });
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
    <div className="workspace-stagger space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Раздел столов" className="inline-flex gap-1 rounded-xl border border-border bg-white p-1">
          <button type="button" aria-pressed={!mapView} className={`rounded-lg px-3 py-2 text-sm ${!mapView ? 'bg-primary text-white' : 'text-text-secondary'}`}
            onClick={() => setView('list')}>Список столов</button>
          <button type="button" aria-pressed={mapView} className={`rounded-lg px-3 py-2 text-sm ${mapView ? 'bg-primary text-white' : 'text-text-secondary'}`}
            onClick={() => setView('map')}>Редактор столов</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-text-muted">На кассе по умолчанию</span>
          <div role="group" aria-label="Режим залов на кассе по умолчанию" className="inline-flex gap-1 rounded-xl border border-border bg-white p-1">
            <button type="button" aria-pressed={settings.isSuccess && !settings.data?.useFloorPlan} disabled={!editable || !settings.isSuccess || setMode.isPending}
              className="rounded-lg px-3 py-2 text-sm text-text-secondary aria-pressed:bg-primary aria-pressed:text-white disabled:opacity-70"
              onClick={() => { if (settings.data?.useFloorPlan) void changeMode(false); }}>Обычные кнопки</button>
            <button type="button" aria-pressed={settings.data?.useFloorPlan === true} disabled={!editable || !settings.isSuccess || setMode.isPending}
              className="rounded-lg px-3 py-2 text-sm text-text-secondary aria-pressed:bg-primary aria-pressed:text-white disabled:opacity-70"
              onClick={() => { if (!settings.data?.useFloorPlan) void changeMode(true); }}>Карта зала</button>
          </div>
        </div>
      </div>
      {editable && !mapView && <WorkspaceHeaderActions>
        <button type="button" className="btn-primary btn-md" onClick={() => setHallModal('new')}>
          <IconPlus className="h-4 w-4" /> {tr('Добавить зал')}
        </button>
      </WorkspaceHeaderActions>}
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
      </div>

      {hallsQ.isLoading ? (
        <WorkspacePending />
      ) : hallsQ.isError ? (
        <p role="alert" className="text-sm text-danger">{apiError(hallsQ.error)}</p>
      ) : mapView ? (
        <HallFloorPlanEditor halls={halls} editable={editable}
          onAddHall={() => setHallModal('new')}
          onEditHall={setHallModal}
          onRemoveHall={(hall) => setHallToDelete({ hall, confirmation: '' })}
          onAdd={(hall) => setTableModal({ hall, table: null })}
          onEdit={(hall, table) => setTableModal({ hall, table })}
          onCopy={(hall, copy) => setTableModal({ hall, table: null, copy })}
          onRemove={requestTableDelete} />
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
                      <span className="block text-xs text-text-muted">
                        {hall.tables.length} {tr('столов')}
                        {hall.useFloorPlan != null && <> · {hall.useFloorPlan ? 'Карта зала' : 'Обычные кнопки'}</>}
                      </span>
                    </span>
                  </button>
                  {!hall.isActive && (
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-text-muted">{tr('отключён')}</span>
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    {editable && <><button
                      className="btn-secondary btn-md h-9 px-3"
                      onClick={() => setTableModal({ hall, table: null })}
                    >
                      <IconPlus className="h-4 w-4" /> {tr('Стол')}
                    </button>
                    <IconBtn onClick={() => setHallModal(hall)} title="Изменить зал">
                      <IconEdit className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn onClick={() => setHallToDelete({ hall, confirmation: '' })} title="Удалить зал" danger>
                      <IconTrash className="h-4 w-4" />
                    </IconBtn></>}
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
                        <li key={t.id} id={`hall-table-${t.id}`} className="flex items-center justify-between gap-3 px-6 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-[15px] font-medium text-text-primary">
                              {t.number}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[15px] font-medium text-text-primary">{tableLabel(t, tr('Стол'))}</p>
                              <p className="text-xs text-text-muted">{t.seats} {tr('мест')}</p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <AdminTableBadge status={t.status} />
                            <IconBtn onClick={() => setQrModal({ table: t, hallName: hall.name })} title="QR-код меню">
                              <IconQr className="h-4 w-4" />
                            </IconBtn>
                            {editable && <><IconBtn onClick={() => setTableModal({ hall, table: t })} title="Изменить">
                              <IconEdit className="h-4 w-4" />
                            </IconBtn>
                            <IconBtn onClick={() => requestTableDelete(t)} title="Удалить" danger>
                              <IconTrash className="h-4 w-4" />
                            </IconBtn></>}
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

      {editable && hallModal !== null && (
        <HallModal hall={hallModal === 'new' ? null : hallModal} onClose={() => setHallModal(null)} />
      )}
      {editable && hallToDelete && (
        <Modal open title="Удалить зал" onClose={() => !removeHall.isPending && setHallToDelete(null)} footer={
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary btn-lg" disabled={removeHall.isPending} onClick={() => setHallToDelete(null)}>Отмена</button>
            <button type="button" className="btn-danger btn-lg font-semibold" disabled={removeHall.isPending || !hallDeleteConfirmed} onClick={delHall}>Удалить</button>
          </div>
        }>
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">Удалить зал «{hallToDelete.hall.name}»?</p>
            <DeleteNameField label="Введите название зала для подтверждения"
              value={hallToDelete.confirmation} disabled={removeHall.isPending}
              onChange={(confirmation) => setHallToDelete({ ...hallToDelete, confirmation })} />
          </div>
        </Modal>
      )}
      {editable && tableToDelete && (
        <Modal open title="Удалить стол" onClose={() => !removeTable.isPending && setTableToDelete(null)} footer={
          <div className="grid grid-cols-2 gap-2">
            <button type="button" autoFocus className="btn-secondary btn-lg" disabled={removeTable.isPending}
              onClick={() => setTableToDelete(null)}>Отмена</button>
            <button type="button" className="btn-danger btn-lg font-semibold" disabled={removeTable.isPending}
              onClick={confirmTableDelete}>
              {removeTable.isPending ? 'Удаление…' : 'Удалить'}
            </button>
          </div>
        }>
          <div className="space-y-2 text-sm">
            <p className="text-text-primary">
              Удалить стол {tableToDelete.name ? `«${tableToDelete.name}»` : `№${tableToDelete.number}`}
              {tableToDeleteHall ? ` из зала «${tableToDeleteHall.name}»` : ''}?
            </p>
            <p className="text-text-muted">Стол исчезнет с кассы. История заказов сохранится.</p>
            {removeTable.error && <p role="alert" className="text-danger">{apiError(removeTable.error)}</p>}
          </div>
        </Modal>
      )}
      {editable && tableModal && (
        <TableEditor
          hall={tableModal.hall}
          table={tableModal.table}
          copy={tableModal.copy}
          onClose={() => setTableModal(null)}
        />
      )}
      {qrModal && (
        <TableQrModal table={qrModal.table} hallName={qrModal.hallName} onClose={() => setQrModal(null)} />
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
  const [tableDisplay, setTableDisplay] = useState(
    hall?.useFloorPlan == null ? 'inherit' : hall.useFloorPlan ? 'map' : 'buttons',
  );
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  async function onSubmit() {
    setError('');
    if (!name.trim()) {
      setError('Укажите название');
      return;
    }
    try {
      const data = { name: name.trim(), useFloorPlan: tableDisplay === 'inherit' ? null : tableDisplay === 'map' };
      if (hall) await update.mutateAsync({ id: hall.id, ...data, isActive });
      else await create.mutateAsync(data);
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
        <Field label="Выбор стола на кассе">
          <Select
            ariaLabel="Выбор стола на кассе"
            value={tableDisplay}
            onChange={setTableDisplay}
            disabled={pending}
            options={[
              { value: 'inherit', label: 'По общей настройке' },
              { value: 'map', label: 'Карта зала' },
              { value: 'buttons', label: 'Обычные кнопки' },
            ]}
          />
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

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-text-secondary">{label}</label>
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
        danger ? 'text-danger hover:bg-danger/5' : 'text-text-muted hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}
