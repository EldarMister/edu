import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { apiError } from '@/lib/api';
import { useWarehouseLocationMutations, type WarehouseLocation, type WarehouseLocations } from './api';

export function WarehouseLocationsModal({ data, onClose }: { data: WarehouseLocations; onClose: () => void }) {
  const { save, setRoute } = useWarehouseLocationMutations();
  const [editing, setEditing] = useState<WarehouseLocation | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const pending = save.isPending || setRoute.isPending;
  const defaultWarehouse = data.locations.find((location) => location.isDefault);
  const routeOptions = [
    { value: '', label: defaultWarehouse ? `${defaultWarehouse.name} (по умолчанию)` : 'Общий склад' },
    ...data.locations.filter((location) => !location.isDefault).map(({ id, name }) => ({ value: id, label: name })),
  ];

  function edit(location: WarehouseLocation | null) {
    setEditing(location);
    setName(location?.name ?? '');
    setError('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !name.trim()) return;
    setError('');
    try {
      await save.mutateAsync({ id: editing?.id, name: name.trim() });
      edit(null);
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function assign(stationId: string, warehouseId: string) {
    setError('');
    try {
      await setRoute.mutateAsync({ stationId, warehouseId: warehouseId || null });
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <Modal open onClose={onClose} title="Склады и станции" panelClassName="max-w-lg">
      <div className="space-y-4">
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
          <label className="min-w-40 flex-1 text-sm text-text-secondary">
            Название склада
            <input className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
          </label>
          <button type="submit" className="btn-primary btn-md" disabled={pending || !name.trim()}>
            {editing ? 'Сохранить' : 'Добавить склад'}
          </button>
          {editing && <button type="button" className="btn-secondary btn-md" disabled={pending} onClick={() => edit(null)}>Отмена</button>}
        </form>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <ul className="divide-y divide-border">
          {data.locations.map((location) => (
            <li key={location.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 break-words font-medium text-text-primary">
                {location.name}
                {location.isDefault && <span className="ml-2 font-normal text-text-muted">По умолчанию</span>}
              </span>
              <button type="button" className="btn-secondary btn-md" disabled={pending} onClick={() => edit(location)}>Изменить</button>
            </li>
          ))}
        </ul>
        {data.stationRoutes.length > 0 && (
          <div className="border-t border-border pt-3">
            <h4 className="mb-2 text-sm font-semibold text-text-primary">Откуда списывать сырьё для станций</h4>
            <ul className="space-y-2">
              {data.stationRoutes.map((station) => (
                <li key={station.stationId} className="grid grid-cols-2 items-center gap-2 text-sm">
                  <span className="break-words text-text-secondary">{station.stationName}</span>
                  <Select
                    ariaLabel={`Склад станции ${station.stationName}`}
                    className="h-10 w-full"
                    value={station.warehouseId === defaultWarehouse?.id ? '' : station.warehouseId ?? ''}
                    options={routeOptions}
                    disabled={pending}
                    onChange={(warehouseId) => void assign(station.stationId, warehouseId)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
