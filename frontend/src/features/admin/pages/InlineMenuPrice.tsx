import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { apiError } from '@/lib/api';
import { IconCheck, IconX } from '../components/icons';
import { salePrice } from './menu-sale-price';

export function InlineMenuPrice({ name, price, display, onSave }: {
  name: string;
  price: number;
  display: string;
  onSave: (price: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const errorId = useId();
  const editing = draft !== null;

  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (wasEditing.current) trigger.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function close() {
    setDraft(null);
    setError('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || draft == null) return;
    const next = salePrice(draft);
    if (next == null || next <= 0) {
      setError('Введите цену больше нуля, до двух знаков после запятой.');
      input.current?.focus();
      return;
    }
    if (next === price) {
      close();
      return;
    }
    submitting.current = true;
    setSaving(true);
    try {
      await onSave(next);
      close();
    } catch (failure) {
      setError(apiError(failure));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  if (draft == null) return <button ref={trigger} type="button" aria-label={`Изменить цену: ${name}, ${display}`}
    className="rounded px-1 font-medium tabular-nums text-primary hover:underline" onClick={() => setDraft(String(price))}>
    {display}
  </button>;

  return <form aria-busy={saving} onSubmit={(event) => void save(event)} onKeyDown={(event) => {
    if (event.key === 'Escape' && !submitting.current) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }}>
    <div className="inline-flex items-center gap-1">
      <input ref={input} value={draft} onChange={(event) => { setDraft(event.target.value); setError(''); }}
        aria-label={`Цена: ${name}`} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
        type="text" inputMode="decimal" readOnly={saving} className="input h-9 w-24 px-2 text-right tabular-nums" />
      <button type="submit" aria-label="Сохранить цену" title="Сохранить цену" disabled={saving}
        className="btn-ghost inline-flex h-9 w-9 items-center justify-center p-0 text-primary"><IconCheck className="h-4 w-4" /></button>
      <button type="button" aria-label="Отменить изменение цены" title="Отменить изменение цены" disabled={saving} onClick={close}
        className="btn-ghost inline-flex h-9 w-9 items-center justify-center p-0"><IconX className="h-4 w-4" /></button>
    </div>
    {error && <p id={errorId} role="alert" className="mt-1 max-w-44 whitespace-normal text-xs text-danger">{error}</p>}
  </form>;
}
