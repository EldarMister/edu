import { useEffect, useRef, useState } from 'react';
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

const weekdays = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const months = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function parseDate(value: string): Date | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toDisplay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

export function OrdersDateFilter({ period, date, onPeriodChange, onDateChange }: DateFilterProps) {
  const tr = useT();
  const [open, setOpen] = useState<'period' | 'calendar' | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const selected = date ? new Date(`${date}T12:00:00`) : new Date();
    return new Date(selected.getFullYear(), selected.getMonth(), 1);
  });
  const [typedDate, setTypedDate] = useState(toDisplay(date));
  const rootRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => setTypedDate(toDisplay(date)), [date]);
  useEffect(() => {
    if (!open) return;
    const onOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
    };
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const firstWeekday = (visibleMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, index) => new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index - firstWeekday + 1));
  const today = toIso(new Date());
  const label = PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? PERIOD_OPTIONS[0].label;

  function chooseDate(nextDate: Date) {
    onDateChange(toIso(nextDate));
    setVisibleMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
    setOpen(null);
  }

  function changeMonth(offset: number) {
    setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1));
  }

  return (
    <div className={`orders-date-filter ${period === 'custom' ? 'is-custom' : ''}`} ref={rootRef}>
      <div className="orders-period-wrap">
        <button
          type="button"
          className={`orders-filter-control orders-period-trigger ${open === 'period' ? 'is-open' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open === 'period'}
          onClick={() => setOpen(open === 'period' ? null : 'period')}
        >
          <CalendarIcon />
          <span>{tr(label)}</span>
          <ChevronIcon />
        </button>
        {open === 'period' && (
          <div className="orders-period-menu" role="listbox" aria-label={tr('Выбрать дату')}>
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={period === option.value}
                className={period === option.value ? 'is-selected' : ''}
                onClick={() => {
                  onPeriodChange(option.value);
                  if (option.value === 'custom') {
                    const selected = date ? new Date(`${date}T12:00:00`) : new Date();
                    setVisibleMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
                    setOpen('calendar');
                    requestAnimationFrame(() => dateRef.current?.focus());
                  } else {
                    setOpen(null);
                  }
                }}
              >
                <span>{tr(option.label)}</span>
                {period === option.value && <CheckIcon />}
              </button>
            ))}
          </div>
        )}
      </div>

      {period === 'custom' && (
        <div className="orders-date-input-wrap">
          <input
            ref={dateRef}
            className={`orders-filter-control orders-date-input ${open === 'calendar' ? 'is-open' : ''}`}
            value={typedDate}
            inputMode="numeric"
            placeholder="ДД.ММ.ГГГГ"
            aria-label={tr('Выбрать дату')}
            onFocus={() => setOpen('calendar')}
            onBlur={() => {
              if (typedDate && !parseDate(typedDate)) setTypedDate(toDisplay(date));
            }}
            onChange={(event) => {
              const next = event.target.value;
              setTypedDate(next);
              if (next === '') onDateChange('');
              const parsed = parseDate(next);
              if (parsed) {
                onDateChange(toIso(parsed));
                setVisibleMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
              }
            }}
          />
          <button type="button" className="orders-date-input-icon" aria-label={tr('Выбрать дату')} onClick={() => setOpen(open === 'calendar' ? null : 'calendar')}>
            <CalendarIcon />
          </button>
          {open === 'calendar' && (
            <div className="orders-calendar" role="dialog" aria-label={tr('Выбрать дату')}>
              <div className="orders-calendar-header">
                <strong>{months[visibleMonth.getMonth()]} {visibleMonth.getFullYear()} г.</strong>
                <div className="orders-calendar-nav">
                  <button type="button" aria-label="Предыдущий месяц" onClick={() => changeMonth(-1)}><ArrowIcon /></button>
                  <button type="button" aria-label="Следующий месяц" onClick={() => changeMonth(1)}><ArrowIcon next /></button>
                </div>
              </div>
              <div className="orders-calendar-grid">
                {weekdays.map((day) => <span className="orders-calendar-weekday" key={day}>{day}</span>)}
                {cells.map((cell) => {
                  const iso = toIso(cell);
                  return (
                    <button
                      type="button"
                      key={iso}
                      className={`${cell.getMonth() !== visibleMonth.getMonth() ? 'is-outside' : ''} ${date === iso ? 'is-selected' : ''} ${today === iso ? 'is-today' : ''}`}
                      aria-label={cell.toLocaleDateString('ru-RU')}
                      aria-pressed={date === iso}
                      onClick={() => chooseDate(cell)}
                    >
                      {cell.getDate()}
                    </button>
                  );
                })}
              </div>
              <div className="orders-calendar-footer">
                <button type="button" onClick={() => { onDateChange(''); setTypedDate(''); setOpen(null); }}>{tr('Очистить')}</button>
                <button type="button" onClick={() => chooseDate(new Date())}>{tr('Сегодня')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CalendarIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></svg>;
}
function ChevronIcon() {
  return <svg className="orders-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
}
function CheckIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-9" /></svg>;
}
function ArrowIcon({ next = false }: { next?: boolean }) {
  return <svg className={next ? 'is-next' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>;
}
