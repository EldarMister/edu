import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePageFilter, useEditorRoute } from './workspace-route';
import { EditorPage, useEditorDirty } from './EditorPage';
import { Modal } from '@/components/Modal';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { Select } from '@/components/Select';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useSuppliers, useSupplierMutations, useSupplierSettlements, type Supplier } from './settings-api';
import { useWarehouseLocationMutations, type WarehouseLocations, type WarehouseLocation } from './api';
import { usePackages, usePackageMutations, type PackageUnit } from './extended-api';
import { UNIT_OPTIONS, unitLabel, type UnitCode } from './units';
import { DocumentField, DocumentFooter, QueryState } from './WarehouseUi';
import { balanceMoney } from './balance-format';

function DirectoryNameHeader({ ascending, onToggle, children = 'Название' }: {
  ascending: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return <th aria-sort={ascending ? 'ascending' : 'descending'}>
    <button type="button" className="inline-flex items-center gap-2 text-left" onClick={onToggle}
      aria-label={`Сортировать по названию: ${ascending ? 'от Я до А' : 'от А до Я'}`}>
      {children}<span aria-hidden="true">{ascending ? '↑' : '↓'}</span>
    </button>
  </th>;
}

function DirectoryActions({
  onEdit,
  onArchive,
  pending,
  label,
}: {
  onEdit: () => void;
  onArchive?: () => void;
  pending?: boolean;
  label: string;
}) {
  const menuId = useId();
  const permissions = usePermissions();
  const editable = permissions.canEditSection('warehouse') && permissions.canAction('warehouseSettings');
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!position) return;
    popup.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const close = () => setPosition(null);
    const outside = (event: MouseEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node))
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [position]);
  return (
    <div className="poster-row-actions justify-end">
      <button type="button" aria-label={`${editable ? 'Редактировать' : 'Открыть'}: ${label}`} onClick={onEdit}>
        {editable ? 'Ред.' : 'Открыть'}
      </button>
      {editable && onArchive && (
        <>
          <button
            type="button"
            ref={trigger}
            className="px-2"
            aria-label={`Другие действия: ${label}`}
            aria-haspopup="menu"
            aria-expanded={!!position}
            aria-controls={position ? menuId : undefined}
            onClick={() => {
              const rect = trigger.current?.getBoundingClientRect();
              if (!rect || position) {
                setPosition(null);
                return;
              }
              setPosition({
                top: rect.bottom + 52 > window.innerHeight ? Math.max(8, rect.top - 48) : rect.bottom + 4,
                left: Math.max(8, Math.min(window.innerWidth - 168, rect.right - 160)),
              });
            }}
          >
            •••
          </button>
          {position &&
            createPortal(
              <div
                ref={popup}
                id={menuId}
                role="menu"
                aria-label={`Действия: ${label}`}
                style={position}
                className="fixed z-[70] w-40 border border-border bg-white p-1 text-sm shadow-md"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="w-full px-3 py-2 text-left text-text-primary hover:bg-background"
                  disabled={pending}
                  onClick={() => {
                    setPosition(null);
                    onArchive();
                  }}
                >
                  В архив
                </button>
              </div>,
              document.body,
            )}
        </>
      )}
    </div>
  );
}
function MissingDirectoryItem({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <EditorPage title={title} onClose={onClose}>
      {children}
    </EditorPage>
  );
}

