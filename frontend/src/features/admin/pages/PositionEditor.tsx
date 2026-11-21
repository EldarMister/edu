import { useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { apiError } from '@/lib/api';
import { ACTION_LABELS, ACTION_KEYS, getDefaultPermissionsByRole, READ_ONLY_SECTION_KEYS, resolvePermissions, SECTION_KEYS, SECTION_LABELS, SECTION_WRITE_ACTIONS } from '@/lib/permissions';
import type { ActionKey, EmployeePermissions, SectionKey } from '@/types';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { DocumentField } from './warehouse/WarehouseUi';
import { parseMoney } from './finance/finance-format';
import { SECTION_ACTIONS } from './position-permissions';
import { useStaffPositionMutations, type PositionRole, type PositionSalary, type StaffPosition } from './positions-api';

const payFields: { key: keyof PositionSalary; label: string; percent?: boolean }[] = [
  { key: 'hourly', label: 'За час, с' }, { key: 'perShift', label: 'За смену, с' }, { key: 'monthly', label: 'За месяц, с' },
  { key: 'personalPercent', label: 'Процент от личных продаж', percent: true },
  { key: 'shiftPercent', label: 'Процент от продаж за смену', percent: true },
];
const terminalActions: ActionKey[] = [
  'acceptOrderPayments', 'printReceipts', 'requestReceiptPrints', 'createDeliveryOrders', 'financeCashShifts',
];
const editorTabs = [
  { key: 'general', label: 'Общие данные' },
  { key: 'admin', label: 'Админ-панель' },
  { key: 'terminal', label: 'Касса' },
] as const;
type EditorTab = (typeof editorTabs)[number]['key'];
const sectionLevels = [
  { value: 'none', label: 'Нет доступа' },
  { value: 'view', label: 'Просмотр' },
  { value: 'full', label: 'Полный доступ' },
] as const;
type SectionLevel = (typeof sectionLevels)[number]['value'];
const actionLevels = [
  { value: 'denied', label: 'Запрещено' },
  { value: 'allowed', label: 'Разрешено' },
] as const;

function AccessRow<Value extends string>({ name, label, note, options, selected, onChange }: {
  name: string;
  label: string;
  note?: string;
  options: readonly { value: Value; label: string }[];
  selected: Value | 'custom';
  onChange: (value: Value) => void;
}) {
  return <div className="grid gap-2.5 border-b border-border/60 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(19rem,24rem)] sm:items-center sm:gap-5">
    <div>
      <span id={`${name}-label`} className="font-medium">{label}</span>
      {note && <p className="mt-0.5 text-xs text-text-muted">{note}</p>}
    </div>
    <div role="radiogroup" aria-labelledby={`${name}-label`} className="grid grid-flow-col auto-cols-fr gap-1 rounded-xl border border-border/60 bg-background p-1">
      {options.map((option) => <label key={option.value} className="min-w-0">
        <input type="radio" name={name} className="peer sr-only" checked={selected === option.value}
          onChange={() => onChange(option.value)} />
        <span className="grid h-full min-h-9 cursor-pointer place-items-center rounded-lg px-1.5 py-1 text-center text-xs font-medium text-text-secondary transition-colors hover:bg-card hover:text-text-primary peer-checked:bg-primary/15 peer-checked:text-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-primary peer-disabled:cursor-default peer-disabled:opacity-70 sm:text-sm">
          {option.label}
        </span>
      </label>)}
    </div>
  </div>;
}

function initialPermissions(position?: StaffPosition): EmployeePermissions {
  if (position) return resolvePermissions(position.role, position.permissions);
  const permissions = getDefaultPermissionsByRole('ADMIN');
  permissions.terminalAccess = false;
  permissions.adminAccess = false;
  for (const key of SECTION_KEYS) permissions.sections[key] = false;
  for (const key of ACTION_KEYS) permissions.actions[key] = false;
  permissions.actions.acceptOrderPayments = true;
  permissions.actions.requestReceiptPrints = true;
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
  const [tab, setTab] = useState<EditorTab>('general');
  const [name, setName] = useState(position?.name ?? '');
  const [role, setRole] = useState<PositionRole>(position?.role ?? 'ADMIN');
  const [permissions, setPermissions] = useState(() => initialPermissions(position));
  const [rates, setRates] = useState(() => Object.fromEntries(payFields.map(({ key }) =>
    [key, position?.salary?.[key] ? String(position.salary[key]) : ''])) as Record<keyof PositionSalary, string>);
  const { save } = useStaffPositionMutations();
  const production = role === 'KITCHEN' || role === 'BAR';
  const canChangeAdmin = !position?.fixedWorkspace;
  const canChangeTerminal = position?.fixedWorkspace !== 'production';
  const adminEnabled = canChangeAdmin && permissions.adminAccess === true;
  const terminalEnabled = canChangeTerminal && permissions.terminalAccess === true;
  const hasAccess = terminalEnabled || production || (adminEnabled && SECTION_KEYS.some((key) => permissions.sections[key]));
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
  const tabs = editorTabs.filter(({ key }) => key === 'general'
    || (key === 'admin' && adminEnabled)
    || (key === 'terminal' && terminalEnabled));

  function level(section: SectionKey): SectionLevel | 'custom' {
    if (!permissions.sections[section]) return 'none';
    const readOnly = !READ_ONLY_SECTION_KEYS.includes(section) || permissions.readOnlySections?.includes(section);
    const requiredActions = (SECTION_ACTIONS[section] ?? []).filter((action) =>
      !readOnly || !SECTION_WRITE_ACTIONS[section]?.includes(action));
    if (requiredActions.some((action) => !permissions.actions[action])) return 'custom';
    return readOnly ? 'view' : 'full';
  }
  function setLevel(section: SectionKey, value: SectionLevel) {
    setPermissions((current) => {
      const next = { ...current, sections: { ...current.sections, [section]: value !== 'none' }, actions: { ...current.actions },
        readOnlySections: (current.readOnlySections ?? []).filter((key) => key !== section) };
      const readOnly = value === 'view' && READ_ONLY_SECTION_KEYS.includes(section);
      if (readOnly) next.readOnlySections.push(section);
      for (const action of SECTION_ACTIONS[section] ?? []) {
        next.actions[action] = value !== 'none' && !(readOnly && SECTION_WRITE_ACTIONS[section]?.includes(action));
      }
      return next;
    });
  }
  function actionControl(key: ActionKey) {
    return <Check key={key} label={ACTION_LABELS[key]} checked={permissions.actions[key]}
      onChange={(checked) => setPermissions((current) => ({ ...current, actions: { ...current.actions, [key]: checked } }))} />;
  }
  function switchTab(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex(({ key }) => key === tab);
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowLeft': nextIndex = (index + tabs.length - 1) % tabs.length; break;
      case 'ArrowRight': nextIndex = (index + 1) % tabs.length; break;
      case 'Home': nextIndex = 0; break;
      case 'End': nextIndex = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setTab(tabs[nextIndex].key);
    event.currentTarget.querySelectorAll('button')[nextIndex]?.focus();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || save.isPending) return;
    save.mutate({ id: position?.id, name: name.trim(), role, permissions, salary: Object.fromEntries(parsed) as PositionSalary },
      { onSuccess: () => { markSaved(); onClose(); } });
  }
  function tabPanel(key: EditorTab, children: ReactNode) {
    return <section id={`${formId}-panel-${key}`} role={tabs.length > 1 ? 'tabpanel' : undefined}
      aria-labelledby={tabs.length > 1 ? `${formId}-tab-${key}` : undefined} hidden={tab !== key}
      className="py-4 sm:px-2">
      {tab === key && children}
    </section>;
  }

  function close() {
    if (!save.isPending) onClose();
  }

  return <Modal open title={position ? 'Редактирование должности' : 'Добавление должности'} onClose={close}
    panelClassName="max-w-[52rem]"
    toolbar={tabs.length > 1 && <div role="tablist" aria-label="Настройки должности" onKeyDown={switchTab}
      className="flex gap-1 overflow-x-auto sm:gap-4 sm:px-2">
      {tabs.map(({ key, label }) => <button key={key} id={`${formId}-tab-${key}`} type="button" role="tab"
        aria-selected={tab === key} aria-controls={`${formId}-panel-${key}`} tabIndex={tab === key ? 0 : -1}
        onClick={() => setTab(key)} className={`min-h-11 shrink-0 border-b-2 px-2 text-sm font-medium transition-colors sm:px-3
          ${tab === key ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
        {label}
      </button>)}
    </div>}
    footer={<div className="space-y-2">
      {save.error && <p role="alert" className="text-sm text-danger">{apiError(save.error)}</p>}
      {!validSalary && <p role="alert" className="text-sm text-danger">Укажите ставки от 0 и проценты от 0 до 100.</p>}
      {!hasAccess && <p className="text-xs text-text-muted">Разрешите хотя бы кассу, один раздел админ-панели или экран приготовления.</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {position && <p className="mr-auto text-xs text-text-muted">Сотрудников с этой должностью: {position.employees}</p>}
        <button type="button" className="btn-secondary btn-md" disabled={save.isPending} onClick={close}>Отмена</button>
        <button form={formId} type="submit" className="btn-primary btn-md" disabled={save.isPending || !valid}>Сохранить</button>
      </div>
    </div>}>
    <form id={formId} onSubmit={submit} className="text-sm">
      {tabPanel('general', <fieldset disabled={save.isPending} className="min-w-0 space-y-6">
        <DocumentField label="Название должности"><input maxLength={80} required className="input w-full" value={name}
          onChange={(event) => setName(event.target.value)} placeholder="Например, управляющий" /></DocumentField>
        {(canChangeAdmin || canChangeTerminal) && <div>
          <h4 className="text-base font-semibold">Рабочие места</h4>
          {canChangeAdmin && <Check label="Вход в админ-панель" checked={adminEnabled}
            onChange={(checked) => setPermissions((current) => ({ ...current, adminAccess: checked }))} />}
          {canChangeTerminal && <Check label="Открывать кассу и оформлять заказы гостей" checked={terminalEnabled}
            onChange={(checked) => setPermissions((current) => ({ ...current, terminalAccess: checked }))} />}
        </div>}
        <div>
          <h4 className="mb-2 text-base font-semibold">Экран приготовления</h4>
          <div className="max-w-lg space-y-2">
            <Select ariaLabel="Экран приготовления" value={production ? role : 'ADMIN'} disabled={!!position || save.isPending}
              options={[{ value: 'ADMIN', label: 'Не используется' }, { value: 'KITCHEN', label: 'Кухня' }, { value: 'BAR', label: 'Бар' }]}
              onChange={(value) => setRole(value as PositionRole)} />
            <p className="text-xs text-text-muted">Для повара или бармена. Конкретный цех выбирается в карточке сотрудника.</p>
          </div>
        </div>
        <div>
          <h4 className="text-base font-semibold">Рабочие смены</h4>
          <Check label="Учитывать рабочие смены" checked={permissions.workShiftRequired !== false}
            onChange={(checked) => setPermissions((current) => ({ ...current, workShiftRequired: checked }))} />
          <p className="text-sm text-text-muted">Сотрудник начинает смену перед работой. Часы и смены попадают в табель и расчёт зарплаты.</p>
        </div>
        <div className="space-y-3">
          <h4 className="text-base font-semibold">Расчёт зарплаты</h4>
          <p className="text-sm text-text-muted">Выберите один или несколько способов. Расчёт и выплата — в «Финансы → Зарплата».</p>
          <div className="grid gap-3 sm:grid-cols-3">{payFields.filter(({ percent }) => !percent).map(({ key, label }) => <label key={key} className="grid gap-1 text-sm">{label}
            <input className="input min-w-0" inputMode="decimal" placeholder="0" value={rates[key]} onChange={(event) => setRates({ ...rates, [key]: event.target.value })} />
          </label>)}</div>
          <div className="grid gap-3 sm:grid-cols-2">{payFields.filter(({ percent }) => percent).map(({ key, label }) => <label key={key} className="grid gap-1 text-sm">{label}
            <input className="input min-w-0" inputMode="decimal" placeholder="0%" value={rates[key]} onChange={(event) => setRates({ ...rates, [key]: event.target.value })} />
          </label>)}</div>
          <p className="text-xs text-text-muted">Ставки складываются. Изменения относятся ко всему текущему месяцу и будущим месяцам; прошлые месяцы сохраняются.</p>
        </div>
      </fieldset>)}
      {adminEnabled && tabPanel('admin', <fieldset disabled={save.isPending} className="min-w-0">
        {SECTION_KEYS.map((section) => {
          const currentLevel = level(section);
          return <AccessRow<SectionLevel> key={section} name={`${formId}-section-${section}`} label={SECTION_LABELS[section]}
            options={READ_ONLY_SECTION_KEYS.includes(section) ? sectionLevels : sectionLevels.filter(({ value }) => value !== 'full')}
            selected={currentLevel} note={currentLevel === 'custom' ? 'Индивидуальные ограничения' : undefined}
            onChange={(value) => setLevel(section, value)} />;
        })}
        <details className="mt-4 border-t border-border pt-2"><summary className="cursor-pointer py-2 font-medium text-primary">Отдельные действия и ограничения</summary>
          <div className="grid gap-x-6 sm:grid-cols-2">{ACTION_KEYS.filter((key) => key !== 'editPermissions' && !terminalActions.includes(key)
            && !SECTION_KEYS.some((section) => (SECTION_ACTIONS[section] ?? []).includes(key) && (!permissions.sections[section]
              || (permissions.readOnlySections?.includes(section) && (SECTION_WRITE_ACTIONS[section] ?? []).includes(key))))).map(actionControl)}</div>
          <p className="mt-2 text-xs text-text-muted">Управление должностями и передача прав доступны владельцу.</p>
        </details>
      </fieldset>)}
      {terminalEnabled && tabPanel('terminal', <fieldset disabled={save.isPending} className="min-w-0">
        {terminalActions.map((key) => <AccessRow key={key} name={`${formId}-action-${key}`}
          label={ACTION_LABELS[key]} options={actionLevels} selected={permissions.actions[key] ? 'allowed' : 'denied'}
          onChange={(value) => setPermissions((current) => ({ ...current, actions: { ...current.actions, [key]: value === 'allowed' } }))} />)}
      </fieldset>)}
    </form>
  </Modal>;
}
