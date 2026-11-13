import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/Modal';
import { apiError } from '@/lib/api';
import { useSavePreparationStation, type PreparationStation } from '@/features/kitchen/stations';

export function PreparationStationsModal({ stations, onClose }: {
  stations: PreparationStation[];
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string>();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const save = useSavePreparationStation();

  function edit(station?: PreparationStation) {
    setEditingId(station?.id);
    setName(station?.name ?? '');
    setError('');
  }

  async function update(patch: Parameters<typeof save.mutateAsync>[0]) {
    setError('');
    try {
      await save.mutateAsync(patch);
      edit();
    } catch (err) {
      setError(apiError(err));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() && !save.isPending) void update({ id: editingId, name: name.trim() });
  }

  return (
    <Modal open onClose={onClose} title="Станции приготовления">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="min-w-36 flex-1 text-sm text-text-secondary">
          Название станции
          <input className="input mt-1 w-full" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button className="btn-primary btn-md" type="submit" disabled={!name.trim() || save.isPending}>
          {editingId ? 'Сохранить' : 'Добавить'}
        </button>
        {editingId && <button type="button" className="btn-secondary btn-md" onClick={() => edit()}>Отмена</button>}
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <ul className="mt-4 divide-y divide-border">
        {stations.map((station) => (
          <li key={station.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
            <span className="min-w-24 flex-1 break-words font-medium">{station.name}</span>
            {!station.isActive && <span className="text-text-muted">В архиве</span>}
            {!station.isBuiltIn && <>
              <button type="button" className="btn-secondary btn-md" disabled={save.isPending} onClick={() => edit(station)}>Изменить</button>
              <button type="button" className="btn-secondary btn-md" disabled={save.isPending}
                onClick={() => void update({ id: station.id, isActive: !station.isActive })}>
                {station.isActive ? 'В архив' : 'Восстановить'}
              </button>
            </>}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
