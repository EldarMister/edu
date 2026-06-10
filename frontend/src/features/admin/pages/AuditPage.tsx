import { useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useAuditLogs, useAuditFilters, type AuditLogEntry } from '../api';

/** Человекочитаемые названия типов действий. */
const ACTION_LABELS: Record<string, string> = {
  ORDER_CREATED: 'Создание заказа',
  ORDER_CANCELLED: 'Отмена заказа',
  ORDER_UPDATED: 'Изменение заказа',
  ORDER_PAID: 'Оплата',
  ORDER_PAYMENT_METHOD_CHANGED: 'Смена способа оплаты',
  ORDER_ITEM_ADDED: 'Добавление блюда',
  ORDER_ITEM_REMOVED: 'Удаление блюда',
  ORDER_ITEM_QUANTITY_CHANGED: 'Изменение количества',
  TABLE_CLOSED: 'Закрытие стола',
  TABLE_MOVED: 'Перенос стола',
  TABLE_TRANSFERRED: 'Передача стола',
  MENU_ITEM_CREATED: 'Добавление блюда (меню)',
  MENU_ITEM_UPDATED: 'Изменение меню',
  MENU_ITEM_DELETED: 'Удаление блюда (меню)',
  MENU_ITEM_PRICE_CHANGED: 'Изменение цены',
  CATEGORY_CREATED: 'Добавление категории',
  CATEGORY_UPDATED: 'Изменение категории',
  CATEGORY_DELETED: 'Удаление категории',
  STAFF_CREATED: 'Добавление сотрудника',
  STAFF_UPDATED: 'Изменение сотрудника',
  STAFF_DELETED: 'Удаление сотрудника',
  SETTINGS_UPDATED: 'Изменение настроек',
};

/** Цветовой тон по типу действия (важные/деструктивные — красным). */
function actionTone(action: string): string {
  if (action.includes('CANCELLED') || action.includes('DELETED') || action.includes('REMOVED')) {
    return 'bg-danger/10 text-danger';
  }
  if (action.includes('PAID')) return 'bg-success/10 text-success';
  if (action.includes('PRICE') || action.includes('TRANSFERRED') || action.includes('MOVED')) {
    return 'bg-warning/10 text-warning';
  }
  if (action.includes('CREATED')) return 'bg-primary/10 text-primary';
  return 'bg-background text-text-secondary';
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  WAITER: 'Официант',
  KITCHEN: 'Кухня',
  BAR: 'Бар',
};

export function AuditPage() {
  const tr = useT();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [userId, setUserId] = useState('');
  const [actionType, setActionType] = useState('');
  const [page, setPage] = useState(1);

  const filtersQ = useAuditFilters();
  const logsQ = useAuditLogs({ from, to, userId, actionType, page });
  const data = logsQ.data;

  function resetTo1<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  function clearFilters() {
    setFrom('');
    setTo('');
    setUserId('');
    setActionType('');
    setPage(1);
  }

  const hasFilters = !!(from || to || userId || actionType);

  return (
    <div className="space-y-4">
      {/* Фильтры */}
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <Field label={tr('С даты')}>
          <input
            type="date"
            className="input h-10"
            value={from}
            onChange={(e) => resetTo1(setFrom)(e.target.value)}
          />
        </Field>
        <Field label={tr('По дату')}>
          <input
            type="date"
            className="input h-10"
            value={to}
            onChange={(e) => resetTo1(setTo)(e.target.value)}
          />
        </Field>
        <Field label={tr('Сотрудник')}>
          <select
            className="input h-10"
            value={userId}
            onChange={(e) => resetTo1(setUserId)(e.target.value)}
          >
            <option value="">{tr('Все')}</option>
            {filtersQ.data?.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr('Тип действия')}>
          <select
            className="input h-10"
            value={actionType}
            onChange={(e) => resetTo1(setActionType)(e.target.value)}
          >
            <option value="">{tr('Все')}</option>
            {filtersQ.data?.actionTypes.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a] ?? a}
              </option>
            ))}
          </select>
        </Field>
        {hasFilters && (
          <button className="btn-secondary btn-md h-10" onClick={clearFilters}>
            {tr('Сбросить')}
          </button>
        )}
      </div>

      {/* Список */}
      <div className="card overflow-hidden">
        {logsQ.isLoading ? (
          <div className="flex justify-center py-12 text-primary">
            <Spinner className="h-6 w-6" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="py-12 text-center text-text-muted">{tr('Записей не найдено')}</p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {data.items.map((log) => (
                <AuditRow key={log.id} log={log} />
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
              <span className="text-text-muted">
                {tr('Всего')}: {data.total} · {data.page} / {data.pages}
              </span>
              <div className="flex gap-2">
                <button
                  className="btn-secondary btn-md"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {tr('Назад')}
                </button>
                <button
                  className="btn-secondary btn-md"
                  disabled={page >= data.pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {tr('Вперёд')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AuditRow({ log }: { log: AuditLogEntry }) {
  const tr = useT();
  const date = new Date(log.createdAt);
  const amount = typeof log.metadata?.amount === 'number' ? (log.metadata.amount as number) : null;

  return (
    <li className="flex flex-col gap-1.5 p-4 sm:flex-row sm:items-start sm:gap-4">
      <div className="shrink-0 text-sm text-text-muted sm:w-32">
        <div>{date.toLocaleDateString('ru-RU')}</div>
        <div className="font-medium text-text-secondary">{timeHM(log.createdAt)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${actionTone(log.actionType)}`}>
            {ACTION_LABELS[log.actionType] ?? log.actionType}
          </span>
          <span className="text-sm font-medium text-text-primary">{log.userName ?? '—'}</span>
          {log.userRole && (
            <span className="text-xs text-text-muted">
              {tr(ROLE_LABELS[log.userRole] ?? log.userRole)}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-text-secondary">{log.description ?? '—'}</p>
      </div>
      {amount !== null && (
        <div className="shrink-0 text-right text-sm font-semibold text-text-primary sm:w-28">
          {amount} с
        </div>
      )}
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text-muted">
      {label}
      {children}
    </label>
  );
}
