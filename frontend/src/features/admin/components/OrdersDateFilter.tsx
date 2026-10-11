import { useEffect, useRef, useState } from 'react';
import { CalendarIcon, DatePicker } from '@/components/DatePicker';
import { useT } from '@/lib/i18n';

export const PERIOD_OPTIONS = [
  { value: 'all', label: 'Всё время' },
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'За неделю' },
  { value: 'month', label: 'За месяц' },
  { value: 'custom', label: 'Выбрать дату' },
];

type DateFilterProps = {
  period: string;
  date: string;
  onPeriodChange: (value: string) => void;
  onDateChange: (value: string) => void;
};

export function OrdersDateFilter({ period, date, onPeriodChange, onDateChange }: DateFilterProps) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [calendarRequest, setCalendarRequest] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const label = PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? PERIOD_OPTIONS[0].label;
  return (
    <div className={`orders-date-filter ${period === 'custom' ? 'is-custom' : ''}`}>
      <div className="orders-period-wrap" ref={rootRef}>
        <button type="button" className={`orders-filter-control orders-period-trigger ${open ? 'is-open' : ''}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
          <CalendarIcon />
          <span>{tr(label)}</span>
          <ChevronIcon />
        </button>
        {open && (
          <div className="orders-period-menu" role="listbox" aria-label={tr('Выбрать дату')}>
            {PERIOD_OPTIONS.map((option) => (
              <button key={option.value} type="button" role="option" aria-selected={period === option.value} className={period === option.value ? 'is-selected' : ''} onClick={() => { onPeriodChange(option.value); if (option.value === 'custom') setCalendarRequest((request) => request + 1); setOpen(false); }}>
                <span>{tr(option.label)}</span>
                {period === option.value && <CheckIcon />}
              </button>
            ))}
          </div>
        )}
      </div>
      {period === 'custom' && <DatePicker key={calendarRequest} className="orders-filter-control orders-date-input" value={date} onChange={onDateChange} openOnMount />}
    </div>
  );
}

function ChevronIcon() {
  return <svg className="orders-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
}
function CheckIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-9" /></svg>;
}
