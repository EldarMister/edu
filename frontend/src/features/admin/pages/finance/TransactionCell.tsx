import { useState, type ReactNode } from 'react';
import { apiError } from '@/lib/api';

export function TransactionCell({ field, value, display, options, onSave }: {
  field: 'category' | 'note';
  value: string;
  display: ReactNode;
  options?: { value: string; label: string }[];
  onSave: (value: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const label = field === 'category' ? 'категорию' : 'комментарий';
  if (draft === null) return <button type="button" className="finance-edit-cell" aria-label={'Изменить ' + label}
    onClick={() => { setDraft(value); setError(''); }}>
    {display}{field === 'category' && <span aria-hidden="true">▾</span>}
  </button>;
  return <form className="grid gap-1.5" onSubmit={async (event) => {
    event.preventDefault();
    if (pending) return;
    if (draft.trim() === value) { setDraft(null); return; }
    setPending(true);
    setError('');
    try {
      await onSave(draft.trim());
      setDraft(null);
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      setPending(false);
    }
  }} onKeyDown={(event) => {
    if (event.key === 'Escape' && !pending) { event.preventDefault(); setDraft(null); }
  }}>
    {options ? <select aria-label="Категория" className="input w-full" autoFocus value={draft} disabled={pending}
      onChange={(event) => setDraft(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select> : <textarea aria-label="Комментарий" className="input w-full" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)}
      maxLength={500} rows={2} disabled={pending} />}
    <div className="flex flex-wrap items-center gap-2">
      <button type="submit" className="finance-tool" disabled={pending}>Сохранить</button>
      <button type="button" className="finance-tool" onClick={() => setDraft(null)} disabled={pending}>Отмена</button>
    </div>
    {error && <span className="text-xs text-danger" role="alert">{error}</span>}
  </form>;
}
