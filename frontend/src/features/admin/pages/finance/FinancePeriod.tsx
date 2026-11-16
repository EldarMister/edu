import { useRef, useState } from 'react';
import { DatePicker } from '@/components/DatePicker';
import { financeDay } from './finance-format';

export function FinancePeriod({ from, to, onApply }: {
  from: string; to: string; onApply: (period: { from: string; to: string }) => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [draft, setDraft] = useState({ from, to });
  const today = financeDay();
  const format = (value: string) => value.split('-').reverse().join('.');
  function apply(next: { from: string; to: string }) {
    onApply(next);
    details.current?.removeAttribute('open');
  }
  function preset(days: number) {
    apply({ from: financeDay(new Date(Date.now() - (days - 1) * 86400000)), to: today });
  }
  return <details ref={details} className="relative" onToggle={(event) => {
    if (event.currentTarget.open) setDraft({ from, to });
  }}>
    <summary className="btn-secondary btn-md cursor-pointer list-none whitespace-nowrap" aria-label="Период">
      {from && to ? format(from) + ' — ' + format(to) : 'Период'} <span aria-hidden="true">⌄</span>
    </summary>
    <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-border bg-card p-3 shadow-lg">
      <div className="mb-3 flex gap-2">
        <button className="btn-secondary btn-md" type="button" onClick={() => preset(7)}>7 дней</button>
        <button className="btn-secondary btn-md" type="button" onClick={() => preset(30)}>30 дней</button>
      </div>
      <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); apply(draft); }}>
        <DatePicker aria-label="С даты" className="input w-full" value={draft.from} max={draft.to || today}
          onChange={(value) => setDraft((old) => ({ ...old, from: value }))} />
        <DatePicker aria-label="По дату" className="input w-full" value={draft.to} min={draft.from} max={today}
          onChange={(value) => setDraft((old) => ({ ...old, to: value }))} />
        <button className="btn-primary btn-md" type="submit"
          disabled={!draft.from || !draft.to || draft.from > draft.to}>Применить</button>
      </form>
    </div>
  </details>;
}