export function SuppliersPage() {
  const permissions = usePermissions();
  const editable = permissions.canEditSection('warehouse') && permissions.canAction('warehouseSettings');
  const canReadCosts = permissions.canAction('warehouseCosts');
  const q = useSuppliers();
  const settlement = useSupplierSettlements(canReadCosts);
  const mutations = useSupplierMutations();
  const [search, setSearch] = usePageFilter('search');
  const [sort, setSort] = usePageFilter('sort', 'asc');
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [error, setError] = useState('');
  const rows = (q.data ?? []).filter((s) =>
    `${s.name} ${s.phone ?? ''} ${s.address ?? ''} ${s.note ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  ).sort((a, b) => a.name.localeCompare(b.name, 'ru') * (sort === 'desc' ? -1 : 1));
  async function archive(supplier: Supplier) {
    if (!confirm(`Архивировать поставщика «${supplier.name}»? История поставок сохранится.`)) return;
    try {
      await mutations.archive.mutateAsync(supplier.id);
    } catch (failure) {
      setError(apiError(failure));
    }
  }
  const supplier = editor?.type === 'supplier' && editor.id ? q.data?.find((item) => item.id === editor.id) : undefined;
  const totals = new Map(settlement.data?.map((row) => [row.supplierId, row]));
  return (
    <div className="poster-directory-surface">
      <div className="poster-toolbar">
        <WorkspaceSearch value={search} onChange={setSearch} label="Поиск поставщика" placeholder="Поиск..." />
        {editable && <button type="button" className="btn-primary btn-md ml-auto" onClick={() => openEditor({ type: 'supplier' })}>Добавить</button>}
      </div>
      {error && (
        <p role="alert" className="py-3 text-danger">
          {error}
        </p>
      )}
      {canReadCosts && settlement.isError && <p role="alert" className="py-3 text-danger">Не удалось загрузить взаиморасчёты. <button type="button" className="text-primary" onClick={() => void settlement.refetch()}>Повторить</button></p>}
      <QueryState pending={q.isPending} error={q.error}>
        <div className="overflow-x-auto">
          <table className={`poster-table poster-directory-table poster-directory-table--suppliers w-full ${canReadCosts ? 'min-w-[920px]' : 'min-w-[760px]'}`}>
            <thead>
              <tr>
                <DirectoryNameHeader ascending={sort !== 'desc'} onToggle={() => setSort(sort === 'desc' ? 'asc' : 'desc')}>Имя</DirectoryNameHeader>
                <th>Телефон</th>
                <th>Адрес</th>
                <th>Комментарий</th>
                {canReadCosts && <><th className="text-right">Сумма поставок</th><th className="text-right">Задолженность</th></>}
                <th><span className="sr-only">Действия</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((supplier) => {
                const result = totals.get(supplier.id);
                return (
                <tr key={supplier.id}>
                  <td>
                    <button
                      type="button"
                      className="block max-w-full truncate text-left text-primary"
                      title={supplier.name}
                      onClick={() => openEditor({ type: 'supplier', id: supplier.id })}
                    >
                      {supplier.name}
                    </button>
                  </td>
                  <td><span className="block truncate" title={supplier.phone || undefined}>{supplier.phone || '—'}</span></td>
                  <td><span className="block truncate" title={supplier.address || undefined}>{supplier.address || '—'}</span></td>
                  <td><span className="block truncate" title={supplier.note || undefined}>{supplier.note || '—'}</span></td>
                  {canReadCosts && <>
                    <td className="text-right tabular-nums">{result ? balanceMoney(result.purchaseTotal) : '—'}</td>
                    <td className="text-right tabular-nums">
                      {result ? balanceMoney(result.knownDebt) : '—'}
                      {!!result?.missingSettlementCount && <span className="block text-xs text-text-muted">По сверенным. Требуют сверки: {result.missingSettlementCount}</span>}
                    </td>
                  </>}
                  <td>
                    <DirectoryActions
                      label={supplier.name}
                      onEdit={() => openEditor({ type: 'supplier', id: supplier.id })}
                      onArchive={() => void archive(supplier)}
                      pending={mutations.archive.isPending}
                    />
                  </td>
                </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={canReadCosts ? 7 : 5} className="poster-directory-empty text-center text-text-muted">
                    {search ? 'Поставщики не найдены' : 'Здесь будут ваши поставщики'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </QueryState>
      {editor?.type === 'supplier' && (editor.id && !supplier ? <Modal open onClose={closeEditor} title="Поставщик недоступен">
        <QueryState pending={q.isPending} error={q.error}>
          <p className="text-sm text-text-secondary">Поставщик не найден или находится в архиве.</p>
        </QueryState>
      </Modal> : <SupplierForm key={editor.id ?? 'new'} supplier={supplier} onClose={closeEditor} />)}
    </div>
  );
}
function SupplierForm({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
  const permissions = usePermissions();
  const editable = permissions.canEditSection('warehouse') && permissions.canAction('warehouseSettings');
  const formId = useId();
  const { save } = useSupplierMutations();
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    taxId: supplier?.taxId ?? '',
    phone: supplier?.phone ?? '',
    address: supplier?.address ?? '',
    note: supplier?.note ?? '',
    email: supplier?.email ?? '',
  });
  const initial = useRef(JSON.stringify(form));
  const dirty = editable && JSON.stringify(form) !== initial.current;
  const { markSaved } = useEditorDirty(dirty);
  const [error, setError] = useState('');
  function close() {
    if (save.isPending || dirty && !confirm('Закрыть форму и отменить изменения?')) return;
    markSaved();
    onClose();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editable || save.isPending || !form.name.trim()) return;
    try {
      await save.mutateAsync({ id: supplier?.id, ...form, name: form.name.trim() });
      markSaved();
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  return (
    <Modal
      open
      onClose={close}
      title={supplier ? editable ? 'Редактирование поставщика' : 'Поставщик' : 'Новый поставщик'}
      panelClassName="max-w-lg"
      footer={editable && <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={close} disabled={save.isPending}>Отмена</button>
        <button type="submit" form={formId} className="btn-primary btn-sm" disabled={save.isPending || !form.name.trim()}>Сохранить</button>
      </div>}
    >
      <form id={formId} className="poster-form poster-form--directory poster-document--modern" onSubmit={submit}>
        <fieldset disabled={!editable || save.isPending} className="min-w-0">
        <div className="poster-document-panel">
        {(
          [
            { key: 'name', label: 'Название' },
            { key: 'taxId', label: 'ИНН' },
            { key: 'phone', label: 'Телефон' },
            { key: 'address', label: 'Адрес' },
            { key: 'note', label: 'Комментарий' },
          ] as const
        ).map(({ key, label }) => (
          <DocumentField key={key} label={label}>
            {key === 'address' || key === 'note' ? (
              <textarea
                className="input h-16 w-full py-2"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            ) : (
              <input
                className="input w-full"
                type={key === 'phone' ? 'tel' : 'text'}
                autoFocus={editable && key === 'name'}
                required={key === 'name'}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            )}
          </DocumentField>
        ))}
        <details className="poster-advanced">
          <summary>Дополнительно</summary>
          <div className="pt-3">
            <DocumentField label="Электронная почта">
              <input
                className="input w-full"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </DocumentField>
          </div>
        </details>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        </div>
        </fieldset>
      </form>
    </Modal>
  );
}

export function LocationsPage({ data }: { data: WarehouseLocations }) {
  const permissions = usePermissions();
  const editable = permissions.canEditSection('warehouse') && permissions.canAction('warehouseSettings');
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [search, setSearch] = usePageFilter('search');
  const [sort, setSort] = usePageFilter('sort', 'asc');
  const [error, setError] = useState('');
  const { setRoute } = useWarehouseLocationMutations();
  const rows = data.locations.filter((item) =>
    `${item.name} ${item.address ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  ).sort((a, b) => a.name.localeCompare(b.name, 'ru') * (sort === 'desc' ? -1 : 1));
  async function assign(stationId: string, warehouseId: string) {
    try {
      await setRoute.mutateAsync({ stationId, warehouseId: warehouseId || null });
    } catch (failure) {
      setError(apiError(failure));
    }
  }
  const location = editor?.type === 'location' && editor.id ? data.locations.find((item) => item.id === editor.id) : undefined;
  return (
    <div className="poster-directory-surface">
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск склада" value={search} onChange={setSearch} placeholder="Поиск..." />
        {editable && <button type="button" className="btn-primary btn-md ml-auto" onClick={() => openEditor({ type: 'location' })}>Добавить</button>}
      </div>
      <div className="overflow-x-auto">
      <table className="poster-table poster-directory-table poster-directory-table--locations w-full min-w-[580px]">
        <colgroup><col style={{ width: 68 }} /><col style={{ width: '42%' }} /><col /><col style={{ width: 96 }} /></colgroup>
        <thead>
          <tr>
            <th className="w-16">№</th>
            <DirectoryNameHeader ascending={sort !== 'desc'} onToggle={() => setSort(sort === 'desc' ? 'asc' : 'desc')} />
            <th>Адрес</th>
            <th><span className="sr-only">Действия</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((location) => (
            <tr key={location.id}>
              <td>{data.locations.findIndex((item) => item.id === location.id) + 1}</td>
              <td>
                <button
                  type="button"
                  className="max-w-full truncate text-left text-primary"
                  title={location.name}
                  onClick={() => openEditor({ type: 'location', id: location.id })}
                >
                  {location.name}
                </button>
                {location.isDefault && <span className="ml-2 text-xs text-text-muted">По умолчанию</span>}
              </td>
              <td><span className="block truncate" title={location.address || undefined}>{location.address || '—'}</span></td>
              <td>
                <DirectoryActions
                  label={location.name}
                  onEdit={() => openEditor({ type: 'location', id: location.id })}
                />
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={4} className="poster-directory-empty text-center text-text-muted">
                Склады не найдены
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      <details className="poster-advanced mt-6">
        <summary>Склады для цехов</summary>
        <div className="poster-form poster-form--directory space-y-4 pt-5">
          {data.stationRoutes.map((station) => (
            <DocumentField key={station.stationId} label={station.stationName}>
              <Select
                ariaLabel={`Склад станции ${station.stationName}`}
                className="h-10 w-full"
                value={station.warehouseId ?? ''}
                disabled={!editable || setRoute.isPending}
                onChange={(value) => void assign(station.stationId, value)}
                options={[
                  { value: '', label: 'Склад по умолчанию' },
                  ...data.locations.map((location) => ({ value: location.id, label: location.name })),
                ]}
              />
            </DocumentField>
          ))}
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </div>
      </details>
      {editor?.type === 'location' && (editor.id && !location ? <Modal open onClose={closeEditor} title="Склад недоступен">
        <p className="text-sm text-text-secondary">Склад не найден.</p>
      </Modal> : <LocationForm key={editor.id ?? 'new'} location={location} onClose={closeEditor} />)}
    </div>
  );
}
function LocationForm({ location, onClose }: { location?: WarehouseLocation; onClose: () => void }) {
  const permissions = usePermissions();
  const editable = permissions.canEditSection('warehouse') && permissions.canAction('warehouseSettings');
  const formId = useId();
  const [name, setName] = useState(location?.name ?? '');
  const [address, setAddress] = useState(location?.address ?? '');
  const dirty = editable && (name !== (location?.name ?? '') || address !== (location?.address ?? ''));
  const { markSaved } = useEditorDirty(dirty);
  const [error, setError] = useState('');
  const { save } = useWarehouseLocationMutations();
  function close() {
    if (save.isPending || dirty && !confirm('Закрыть форму и отменить изменения?')) return;
    markSaved();
    onClose();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editable || save.isPending || !name.trim()) return;
    try {
      await save.mutateAsync({ id: location?.id, name: name.trim(), address });
      markSaved();
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  return (
    <Modal
      open
      onClose={close}
      title={location ? editable ? 'Редактирование склада' : 'Склад' : 'Новый склад'}
      footer={editable && <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={close} disabled={save.isPending}>Отмена</button>
        <button type="submit" form={formId} className="btn-primary btn-sm" disabled={save.isPending || !name.trim()}>Сохранить</button>
      </div>}
    >
      <form id={formId} className="poster-form poster-form--directory poster-document--modern" onSubmit={submit}>
        <fieldset disabled={!editable || save.isPending} className="min-w-0">
        <div className="poster-document-panel">
        <DocumentField label="Название">
          <input className="input w-full" required autoFocus={editable} value={name} onChange={(e) => setName(e.target.value)} />
        </DocumentField>
        <DocumentField label="Адрес">
          <textarea
            className="input h-16 w-full py-2"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </DocumentField>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        </div>
        </fieldset>
      </form>
    </Modal>
  );
}

export function PackagesPage() {
  const editable = usePermissions().can('actions.warehouseSettings');
  const q = usePackages();
  const mutations = usePackageMutations();
  const [search, setSearch] = usePageFilter('search');
  const [unit, setUnit] = usePageFilter('unit');
  const [sort, setSort] = usePageFilter('sort', 'asc');
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [error, setError] = useState('');
  const rows = (q.data ?? []).filter(
    (item) =>
      (!unit || item.unit === unit) && item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  ).sort((a, b) => a.name.localeCompare(b.name, 'ru') * (sort === 'desc' ? -1 : 1));
  async function archive(item: PackageUnit) {
    if (!confirm(`Архивировать фасовку «${item.name}»? Сохранённые поставки не изменятся.`)) return;
    try {
      await mutations.archive.mutateAsync(item.id);
    } catch (failure) {
      setError(apiError(failure));
    }
  }
  if (editor?.type === 'package') {
    const item = q.data?.find((row) => row.id === editor.id);
    if (editor.id && !item)
      return (
        <MissingDirectoryItem onClose={closeEditor} title="Фасовка недоступна">
          <QueryState pending={q.isPending} error={q.error}>
            <p className="text-sm text-text-secondary">
              Фасовка не найдена или находится в архиве. Вернитесь к списку фасовок.
            </p>
          </QueryState>
        </MissingDirectoryItem>
      );
    return <PackageForm key={editor.id ?? 'new'} item={item} onClose={closeEditor} />;
  }
  return (
    <div className="poster-directory-surface">
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск фасовок" value={search} onChange={setSearch} placeholder="Поиск..." />
        <Select
          ariaLabel="Единица фасовки"
          className="poster-filter w-44"
          value={unit}
          onChange={setUnit}
          options={[{ value: '', label: 'Ед. измерения' }, ...UNIT_OPTIONS]}
        />
        {editable && <button type="button" className="btn-primary btn-md ml-auto" onClick={() => openEditor({ type: 'package' })}>Добавить</button>}
      </div>
      {error && (
        <p role="alert" className="py-3 text-danger">
          {error}
        </p>
      )}
      <QueryState pending={q.isPending} error={q.error}>
        <div className="overflow-x-auto">
        <table className="poster-table poster-directory-table poster-directory-table--packages w-full min-w-[540px]">
          <colgroup><col style={{ width: '34%' }} /><col style={{ width: '28%' }} /><col /><col style={{ width: 110 }} /></colgroup>
          <thead>
            <tr>
              <DirectoryNameHeader ascending={sort !== 'desc'} onToggle={() => setSort(sort === 'desc' ? 'asc' : 'desc')} />
              <th>Ед. измерения</th>
              <th>Количество</th>
              <th><span className="sr-only">Действия</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id}>
                <td>
                  <button
                    type="button"
                    className="block max-w-full truncate text-left text-primary"
                    title={item.name}
                    onClick={() => openEditor({ type: 'package', id: item.id })}
                  >
                    {item.name}
                  </button>
                </td>
                <td>{unitLabel(item.unit)}</td>
                <td className="tabular-nums">{Number(item.quantity).toLocaleString('ru-RU', { maximumFractionDigits: 6 })}</td>
                <td>
                  <DirectoryActions
                    label={item.name}
                    onEdit={() => openEditor({ type: 'package', id: item.id })}
                    onArchive={() => void archive(item)}
                    pending={mutations.archive.isPending}
                  />
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="poster-directory-empty text-center">
                  <p className="font-semibold">
                    {search || unit ? 'Фасовки не найдены' : 'Здесь будут ваши фасовки'}
                  </p>
                  {!search && !unit && (
                    <p className="mt-2 text-sm text-text-muted">
                      Фасовки позволяют оформлять поставки упаковками — например, коробками по 12 штук.
                    </p>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </QueryState>
    </div>
  );
}
function PackageForm({ item, onClose }: { item?: PackageUnit; onClose: () => void }) {
  const editable = usePermissions().can('actions.warehouseSettings');
  const formId = useId();
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState<UnitCode>(item?.unit ?? 'kg');
  const [quantity, setQuantity] = useState(item?.quantity ? String(item.quantity) : '');
  const [error, setError] = useState('');
  const { save } = usePackageMutations();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editable || save.isPending || !name.trim() || !Number.isFinite(Number(quantity)) || !(Number(quantity) > 0)) return;
    try {
      await save.mutateAsync({ id: item?.id, name: name.trim(), unit, quantity: Number(quantity) });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  return (
    <EditorPage
      open
      onClose={onClose}
      title={item ? editable ? 'Редактирование фасовки' : 'Фасовка' : 'Новая фасовка'}
    >
      <form id={formId} className="poster-form poster-form--directory poster-document--modern" onSubmit={submit}>
        <fieldset disabled={!editable} className="min-w-0">
        <div className="poster-document-panel">
        <DocumentField label="Название">
          <input
            className="input w-full"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например, коробка 12 шт."
          />
        </DocumentField>
        <DocumentField label="Единица измерения">
          <Select
            ariaLabel="Единица фасовки"
            className="h-11 w-full"
            value={unit}
            onChange={(v) => setUnit(v as UnitCode)}
            options={UNIT_OPTIONS}
          />
        </DocumentField>
        <DocumentField label="Количество">
          <input
            className="input w-[208px] max-w-full"
            required
            type="number"
            step="any"
            min="0.000001"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </DocumentField>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        </div>
        {editable && <DocumentFooter>
          <button
            type="submit"
            form={formId}
            className="btn-primary btn-md"
            disabled={save.isPending || !name.trim() || !(Number(quantity) > 0)}
          >
            Сохранить
          </button>
        </DocumentFooter>}
        </fieldset>
      </form>
    </EditorPage>
  );
}
