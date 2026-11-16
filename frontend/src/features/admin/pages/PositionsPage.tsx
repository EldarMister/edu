import { useId, useState, type FormEvent } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { ACTION_KEYS, ACTION_LABELS, getDefaultPermissionsByRole, resolvePermissions, SECTION_KEYS, SECTION_LABELS } from '@/lib/permissions';
import { IconEdit, IconTrash } from '../components/icons';
import { WorkspaceSearch } from './WorkspaceSearch';
import { WorkspaceHeaderCount } from './WorkspaceHeader';
import { EditorPage } from './warehouse/EditorPage';
import { DocumentField, QueryState } from './warehouse/WarehouseUi';
import { useEditorRoute, usePageFilter } from './warehouse/workspace-route';
import { POSITION_ROLES, useStaffPositionMutations, useStaffPositions, type PositionRole, type PositionSalary, type StaffPosition } from './positions-api';
import { parseMoney } from './finance/finance-format';
import type { ActionKey, Role } from '@/types';

const systemRoles = [{ value: 'OWNER', label: 'Владелец' }, ...POSITION_ROLES] as const;
const roleDefault = 'role-default';
const roleDots: Record<Role, string> = {
  OWNER: 'bg-success', ADMIN: 'bg-primary/70', WAITER: 'bg-primary', KITCHEN: 'bg-success/75', BAR: 'bg-warning',
};

function rightsSummary(role: Role, savedPermissions?: unknown) {
  const permissions = resolvePermissions(role, savedPermissions);
  if (role === 'OWNER') return 'Полный доступ';
  if (role === 'WAITER') return permissions.actions.financeCashShifts ? 'Работа с кассой, кассовые смены' : 'Работа с кассой';
  if (role === 'KITCHEN') return 'Заказы кухни';
  if (role === 'BAR') return 'Заказы бара';
  const sections = SECTION_KEYS.filter((key) => permissions.sections[key]).map((key) => SECTION_LABELS[key]);
  return sections.join(', ') || 'Без доступа к разделам';
}

