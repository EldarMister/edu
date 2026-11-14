import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePageFilter, useEditorRoute } from './workspace-route';
import { EditorPage } from './EditorPage';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { Select } from '@/components/Select';
import { apiError } from '@/lib/api';
import { useSuppliers, useSupplierMutations, type Supplier } from './settings-api';
import { useWarehouseLocationMutations, type WarehouseLocations, type WarehouseLocation } from './api';
import { usePackages, usePackageMutations, type PackageUnit } from './extended-api';
import { UNIT_OPTIONS, unitLabel, type UnitCode } from './units';
import { DocumentField, DocumentFooter, QueryState } from './WarehouseUi';

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
      <button type="button" aria-label={`Редактировать: ${label}`} onClick={onEdit}>
        Ред.
      </button>
      {onArchive && (
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
  const q = useSuppliers();
  const mutations = useSupplierMutations();
  const [search, setSearch] = usePageFilter('search');
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [error, setError] = useState('');
  const rows = (q.data ?? []).filter((s) =>
    `${s.name} ${s.phone ?? ''} ${s.address ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  async function archive(supplier: Supplier) {
    if (!confirm(`Архивировать поставщика «${supplier.name}»? История поставок сохранится.`)) return;
    try {
      await mutations.archive.mutateAsync(supplier.id);
    } catch (failure) {
      setError(apiError(failure));
    }
  }
  if (editor?.type === 'supplier') {
    const supplier = q.data?.find((item) => item.id === editor.id);
    if (editor.id && !supplier)
      return (
        <MissingDirectoryItem onClose={closeEditor} title="Поставщик недоступен">
          <QueryState pending={q.isPending} error={q.error}>
            <p className="text-sm text-text-secondary">
              Поставщик не найден или находится в архиве. Вернитесь к списку поставщиков.
            </p>
          </QueryState>
        </MissingDirectoryItem>
      );
    return <SupplierForm key={editor.id ?? 'new'} supplier={supplier} onClose={closeEditor} />;
  }
  return (
    <div>
      <WorkspaceHeaderCount count={q.data?.length} />
      <WorkspaceHeaderActions>
        <button className="btn-primary btn-md" onClick={() => openEditor({ type: 'supplier' })}>
          Добавить
        </button>
      </WorkspaceHeaderActions>
      <div className="poster-toolbar">
        <WorkspaceSearch value={search} onChange={setSearch} label="Поиск поставщика" />
      </div>
      {error && (
        <p role="alert" className="py-3 text-danger">
          {error}
        </p>
      )}
      <QueryState pending={q.isPending} error={q.error}>
        <div className="overflow-x-auto">
          <table className="poster-table w-full min-w-[620px]">
            <thead>
              <tr>
                <th>Имя</th>
                <th>Телефон</th>
                <th>Адрес</th>
                <th>Комментарий</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((supplier) => (
                <tr key={supplier.id}>
                  <td>
                    <button
                      type="button"
                      className="text-left text-primary"
                      onClick={() => openEditor({ type: 'supplier', id: supplier.id })}
                    >
                      {supplier.name}
                    </button>
                  </td>
                  <td>{supplier.phone || '—'}</td>
                  <td>{supplier.address || '—'}</td>
                  <td>{supplier.note || '—'}</td>
                  <td>
                    <DirectoryActions
                      label={supplier.name}
                      onEdit={() => openEditor({ type: 'supplier', id: supplier.id })}
                      onArchive={() => void archive(supplier)}
                      pending={mutations.archive.isPending}
                    />
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-text-muted">
                    {search ? 'Поставщики не найдены' : 'Здесь будут ваши поставщики'}
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
function SupplierForm({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
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
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    try {
      await save.mutateAsync({ id: supplier?.id, ...form });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  return (
    <EditorPage
      open
      onClose={onClose}
      title={supplier ? 'Редактирование поставщика' : 'Новый поставщик'}
      panelClassName="max-w-3xl"
    >
      <form id={formId} className="poster-form poster-form--directory" onSubmit={submit}>
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
        <DocumentFooter>
          <button
            type="submit"
            form={formId}
            className="btn-primary btn-md"
            disabled={save.isPending || !form.name.trim()}
          >
            Сохранить
          </button>
          <button type="button" className="btn-ghost btn-md" onClick={onClose}>
            Отмена
          </button>
        </DocumentFooter>
      </form>
    </EditorPage>
  );
}

export function LocationsPage({ data }: { data: WarehouseLocations }) {
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [search, setSearch] = usePageFilter('search');
  const [error, setError] = useState('');
  const { setRoute } = useWarehouseLocationMutations();
  const rows = data.locations.filter((item) =>
    item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  async function assign(stationId: string, warehouseId: string) {
    try {
      await setRoute.mutateAsync({ stationId, warehouseId: warehouseId || null });
    } catch (failure) {
      setError(apiError(failure));
    }
  }
  if (editor?.type === 'location') {
    const location = data.locations.find((item) => item.id === editor.id);
    if (editor.id && !location)
      return (
        <MissingDirectoryItem onClose={closeEditor} title="Склад недоступен">
          <p className="text-sm text-text-secondary">Склад не найден. Вернитесь к списку складов.</p>
        </MissingDirectoryItem>
      );
    return <LocationForm key={editor.id ?? 'new'} location={location} onClose={closeEditor} />;
  }
  return (
    <div>
      <WorkspaceHeaderCount count={data.locations.length} />
      <WorkspaceHeaderActions>
        <button className="btn-primary btn-md" onClick={() => openEditor({ type: 'location' })}>
          Добавить
        </button>
      </WorkspaceHeaderActions>
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск склада" value={search} onChange={setSearch} />
      </div>
      <table className="poster-table w-full">
        <thead>
          <tr>
            <th className="w-16">№</th>
            <th>Название</th>
            <th>Адрес</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((location) => (
            <tr key={location.id}>
              <td>{data.locations.findIndex((item) => item.id === location.id) + 1}</td>
              <td>
                <button
                  type="button"
                  className="text-primary"
                  onClick={() => openEditor({ type: 'location', id: location.id })}
                >
                  {location.name}
                </button>
                {location.isDefault && <span className="ml-2 text-xs text-text-muted">По умолчанию</span>}
              </td>
              <td>{location.address || '—'}</td>
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
              <td colSpan={4} className="py-10 text-center text-text-muted">
                Склады не найдены
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <details className="poster-advanced mt-6">
        <summary>Склады для цехов</summary>
        <div className="poster-form poster-form--directory space-y-4 pt-5">
          {data.stationRoutes.map((station) => (
            <DocumentField key={station.stationId} label={station.stationName}>
              <Select
                ariaLabel={`Склад станции ${station.stationName}`}
                className="h-10 w-full"
                value={station.warehouseId ?? ''}
                disabled={setRoute.isPending}
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
    </div>
  );
}
function LocationForm({ location, onClose }: { location?: WarehouseLocation; onClose: () => void }) {
  const formId = useId();
  const [name, setName] = useState(location?.name ?? '');
  const [address, setAddress] = useState(location?.address ?? '');
  const [error, setError] = useState('');
  const { save } = useWarehouseLocationMutations();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    try {
      await save.mutateAsync({ id: location?.id, name, address });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  return (
    <EditorPage
      open
      onClose={onClose}
      title={location ? 'Редактирование склада' : 'Новый склад'}
      panelClassName="max-w-3xl"
    >
      <form id={formId} className="poster-form poster-form--directory" onSubmit={submit}>
        <DocumentField label="Название">
          <input className="input w-full" required value={name} onChange={(e) => setName(e.target.value)} />
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
        <DocumentFooter>
          <button
            type="submit"
            form={formId}
            className="btn-primary btn-md"
            disabled={save.isPending || !name.trim()}
          >
            Сохранить
          </button>
          <button className="btn-ghost btn-md" type="button" onClick={onClose}>
            Отмена
          </button>
        </DocumentFooter>
      </form>
    </EditorPage>
  );
}

export function PackagesPage() {
  const q = usePackages();
  const mutations = usePackageMutations();
  const [search, setSearch] = usePageFilter('search');
  const [unit, setUnit] = usePageFilter('unit');
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [error, setError] = useState('');
  const rows = (q.data ?? []).filter(
    (item) =>
      (!unit || item.unit === unit) && item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
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
    <div>
      <WorkspaceHeaderCount count={q.data?.length} />
      <WorkspaceHeaderActions>
        <button className="btn-primary btn-md" onClick={() => openEditor({ type: 'package' })}>
          Добавить
        </button>
      </WorkspaceHeaderActions>
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск фасовок" value={search} onChange={setSearch} />
        <Select
          ariaLabel="Единица фасовки"
          className="poster-filter w-44"
          value={unit}
          onChange={setUnit}
          options={[{ value: '', label: 'Ед. измерения' }, ...UNIT_OPTIONS]}
        />
      </div>
      {error && (
        <p role="alert" className="py-3 text-danger">
          {error}
        </p>
      )}
      <QueryState pending={q.isPending} error={q.error}>
        <table className="poster-table w-full">
          <thead>
            <tr>
              <th>Название</th>
              <th>Ед. измерения</th>
              <th>Количество</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id}>
                <td>
                  <button
                    className="text-left text-primary"
                    onClick={() => openEditor({ type: 'package', id: item.id })}
                  >
                    {item.name}
                  </button>
                </td>
                <td>{unitLabel(item.unit)}</td>
                <td>{item.quantity}</td>
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
                <td colSpan={4} className="py-12 text-center">
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
      </QueryState>
    </div>
  );
}
function PackageForm({ item, onClose }: { item?: PackageUnit; onClose: () => void }) {
  const formId = useId();
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState<UnitCode>(item?.unit ?? 'kg');
  const [quantity, setQuantity] = useState(item?.quantity ? String(item.quantity) : '');
  const [error, setError] = useState('');
  const { save } = usePackageMutations();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    try {
      await save.mutateAsync({ id: item?.id, name, unit, quantity: Number(quantity) });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  return (
    <EditorPage
      open
      onClose={onClose}
      title={item ? 'Редактирование фасовки' : 'Новая фасовка'}
      panelClassName="max-w-3xl"
    >
      <form id={formId} className="poster-form poster-form--directory" onSubmit={submit}>
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
            className="input w-[220px]"
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
        <DocumentFooter>
          <button
            type="submit"
            form={formId}
            className="btn-primary btn-md"
            disabled={save.isPending || !name.trim() || !(Number(quantity) > 0)}
          >
            Сохранить
          </button>
          <button className="btn-ghost btn-md" type="button" onClick={onClose}>
            Отмена
          </button>
        </DocumentFooter>
      </form>
    </EditorPage>
  );
}
