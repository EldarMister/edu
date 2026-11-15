import { useId, useState, type FormEvent } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { ACTION_KEYS, ACTION_LABELS, getDefaultPermissionsByRole, SECTION_KEYS, SECTION_LABELS } from '@/lib/permissions';
import { WorkspaceSearch } from './WorkspaceSearch';
import { WorkspaceHeaderCount } from './WorkspaceHeader';
import { EditorPage } from './warehouse/EditorPage';
import { DocumentField, QueryState } from './warehouse/WarehouseUi';
import { useEditorRoute, usePageFilter } from './warehouse/workspace-route';
import { POSITION_ROLES, useStaffPositionMutations, useStaffPositions, type PositionRole, type PositionSalary, type StaffPosition } from './positions-api';
import { parseMoney } from './finance/finance-format';

export function PositionsPage() {
  const { isOwner } = usePermissions();
  const query = useStaffPositions(isOwner);
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [search, setSearch] = usePageFilter('search');
  const [removePosition, setRemovePosition] = useState<StaffPosition | null>(null);
  const { remove } = useStaffPositionMutations();
  const term = search.trim().toLocaleLowerCase('ru');
  const rows = (query.data ?? []).filter(({ name }) => name.toLocaleLowerCase('ru').includes(term));
  if (!isOwner) return <p role="alert">Должностями управляет владелец заведения.</p>;
  if (editor?.type === 'position') {
    if (editor.id) {
      const entry = query.data?.find(({ id }) => id === editor.id);
      if (!entry) return <EditorPage title="Должность" onClose={closeEditor}>
        <QueryState pending={query.isPending} error={query.error}>
          <p>Должность по этой ссылке не найдена.</p>
        </QueryState>
      </EditorPage>;
      return <PositionEditor key={entry.id} position={entry} onClose={closeEditor} />;
    }
    return <PositionEditor key="new" onClose={closeEditor} />;
  }
  return <div className="card min-w-0 overflow-hidden">
    <WorkspaceHeaderCount count={query.isSuccess ? rows.length : undefined} />
    <div className="poster-toolbar flex flex-wrap items-center gap-3 p-4">
      <WorkspaceSearch className="[&_.input]:pl-8 [&_.input]:pr-8" label="Поиск должностей" value={search} onChange={setSearch} />
      <button type="button" className="btn-primary btn-md ml-auto" onClick={() => openEditor({ type: 'position' })}>Добавить должность</button>
    </div>
    <QueryState pending={query.isPending} error={query.error}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[440px] text-left text-sm">
          <thead><tr className="border-b border-border text-text-muted">
            <th scope="col" className="px-4 py-3 font-medium">Название</th>
            <th scope="col" className="px-4 py-3 font-medium">Базовая роль</th>
            <th scope="col" className="px-4 py-3 font-medium">Сотрудники</th>
            <th scope="col"><span className="sr-only">Действия</span></th>
          </tr></thead>
          <tbody>{rows.map((position) => <tr className="border-b border-border last:border-0" key={position.id}>
            <td className="px-4 py-3"><button type="button" className="text-primary" onClick={() => openEditor({ type: 'position', id: position.id })}>{position.name}</button></td>
            <td className="px-4 py-3">{POSITION_ROLES.find(({ value }) => value === position.role)?.label}</td>
            <td className="px-4 py-3 tabular-nums">{position.employees}</td>
            <td className="px-4 py-3"><div className="flex justify-end gap-4">
              <button type="button" className="text-primary" aria-label={`Редактировать должность ${position.name}`}
                onClick={() => openEditor({ type: 'position', id: position.id })}>Ред.</button>
              <button type="button" className="text-danger disabled:text-text-muted" disabled={position.employees > 0}
                title={position.employees > 0 ? 'Сначала назначьте сотрудникам другую должность' : undefined}
                onClick={() => { remove.reset(); setRemovePosition(position); }}>Удалить</button>
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>
      {!rows.length && <p role="status" className="p-8 text-center text-text-muted">{term ? 'Должности не найдены' : 'Дополнительных должностей пока нет'}</p>}
    </QueryState>
    {removePosition && <Modal open title="Удалить должность?" onClose={() => { if (!remove.isPending) setRemovePosition(null); }}
      footer={<button type="button" className="btn-danger btn-md" disabled={remove.isPending}
        onClick={() => remove.mutate(removePosition.id, { onSuccess: () => setRemovePosition(null) })}>Удалить</button>}>
      <p>Должность «{removePosition.name}» будет удалена.</p>
      {remove.error && <p role="alert" className="mt-2 text-danger">{apiError(remove.error)}</p>}
    </Modal>}
  </div>;
}

const payFields: { key: keyof PositionSalary; label: string; percent?: boolean }[] = [
  { key: 'hourly', label: 'За час, с' },
  { key: 'perShift', label: 'За смену, с' },
  { key: 'monthly', label: 'За месяц, с' },
  { key: 'personalPercent', label: 'Процент от личных продаж', percent: true },
  { key: 'shiftPercent', label: 'Процент от продаж за смену', percent: true },
];

function PositionEditor({ position, onClose }: { position?: StaffPosition; onClose: () => void }) {
  const formId = useId();
  const [name, setName] = useState(position?.name ?? '');
  const [role, setRole] = useState<PositionRole>(position?.role ?? 'WAITER');
  const [permissions, setPermissions] = useState(() => position?.permissions ?? getDefaultPermissionsByRole(role));
  const [rates, setRates] = useState(() => Object.fromEntries(payFields.map(({ key }) =>
    [key, position?.salary?.[key] ? String(position.salary[key]) : ''])) as Record<keyof PositionSalary, string>);
  const { save } = useStaffPositionMutations();
  const parsed = payFields.map(({ key, percent }) => {
    const value = rates[key].trim() ? parseMoney(rates[key]) : 0;
    return [key, value !== null && value >= 0 && (!percent || value <= 100) ? value : null] as const;
  });
  const validSalary = parsed.every(([, value]) => value !== null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !validSalary || save.isPending) return;
    const salary = Object.fromEntries(parsed) as PositionSalary;
    save.mutate({ id: position?.id, name: name.trim(), role, permissions, salary }, { onSuccess: onClose });
  }

  return <EditorPage title={position ? 'Редактирование должности' : 'Новая должность'} onClose={onClose}
    footer={<button form={formId} type="submit" className="btn-primary btn-md" disabled={save.isPending || !name.trim() || !validSalary}>Сохранить</button>}>
    <form id={formId} className="max-w-4xl space-y-5 p-4" onSubmit={submit}>
      <DocumentField label="Название">
        <input aria-label="Название должности" maxLength={80} required className="input w-full" value={name} disabled={save.isPending}
          onChange={({ target }) => setName(target.value)} />
      </DocumentField>
      <DocumentField label="Базовая роль">
        <Select ariaLabel="Базовая роль" className="h-10 w-full" value={role} options={POSITION_ROLES} disabled={!!position || save.isPending}
          onChange={(value) => {
            const next = POSITION_ROLES.find((option) => option.value === value)?.value;
            if (next) { setRole(next); setPermissions(getDefaultPermissionsByRole(next)); }
          }} />
      </DocumentField>
      {role === 'ADMIN' && <fieldset disabled={save.isPending} className="space-y-3">
        <legend className="font-semibold">Разделы</legend>
        <div className="grid gap-2 sm:grid-cols-2">{SECTION_KEYS.map((key) => <label className="flex items-center gap-2" key={key}>
          <input type="checkbox" checked={permissions.sections[key]} onChange={({ target }) => {
            const checked = target.checked;
            setPermissions((current) => ({ ...current, sections: { ...current.sections, [key]: checked } }));
          }} />
          {SECTION_LABELS[key]}
        </label>)}</div>
      </fieldset>}
      {(role === 'ADMIN' || role === 'WAITER') && <fieldset disabled={save.isPending} className="space-y-3">
        <legend className="font-semibold">Действия</legend>
        <div className="grid gap-2 sm:grid-cols-2">{ACTION_KEYS.filter((key) => role === 'ADMIN' || key === 'financeCashShifts').map((key) =>
          <label className="flex items-center gap-2" key={key}>
            <input type="checkbox" checked={permissions.actions[key]} onChange={({ target }) => {
              const checked = target.checked;
              setPermissions((current) => ({ ...current, actions: { ...current.actions, [key]: checked } }));
            }} />
            {ACTION_LABELS[key]}
          </label>)}</div>
      </fieldset>}
      <fieldset disabled={save.isPending} className="space-y-3">
        <legend className="font-semibold">Расчёт зарплаты</legend>
        <div className="grid gap-3 sm:grid-cols-3">{payFields.filter(({ percent }) => !percent).map(({ key, label }) =>
          <label key={key} className="grid gap-1 text-sm text-text-secondary">{label}
            <input className="input min-w-0" inputMode="decimal" placeholder="0" value={rates[key]}
              onChange={(event) => setRates({ ...rates, [key]: event.target.value })} />
          </label>)}</div>
        <div className="grid gap-3 sm:grid-cols-2">{payFields.filter(({ percent }) => percent).map(({ key, label }) =>
          <label key={key} className="grid gap-1 text-sm text-text-secondary">{label}
            <input className="input min-w-0" inputMode="decimal" placeholder="0%" value={rates[key]}
              onChange={(event) => setRates({ ...rates, [key]: event.target.value })} />
          </label>)}</div>
        <p className="text-sm text-text-muted">Ставки действуют с текущего месяца. Часы, смены и дни для месячной ставки берутся из закрытых рабочих смен. Проценты рассчитываются по оплаченным заказам.</p>
        {!validSalary && <p className="text-sm text-danger">Укажите положительные ставки и проценты от 0 до 100.</p>}
      </fieldset>
      {save.error && <p role="alert" className="text-danger">{apiError(save.error)}</p>}
    </form>
  </EditorPage>;
}