export function PositionsPage() {
  const { isOwner } = usePermissions();
  const query = useStaffPositions(isOwner);
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [search, setSearch] = usePageFilter('search');
  const [roleFilter, setRoleFilter] = usePageFilter('role');
  const [sortDirection, setSortDirection] = usePageFilter('sort', 'asc');
  const [removePosition, setRemovePosition] = useState<StaffPosition | null>(null);
  const [replacementId, setReplacementId] = useState('');
  const { remove } = useStaffPositionMutations();
  const replacementOptions = removePosition ? [
    { value: roleDefault, label: (systemRoles.find(({ value }) => value === removePosition.role)?.label ?? '') + ' (стандартная)' },
    ...(query.data ?? []).filter(({ id, role }) => id !== removePosition.id && role === removePosition.role)
      .map(({ id, name }) => ({ value: id, label: name })),
  ] : [];
  const term = search.trim().toLocaleLowerCase('ru');
  const rows = [
    ...systemRoles.map(({ value, label }) => ({ id: 'system:' + value, name: label, role: value, access: rightsSummary(value), position: null })),
    ...(query.data ?? []).map((position) => ({ ...position, access: rightsSummary(position.role, position.permissions), position })),
  ].filter((row) => row.name.toLocaleLowerCase('ru').includes(term) && (!roleFilter || row.role === roleFilter))
    .sort((a, b) => (sortDirection === 'desc' ? -1 : 1) * a.name.localeCompare(b.name, 'ru'));
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
  return <div className="min-w-0 overflow-hidden rounded-t-2xl bg-card text-sm">
    <WorkspaceHeaderCount count={query.isSuccess ? rows.length : undefined} />
    <div className="flex flex-wrap items-center gap-2 p-4">
      <WorkspaceSearch className="[&_.input]:h-9 [&_.input]:rounded-full [&_.input]:pl-8 [&_.input]:pr-8"
        label="Поиск должностей" placeholder="Поиск..." value={search} onChange={setSearch} />
      <Select ariaLabel="Фильтр должностей" className="h-9 !rounded-md !px-2 !text-sm" value={roleFilter} onChange={setRoleFilter}
        options={[{ value: '', label: '+ Фильтр' }, ...systemRoles.map(({ value, label }) => ({ value, label }))]} />
      <button type="button" className="btn-primary btn-md ml-auto" aria-label="Добавить должность"
        onClick={() => openEditor({ type: 'position' })}>Добавить</button>
    </div>
    <QueryState pending={query.isPending} error={query.error}>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead><tr className="border-b border-border text-text-muted">
            <th scope="col" className="w-[42%] px-3 py-3 font-normal" aria-sort={sortDirection === 'desc' ? 'descending' : 'ascending'}>
              <button type="button" className="text-left" onClick={() => setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc')}>
                Название должности <span aria-hidden>{sortDirection === 'desc' ? '↓' : '↑'}</span>
              </button>
            </th>
            <th scope="col" className="px-3 py-3 font-normal">Права доступа</th>
            <th scope="col" className="px-3 py-3 text-right font-normal">Действия</th>
          </tr></thead>
          <tbody>{rows.map(({ id, name, role, access, position }) => <tr className="h-12 border-b border-border hover:bg-background/60" key={id}>
            <td className="px-3 py-2"><div className="flex items-center gap-2">
              <span aria-hidden className={'h-2 w-2 shrink-0 rounded-full ' + roleDots[role]} />
              {position ? <button type="button" className="text-left" onClick={() => openEditor({ type: 'position', id })}>{name}</button> : name}
            </div></td>
            <td className="px-3 py-2">{access}</td>
            <td className="w-24 px-3 py-2 text-right">{position ? <div className="flex items-center justify-end gap-1">
              <button type="button" title="Редактировать" aria-label={`Редактировать должность ${name}`}
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-background hover:text-primary"
                onClick={() => openEditor({ type: 'position', id })}>
                <IconEdit className="h-4 w-4" />
              </button>
              <button type="button" title="Удалить" aria-label={`Удалить должность ${name}`}
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                onClick={() => {
                  remove.reset();
                  setReplacementId('');
                  setRemovePosition(position);
                }}>
                <IconTrash className="h-4 w-4" />
              </button>
            </div> : <span className="text-xs text-text-muted">Системная</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {!rows.length && <p role="status" className="p-8 text-center text-text-muted">Должности не найдены</p>}
    </QueryState>
    {removePosition && <Modal open title="Удалить должность?" onClose={() => { if (!remove.isPending) setRemovePosition(null); }}
      footer={<button type="button" className="btn-danger btn-md" disabled={remove.isPending || (removePosition.employees > 0 && !replacementId)}
        onClick={() => remove.mutate({
          id: removePosition.id, replacementPositionId: replacementId === roleDefault ? null : replacementId || undefined,
        }, { onSuccess: () => setRemovePosition(null) })}>Удалить</button>}>
      <p>Должность «{removePosition.name}» будет удалена.</p>
      {removePosition.employees > 0 && <div className="mt-4 space-y-2">
        <p className="text-sm">Выберите новую должность для сотрудников ({removePosition.employees}).</p>
        <Select ariaLabel="Новая должность" className="w-full" value={replacementId} placeholder="Выберите должность"
          onChange={setReplacementId} options={replacementOptions} disabled={remove.isPending} />
      </div>}
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
  const [permissions, setPermissions] = useState(() => resolvePermissions(role, position?.permissions));
  const [rates, setRates] = useState(() => Object.fromEntries(payFields.map(({ key }) =>
    [key, position?.salary?.[key] ? String(position.salary[key]) : ''])) as Record<keyof PositionSalary, string>);
  const { save } = useStaffPositionMutations();
  const parsed = payFields.map(({ key, percent }) => {
    const value = rates[key].trim() ? parseMoney(rates[key]) : 0;
    return [key, value !== null && value >= 0 && (!percent || value <= 100) ? value : null] as const;
  });
  const validSalary = parsed.every(([, value]) => value !== null);
  const registerActions: ActionKey[] = role === 'ADMIN' ? ['closeShift', 'financeCashShifts']
    : role === 'WAITER' ? ['financeCashShifts'] : [];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !validSalary || save.isPending) return;
    const salary = Object.fromEntries(parsed) as PositionSalary;
    save.mutate({ id: position?.id, name: name.trim(), role, permissions, salary }, { onSuccess: onClose });
  }

  function actionControl(key: ActionKey) {
    return <label className="flex items-start gap-2 py-1 text-sm" key={key}>
      <input type="checkbox" className="mt-0.5" checked={permissions.actions[key]} onChange={({ target }) => {
        const checked = target.checked;
        setPermissions((current) => ({ ...current, actions: { ...current.actions, [key]: checked } }));
      }} />
      {ACTION_LABELS[key]}
    </label>;
  }

  return <EditorPage title={position ? 'Редактирование должности' : 'Добавление должности'} onClose={onClose}
    footer={<button form={formId} type="submit" className="btn-primary btn-md" disabled={save.isPending || !name.trim() || !validSalary}>Сохранить</button>}>
    <form id={formId} className="max-w-[760px] space-y-6 px-4 py-3 sm:px-6" onSubmit={submit}>
      <DocumentField label="Название должности">
        <input maxLength={80} required className="input w-full" value={name} disabled={save.isPending}
          onChange={({ target }) => setName(target.value)} />
      </DocumentField>
      <DocumentField label="Базовая роль">
        <Select ariaLabel="Базовая роль" className="h-10 w-full" value={role} options={POSITION_ROLES} disabled={!!position || save.isPending}
          onChange={(value) => {
            const next = POSITION_ROLES.find((option) => option.value === value)?.value;
            if (next) { setRole(next); setPermissions(getDefaultPermissionsByRole(next)); }
          }} />
      </DocumentField>
      {registerActions.length > 0 && <fieldset disabled={save.isPending} className="space-y-3">
        <legend className="w-full border-b border-border pb-2 text-lg font-semibold">Доступ к кассе</legend>
        {registerActions.map(actionControl)}
      </fieldset>}
      {role === 'ADMIN' && <fieldset disabled={save.isPending} className="space-y-3">
        <legend className="w-full border-b border-border pb-2 text-lg font-semibold">Доступ к админ-панели</legend>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border text-text-muted">
            <th scope="col" className="py-2 text-left font-normal">Разделы</th>
            <th scope="col" className="w-[25%] px-1 py-2 font-normal">Без доступа</th>
            <th scope="col" className="w-[25%] px-1 py-2 font-normal">Доступ</th>
          </tr></thead>
          <tbody>{SECTION_KEYS.map((key) => <tr key={key} className="border-b border-border">
            <th scope="row" className="py-2 text-left font-normal">{SECTION_LABELS[key]}</th>
            {[false, true].map((allowed) => <td key={String(allowed)} className="text-center">
              <input type="radio" name={formId + key} aria-label={(allowed ? 'Доступ' : 'Без доступа') + ' · ' + SECTION_LABELS[key]}
                checked={permissions.sections[key] === allowed} onChange={() => setPermissions((current) => ({
                  ...current, sections: { ...current.sections, [key]: allowed },
                }))} />
            </td>)}
          </tr>)}</tbody>
        </table>
        <details className="py-1">
          <summary className="cursor-pointer text-sm text-primary">Дополнительные права</summary>
          <div className="mt-2 grid gap-x-3 sm:grid-cols-2">
            {ACTION_KEYS.filter((key) => !registerActions.includes(key)).map(actionControl)}
          </div>
        </details>
      </fieldset>}
      <fieldset disabled={save.isPending} className="space-y-3">
        <legend className="w-full border-b border-border pb-2 text-lg font-semibold">Расчёт зарплаты</legend>
        <p className="pt-2 text-sm font-medium">Фиксированная ставка</p>
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
