import { useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { api, apiError } from '@/lib/api';
import { clientId } from '@/lib/id';
import { cashShiftKey, financeKey, type FinanceCategory } from './api';
import { categoryOptions } from './category-options';
import { financeDay, parseMoney } from './finance-format';

export type CashOperationKind = 'income' | 'expense' | 'collection';
export type CashOperation = {
  id: string;
  kind: CashOperationKind;
  categoryId: string | null;
  amount: number;
  note: string | null;
  occurredAt: string;
  actorId?: string | null;
  actorName: string | null;
};

const kinds = [{ kind: 'expense', label: 'Расход' }, { kind: 'income', label: 'Внесение' },
  { kind: 'collection', label: 'Инкассация' }] as const;
type Category = Pick<FinanceCategory, 'name' | 'id' | 'kind' | 'parentId'>;
type OperationAuthor = { id: string; name: string };

function localTime(value: string) {
  const date = new Date(value);
  const time = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  return financeDay(date) + 'T' + time.format(date);
}

export function CashOperationDialog({ shiftId, operation, cashier = false, onClose }: {
  shiftId: string;
  operation?: CashOperation;
  cashier?: boolean;
  onClose: () => void;
}) {
  const formId = useId();
  const cache = useQueryClient();
  const [requestKey] = useState(clientId);
  const [kind, setKind] = useState<CashOperationKind>(operation?.kind ?? 'expense');
  const [amount, setAmount] = useState(operation ? String(Math.abs(operation.amount)) : '');
  const [categoryId, setCategoryId] = useState(operation?.categoryId ?? '');
  const [note, setNote] = useState(operation?.note ?? '');
  const initialTime = operation ? localTime(operation.occurredAt) : '';
  const [dateTime, setDateTime] = useState(initialTime);
  const initialAuthor = operation?.actorId ?? '';
  const [authorId, setAuthorId] = useState(initialAuthor);
  const editAuthor = !!operation && !cashier;
  const authorChanged = editAuthor && authorId !== initialAuthor;
  const submitted = useRef(false);
  const dirty = kind !== (operation?.kind ?? 'expense') || amount !== (operation ? String(Math.abs(operation.amount)) : '')
    || categoryId !== (operation?.categoryId ?? '') || note !== (operation?.note ?? '') || dateTime !== initialTime || authorChanged;
  const { markSaved } = useEditorDirty(dirty);
  const base = cashier ? '/cash-shifts' : '/admin/cash-shifts';
  const categories = useQuery({
    queryKey: [...cashShiftKey, 'operation-categories', base],
    queryFn: async () => (await api.get<Category[]>(base + '/operation-categories')).data,
    enabled: kind !== 'collection',
  });
  const authors = useQuery({
    queryKey: [...cashShiftKey, 'operation-authors'],
    queryFn: async () => (await api.get<OperationAuthor[]>('/admin/cash-shifts/operation-authors')).data,
    enabled: editAuthor,
  });
  const options = categoryOptions((categories.data ?? []).map((category) => ({ ...category, userIds: [], positionIds: [] })),
    (category) => category.kind === kind || category.kind === 'both');
  const parsed = parseMoney(amount);
  const save = useMutation({
    mutationFn: () => {
      const url = base + '/' + shiftId + '/operations';
      const values = { kind, amount: parsed, categoryId: kind === 'collection' || !categoryId ? undefined : categoryId,
        note, occurredAt: !cashier && dateTime && dateTime !== initialTime ? new Date(dateTime + '+06:00').toISOString() : undefined };
      return operation ? api.patch(url + '/' + operation.id, { ...values, authorId: authorChanged ? authorId : undefined })
        : api.post(url, { ...values, requestKey });
    },
    onSuccess: async () => {
      await Promise.all([cache.invalidateQueries({ queryKey: cashShiftKey }), cache.invalidateQueries({ queryKey: financeKey })]);
      markSaved();
      onClose();
    },
    onSettled: () => { submitted.current = false; },
  });
  const label = operation ? 'Сохранить' : cashier ? 'Создать' : 'Добавить';
  const disabled = parsed == null || parsed <= 0 || save.isPending;
  const close = () => {
    if (!submitted.current && (!dirty || window.confirm('Закрыть форму без сохранения?'))) onClose();
  };
  return <Modal open manageFocus title={operation ? 'Редактирование транзакции' : 'Создать транзакцию'} onClose={close}
    footer={<div className="flex flex-wrap gap-2">
      <button type="submit" form={formId} className="btn-primary btn-md" disabled={disabled}>{label}</button>
      <button type="button" className="btn-secondary btn-md" onClick={close} disabled={save.isPending}>Отмена</button>
    </div>}>
    <form id={formId} onSubmit={(event) => {
      event.preventDefault();
      if (disabled || submitted.current) return;
      submitted.current = true;
      save.mutate();
    }}>
      <fieldset disabled={save.isPending} className="grid gap-4">
        <fieldset className="grid grid-cols-3 rounded-md border border-border">
          <legend className="sr-only">Тип транзакции</legend>
          {kinds.map((item) => <label key={item.kind} className="relative text-center text-sm">
            <input type="radio" className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0" name={formId + '-kind'} checked={item.kind === kind}
              onChange={() => { setKind(item.kind); setCategoryId(''); }} />
            <span className="pointer-events-none block px-2 py-2.5 text-text-secondary peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:outline">{item.label}</span>
          </label>)}
        </fieldset>
        <label className="grid gap-1.5 text-sm">Сумма
          <input inputMode="decimal" data-dialog-initial-focus className="input w-full" value={amount} placeholder="0,00" maxLength={17}
            onChange={(event) => setAmount(event.target.value)} />
        </label>
        {kind === 'collection' ? <p className="text-sm text-text-muted">Наличные будут переведены из кассы в сейф.</p>
          : <label className="grid gap-1.5 text-sm">Категория
            <select className="input w-full" aria-label="Категория" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">Кассовые смены</option>
              {operation?.categoryId === categoryId && !options.some(({ value }) => value === categoryId)
                && <option value={categoryId}>Текущая категория</option>}
              {options.map(({ value, label: name }) => <option key={value} value={value}>{name}</option>)}
            </select>
          </label>}
        {!cashier && <label className="grid gap-1.5 text-sm">Дата и время
          <input type="datetime-local" className="input w-full" aria-label="Дата и время" step={1} value={dateTime} onChange={(event) => setDateTime(event.target.value)} />
          {!operation && <span className="text-xs text-text-muted">Если поле пустое, используется время проведения или закрытия смены.</span>}
        </label>}
        {editAuthor && <label className="grid gap-1.5 text-sm">Автор операции
          <select className="input w-full" value={authorId} disabled={!authors.data} onChange={(event) => setAuthorId(event.target.value)}>
            {!authors.data?.some(({ id }) => id === initialAuthor) && <option value={initialAuthor}>{operation.actorName ?? 'Не указан'}</option>}
            {authors.data?.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </select>
          {authors.error && <span role="alert" className="text-xs text-danger">Не удалось загрузить сотрудников</span>}
        </label>}
        <label className="grid gap-1.5 text-sm">Комментарий
          <input className="input w-full" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {(save.error || categories.error) && <p role="alert" className="text-sm text-danger">{apiError(save.error ?? categories.error)}</p>}
      </fieldset>
    </form>
  </Modal>;
}
