import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { apiError } from '@/lib/api';
import { useSuppliers, useSupplierMutations, type Supplier } from './settings-api';
import { useWarehouseLocationMutations, type WarehouseLocations, type WarehouseLocation } from './api';
import { usePackages, usePackageMutations, type PackageUnit } from './extended-api';
import { UNIT_OPTIONS, unitLabel, type UnitCode } from './units';
import { DocumentField, DocumentFooter, QueryState } from './WarehouseUi';

export function SuppliersPage() {
  const q = useSuppliers();
  const mutations = useSupplierMutations();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [error, setError] = useState('');
  const rows = (q.data ?? []).filter((s) =>
    `${s.name} ${s.phone ?? ''} ${s.address ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  async function archive(s: Supplier) {
    if (!confirm(`Архивировать поставщика «${s.name}»? История поставок сохранится.`)) return;
    try {
      await mutations.archive.mutateAsync(s.id);
    } catch (e) {
      setError(apiError(e));
    }
  }
  return (
    <>
      <div className="card overflow-hidden">
        <div className="flex gap-2 border-b border-border p-4">
          <input
            className="input h-10 flex-1 sm:max-w-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск поставщика"
            aria-label="Поиск поставщика"
          />
          <button className="btn-primary btn-md ml-auto" onClick={() => setEditing('new')}>
            + Добавить
          </button>
        </div>
        {error && (
          <p role="alert" className="p-4 text-danger">
            {error}
          </p>
        )}
        <QueryState pending={q.isPending} error={q.error} empty={q.isSuccess && !rows.length}>
          <div className="hidden grid-cols-[1fr_150px_1fr_1fr_110px] gap-3 border-b border-border bg-background/50 px-4 py-3 text-xs text-text-muted lg:grid">
            <span>Имя</span>
            <span>Телефон</span>
            <span>Адрес</span>
            <span>Комментарий</span>
            <span />
          </div>
          {rows.map((s) => (
            <div
              className="grid gap-2 border-b border-border p-4 text-sm last:border-0 lg:grid-cols-[1fr_150px_1fr_1fr_110px] lg:gap-3"
              key={s.id}
            >
              <button className="text-left font-medium text-primary" onClick={() => setEditing(s)}>
                {s.name}
              </button>
              <span className="text-text-secondary">{s.phone || '—'}</span>
              <span>{s.address || '—'}</span>
              <span>{s.note || '—'}</span>
              <div className="flex gap-3">
                <button className="text-primary" onClick={() => setEditing(s)}>
                  Ред.
                </button>
                <button
                  className="text-text-muted"
                  disabled={mutations.archive.isPending}
                  onClick={() => void archive(s)}
                >
                  В архив
                </button>
              </div>
            </div>
          ))}
        </QueryState>
      </div>
      {editing && (
        <SupplierForm supplier={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
function SupplierForm({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
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
    <Modal
      open
      onClose={onClose}
      title={supplier ? 'Редактирование поставщика' : 'Новый поставщик'}
      panelClassName="max-w-3xl"
    >
      <form className="space-y-4" onSubmit={submit}>
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
                className="input h-20 py-2"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            ) : (
              <input
                className="input"
                required={key === 'name'}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            )}
          </DocumentField>
        ))}
        <details className="text-sm">
          <summary className="cursor-pointer text-primary">Дополнительно</summary>
          <div className="pt-3">
            <DocumentField label="Электронная почта">
              <input
                className="input"
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
          <button className="btn-primary btn-md" disabled={save.isPending || !form.name.trim()}>
            Сохранить
          </button>
          <button type="button" className="btn-ghost btn-md" onClick={onClose}>
            Отмена
          </button>
        </DocumentFooter>
      </form>
    </Modal>
  );
}

export function LocationsPage({ data }: { data: WarehouseLocations }) {
  const [editing, setEditing] = useState<WarehouseLocation | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const { setRoute } = useWarehouseLocationMutations();
  async function assign(stationId: string, warehouseId: string) {
    try {
      await setRoute.mutateAsync({ stationId, warehouseId: warehouseId || null });
    } catch (e) {
      setError(apiError(e));
    }
  }
  return (
    <>
      <div className="card overflow-hidden">
        <div className="flex gap-2 border-b border-border p-4">
          <input
            className="input h-10 flex-1 sm:max-w-xs"
            aria-label="Поиск склада"
            placeholder="Поиск склада"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn-primary btn-md ml-auto" onClick={() => setEditing('new')}>
            + Добавить
          </button>
        </div>
        {data.locations
          .filter((l) => l.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
          .map((l) => (
            <div
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 text-sm last:border-0"
              key={l.id}
            >
              <span className="min-w-40 flex-1">
                <span className="font-medium">{l.name}</span>
                {l.isDefault && <span className="ml-2 text-xs text-text-muted">По умолчанию</span>}
              </span>
              <span className="flex-1 text-text-secondary">{l.address || 'Адрес не указан'}</span>
              <button className="text-primary" onClick={() => setEditing(l)}>
                Редактировать
              </button>
            </div>
          ))}
      </div>
      <details className="card mt-4 p-4">
        <summary className="cursor-pointer text-sm font-medium text-primary">
          Склады для станций кухни и бара
        </summary>
        <div className="mt-4 space-y-3">
          {data.stationRoutes.map((s) => (
            <DocumentField key={s.stationId} label={s.stationName}>
              <Select
                ariaLabel={`Склад станции ${s.stationName}`}
                className="h-11 w-full"
                value={s.warehouseId ?? ''}
                disabled={setRoute.isPending}
                onChange={(v) => void assign(s.stationId, v)}
                options={[
                  { value: '', label: 'Склад по умолчанию' },
                  ...data.locations.map((l) => ({ value: l.id, label: l.name })),
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
      {editing && (
        <LocationForm location={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
function LocationForm({ location, onClose }: { location?: WarehouseLocation; onClose: () => void }) {
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
    <Modal
      open
      onClose={onClose}
      title={location ? 'Редактирование склада' : 'Новый склад'}
      panelClassName="max-w-3xl"
    >
      <form className="space-y-4" onSubmit={submit}>
        <DocumentField label="Название">
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </DocumentField>
        <DocumentField label="Адрес">
          <textarea
            className="input h-20 py-2"
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
          <button className="btn-primary btn-md" disabled={save.isPending || !name.trim()}>
            Сохранить
          </button>
          <button className="btn-ghost btn-md" type="button" onClick={onClose}>
            Отмена
          </button>
        </DocumentFooter>
      </form>
    </Modal>
  );
}

export function PackagesPage() {
  const q = usePackages();
  const mutations = usePackageMutations();
  const [search, setSearch] = useState('');
  const [unit, setUnit] = useState('');
  const [editing, setEditing] = useState<PackageUnit | 'new' | null>(null);
  const [error, setError] = useState('');
  const rows = (q.data ?? []).filter(
    (p) => (!unit || p.unit === unit) && p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  async function archive(p: PackageUnit) {
    if (!confirm(`Архивировать фасовку «${p.name}»? Сохранённые поставки не изменятся.`)) return;
    try {
      await mutations.archive.mutateAsync(p.id);
    } catch (e) {
      setError(apiError(e));
    }
  }
  return (
    <>
      <div className="card overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-border p-4">
          <input
            className="input h-10 min-w-40 flex-1 sm:max-w-xs"
            aria-label="Поиск фасовок"
            placeholder="Поиск фасовок"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            ariaLabel="Единица фасовки"
            className="h-10 min-w-36"
            value={unit}
            onChange={setUnit}
            options={[{ value: '', label: 'Все единицы' }, ...UNIT_OPTIONS]}
          />
          <button className="btn-primary btn-md ml-auto" onClick={() => setEditing('new')}>
            + Добавить
          </button>
        </div>
        {error && (
          <p role="alert" className="p-4 text-danger">
            {error}
          </p>
        )}
        <QueryState pending={q.isPending} error={q.error} empty={q.isSuccess && !rows.length}>
          <div className="hidden grid-cols-[1fr_150px_150px_120px] gap-3 border-b border-border bg-background/50 p-4 text-xs text-text-muted sm:grid">
            <span>Название</span>
            <span>Ед. измерения</span>
            <span>Количество</span>
            <span />
          </div>
          {rows.map((p) => (
            <div
              key={p.id}
              className="grid gap-2 border-b border-border p-4 text-sm last:border-0 sm:grid-cols-[1fr_150px_150px_120px]"
            >
              <button className="text-left font-medium text-primary" onClick={() => setEditing(p)}>
                {p.name}
              </button>
              <span>{unitLabel(p.unit)}</span>
              <span>{p.quantity}</span>
              <div className="flex gap-3">
                <button className="text-primary" onClick={() => setEditing(p)}>
                  Ред.
                </button>
                <button
                  className="text-text-muted"
                  disabled={mutations.archive.isPending}
                  onClick={() => void archive(p)}
                >
                  В архив
                </button>
              </div>
            </div>
          ))}
        </QueryState>
      </div>
      {editing && (
        <PackageForm item={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
function PackageForm({ item, onClose }: { item?: PackageUnit; onClose: () => void }) {
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
    <Modal
      open
      onClose={onClose}
      title={item ? 'Редактирование фасовки' : 'Новая фасовка'}
      panelClassName="max-w-3xl"
    >
      <form className="space-y-4" onSubmit={submit}>
        <DocumentField label="Название">
          <input
            className="input"
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
            className="input"
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
    </Modal>
  );
}
