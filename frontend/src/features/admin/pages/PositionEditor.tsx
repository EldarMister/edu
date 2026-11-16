import { useId, useState, type FormEvent } from 'react';
import { Select } from '@/components/Select';
import { apiError } from '@/lib/api';
import { ACTION_LABELS, ACTION_KEYS, getDefaultPermissionsByRole, resolvePermissions, SECTION_KEYS, SECTION_WRITE_ACTIONS } from '@/lib/permissions';
import type { ActionKey, EmployeePermissions, SectionKey } from '@/types';
import { EditorPage, useEditorDirty } from './warehouse/EditorPage';
import { DocumentField } from './warehouse/WarehouseUi';
import { parseMoney } from './finance/finance-format';
import { SECTION_ACTIONS } from './position-permissions';
import { useStaffPositionMutations, type PositionRole, type PositionSalary, type StaffPosition } from './positions-api';

const groups: { key: string; label: string; sections: SectionKey[] }[] = [
  { key: 'statistics', label: 'Статистика', sections: ['statistics', 'orders', 'checks', 'journal'] },
  { key: 'finance', label: 'Финансы', sections: ['finance', 'paymentReconciliation'] },
  { key: 'menu', label: 'Меню', sections: ['menu'] },
  { key: 'warehouse', label: 'Склад', sections: ['warehouse'] },
  { key: 'staff', label: 'Доступ / сотрудники', sections: ['staff'] },
  { key: 'settings', label: 'Настройки / залы', sections: ['settings', 'tables'] },
];
const payFields: { key: keyof PositionSalary; label: string; percent?: boolean }[] = [
  { key: 'hourly', label: 'За час, с' }, { key: 'perShift', label: 'За смену, с' }, { key: 'monthly', label: 'За месяц, с' },
  { key: 'personalPercent', label: 'Процент от личных продаж', percent: true },
  { key: 'shiftPercent', label: 'Процент от продаж за смену', percent: true },
];

function initialPermissions(position?: StaffPosition): EmployeePermissions {
  if (position) {
    const current = resolvePermissions(position.role, position.permissions);
    // Legacy terminal sections describe the cash app, not administrative access.
    if (!current.adminAccess && position.role === 'WAITER') current.sections = getDefaultPermissionsByRole('BAR').sections;
    if (!current.adminAccess && position.role === 'WAITER') current.sections.orders = false;
    return current;
  }
  const permissions = getDefaultPermissionsByRole('ADMIN');
  permissions.terminalAccess = false;
  permissions.adminAccess = false;
  for (const key of SECTION_KEYS) permissions.sections[key] = false;
  for (const key of ACTION_KEYS) permissions.actions[key] = false;
  return permissions;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm">
    <input type="checkbox" className="h-4 w-4 accent-primary" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span>{label}</span>
  </label>;
}

export function PositionEditor({ position, onClose }: { position?: StaffPosition; onClose: () => void }) {
  const formId = useId();
  const [name, setName] = useState(position?.name ?? '');
  const [role, setRole] = useState<PositionRole>(position?.role ?? 'ADMIN');
  const [permissions, setPermissions] = useState(() => initialPermissions(position));
  const [rates, setRates] = useState(() => Object.fromEntries(payFields.map(({ key }) =>
    [key, position?.salary?.[key] ? String(position.salary[key]) : ''])) as Record<keyof PositionSalary, string>);
  const { save } = useStaffPositionMutations();
  const production = role === 'KITCHEN' || role === 'BAR';
  const hasAccess = permissions.terminalAccess || production || (permissions.adminAccess && SECTION_KEYS.some((key) => permissions.sections[key]));
  const parsed = payFields.map(({ key, percent }) => {
    const value = rates[key].trim() ? parseMoney(rates[key]) : 0;
    return [key, value !== null && value >= 0 && (!percent || value <= 100) ? value : null] as const;
  });
  const validSalary = parsed.every(([, value]) => value !== null);
  const dirty = name !== (position?.name ?? '') || role !== (position?.role ?? 'ADMIN')
    || JSON.stringify(permissions) !== JSON.stringify(initialPermissions(position))
    || payFields.some(({ key }) => rates[key] !== (position?.salary?.[key] ? String(position.salary[key]) : ''));
  const { markSaved } = useEditorDirty(dirty);
  const valid = !!name.trim() && !!hasAccess && validSalary;

  function level(sections: SectionKey[]) {
    if (sections.every((key) => !permissions.sections[key])) return 'none';
    if (!sections.every((key) => permissions.sections[key])) return 'custom';
    const writes = sections.filter((key) => key !== 'statistics' && key !== 'journal' && key !== 'paymentReconciliation');
    if (writes.every((key) => permissions.readOnlySections?.includes(key))) return 'view';
    if (sections.some((key) => permissions.readOnlySections?.includes(key))) return 'custom';
    return sections.every((key) => (SECTION_ACTIONS[key] ?? []).every((action) => permissions.actions[action])) ? 'full' : 'custom';
  }
  function setLevel(sections: SectionKey[], value: string) {
    setPermissions((current) => {
      const next = { ...current, sections: { ...current.sections }, actions: { ...current.actions },
        readOnlySections: (current.readOnlySections ?? []).filter((key) => !sections.includes(key)) };
      for (const key of sections) {
        next.sections[key] = value !== 'none';
        for (const action of SECTION_ACTIONS[key] ?? []) next.actions[action] = value !== 'none';
        if (value === 'view') {
          next.readOnlySections.push(key);
          for (const action of SECTION_WRITE_ACTIONS[key] ?? []) next.actions[action] = false;
        }
      }
      return next;
    });
  }
  function actionControl(key: ActionKey) {
    return <Check key={key} label={ACTION_LABELS[key]} checked={permissions.actions[key]}
      onChange={(checked) => setPermissions((current) => ({ ...current, actions: { ...current.actions, [key]: checked } }))} />;
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || save.isPending) return;
    save.mutate({ id: position?.id, name: name.trim(), role, permissions, salary: Object.fromEntries(parsed) as PositionSalary },
      { onSuccess: () => { markSaved(); onClose(); } });
  }
  return <EditorPage title={position ? 'Редактирование должности' : 'Добавление должности'} onClose={onClose} pinnedFooter
    footer={<div className="flex flex-wrap items-center gap-3">
      <button form={formId} type="submit" className="btn-primary btn-md" disabled={save.isPending || !valid}>Сохранить</button>
      <button type="button" className="btn-secondary btn-md" disabled={save.isPending} onClick={onClose}>Отмена</button>
      {position && <span className="pr-12 text-xs text-text-muted">Права и ставки изменятся у всех сотрудников этой должности: {position.employees}.</span>}
    </div>}>
    <form id={formId} className="max-w-[820px] space-y-7" onSubmit={submit}>
      <DocumentField label="Название должности"><input maxLength={80} required className="input w-full" value={name}
        disabled={save.isPending} onChange={(event) => setName(event.target.value)} placeholder="Например, управляющий" /></DocumentField>
      <fieldset disabled={save.isPending}>
        <legend className="mb-2 text-lg font-semibold">Доступ к кассе</legend>
        <Check label="Работа с кассой: заказы гостей и оплата" checked={!!permissions.terminalAccess}
          onChange={(checked) => setPermissions((current) => ({ ...current, terminalAccess: checked }))} />
        {permissions.terminalAccess && <div className="ml-7">{actionControl('financeCashShifts')}</div>}
      </fieldset>
      <fieldset disabled={save.isPending}>
        <legend className="mb-2 text-lg font-semibold">Доступ к админ-панели</legend>
        <Check label="Вход в админ-панель" checked={!!permissions.adminAccess}
          onChange={(checked) => setPermissions((current) => ({ ...current, adminAccess: checked }))} />
        {permissions.adminAccess && <>
          <div className="mt-3"><table className="w-full table-fixed text-xs sm:table-auto sm:text-sm">
            <thead><tr><th className="w-[40%] sm:w-auto">Разделы</th><th className="text-center">Нет доступа</th><th className="text-center">Просмотр</th><th className="text-center">Полный доступ</th></tr></thead>
            <tbody>{groups.map((group) => <tr key={group.key}><td>
              {group.label}{level(group.sections) === 'custom' && <span className="block text-xs text-text-muted">Индивидуальные ограничения</span>}
            </td>{(['none', 'view', 'full'] as const).map((value) => <td key={value} className="text-center">
              <label className="flex min-h-8 cursor-pointer items-center justify-center"><input type="radio" name={`${formId}-${group.key}`} aria-label={`${group.label}: ${value === 'none' ? 'нет доступа' : value === 'view' ? 'просмотр' : 'полный доступ'}`}
                className="h-4 w-4 cursor-pointer accent-primary" checked={level(group.sections) === value} onChange={() => setLevel(group.sections, value)} />
              </label>
            </td>)}</tr>)}</tbody>
          </table></div>
          <details className="mt-4 text-sm"><summary className="cursor-pointer py-2 text-primary">Отдельные действия и ограничения</summary>
            <div className="grid gap-x-6 sm:grid-cols-2">{ACTION_KEYS.filter((key) => key !== 'editPermissions' && key !== 'financeCashShifts'
              && !SECTION_KEYS.some((section) => (SECTION_ACTIONS[section] ?? []).includes(key) && (!permissions.sections[section]
                || (permissions.readOnlySections?.includes(section) && (SECTION_WRITE_ACTIONS[section] ?? []).includes(key))))).map(actionControl)}</div>
            <p className="mt-2 text-xs text-text-muted">Управление должностями и передача прав доступны владельцу.</p>
          </details>
        </>}
      </fieldset>
      <details open={production} className="text-sm"><summary className="cursor-pointer py-2 text-primary">Экран приготовления</summary>
        <div className="mt-3 max-w-lg space-y-2">
          <Select ariaLabel="Экран приготовления" value={production ? role : 'ADMIN'} disabled={!!position || save.isPending}
            options={[{ value: 'ADMIN', label: 'Не используется' }, { value: 'KITCHEN', label: 'Кухня' }, { value: 'BAR', label: 'Бар' }]}
            onChange={(value) => setRole(value as PositionRole)} />
          {production && !permissions.adminAccess && <DocumentField label="Доступ к складу">
            <Select ariaLabel="Доступ к складу" value={level(['warehouse'])} disabled={save.isPending}
              options={[
                { value: 'none', label: 'Нет доступа' },
                { value: 'view', label: 'Только просмотр техкарт и остатков' },
                { value: 'full', label: 'Просмотр и изменение склада' },
                ...(level(['warehouse']) === 'custom' ? [{ value: 'custom', label: 'Индивидуальные ограничения' }] : []),
              ]}
              onChange={(value) => { if (value !== 'custom') setLevel(['warehouse'], value); }} />
          </DocumentField>}
          <p className="text-xs text-text-muted">Для повара или бармена. Конкретный цех выбирается в карточке сотрудника.</p>
        </div>
      </details>
      <fieldset disabled={save.isPending} className="space-y-4">
        <legend className="mb-2 text-lg font-semibold">Расчёт зарплаты</legend>
        <p className="text-sm text-text-muted">Выберите один или несколько способов. Расчёт и выплата — в «Финансы → Зарплата».</p>
        <div className="grid gap-3 sm:grid-cols-3">{payFields.filter(({ percent }) => !percent).map(({ key, label }) => <label key={key} className="grid gap-1 text-sm">{label}
          <input className="input min-w-0" inputMode="decimal" placeholder="0" value={rates[key]} onChange={(event) => setRates({ ...rates, [key]: event.target.value })} />
        </label>)}</div>
        <div className="grid gap-3 sm:grid-cols-2">{payFields.filter(({ percent }) => percent).map(({ key, label }) => <label key={key} className="grid gap-1 text-sm">{label}
          <input className="input min-w-0" inputMode="decimal" placeholder="0%" value={rates[key]} onChange={(event) => setRates({ ...rates, [key]: event.target.value })} />
        </label>)}</div>
        <p className="text-xs text-text-muted">Ставки складываются. Изменения относятся ко всему текущему месяцу и будущим месяцам; прошлые месяцы сохраняются.</p>
        {!validSalary && <p role="alert" className="text-danger">Укажите ставки от 0 и проценты от 0 до 100.</p>}
      </fieldset>
      {!hasAccess && <p className="text-sm text-text-muted">Разрешите хотя бы кассу, один раздел админ-панели или экран приготовления.</p>}
      {save.error && <p role="alert" className="text-danger">{apiError(save.error)}</p>}
    </form>
  </EditorPage>;
}
