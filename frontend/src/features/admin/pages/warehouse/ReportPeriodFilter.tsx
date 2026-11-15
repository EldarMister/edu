import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './report-period-filter.css';

export const REPORT_PERIODS = [
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' },
  { value: 'week', label: 'Последние 7 дней' },
  { value: 'month', label: 'Последние 30 дней' },
  { value: 'currentMonth', label: 'Этот месяц' },
  { value: 'lastMonth', label: 'Прошлый месяц' },
  { value: 'all', label: 'Всё время' },
] as const;
export type PeriodPreset = typeof REPORT_PERIODS[number]['value'] | 'custom';

const weekdays = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const months = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' }).format(Date.UTC(2024, index, 1)));
const fullDay = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'UTC' });
const dayLabel = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: 'UTC' });
const keyboardOffsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

function asDate(day: string) {
  return new Date(`${day}T00:00:00Z`);
}

function rangeCaption(from?: string, to?: string) {
  if (!from || !to) return 'Выбрать период';
  const start = asDate(from);
  const end = asDate(to);
  if (!Number.isFinite(+start) || !Number.isFinite(+end)) return 'Выбрать период';
  return from === to ? dayLabel.format(start) : `${dayLabel.format(start)} – ${dayLabel.format(end)}`;
}

interface Props {
  preset: PeriodPreset;
  today: Date;
  range: { dateFrom?: string; dateTo?: string };
  label?: string;
  allCaption?: string;
  onPreset: (preset: PeriodPreset) => void;
  onRange: (from: string, to: string) => void;
}

export function ReportPeriodFilter({ preset, today, range, label: dialogLabel = 'Период отчёта',
  allCaption = 'Всё время', onPreset, onRange }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const calendar = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number }>();
  const [month, setMonth] = useState(() => today);
  const [start, setStart] = useState('');
  const [hover, setHover] = useState('');
  const [choosingRange, setChoosingRange] = useState(false);
  const todayKey = today.toISOString().slice(0, 10);
  const { dateFrom, dateTo } = range;
  const label = preset === 'all' ? allCaption : REPORT_PERIODS.find(({ value }) => value === preset)?.label ?? rangeCaption(dateFrom, dateTo);
  const yearNumber = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstDay = new Date(Date.UTC(yearNumber, monthIndex, 1));
  const leading = (firstDay.getUTCDay() + 6) % 7;
  const atCurrentMonth = yearNumber === today.getUTCFullYear() && monthIndex === today.getUTCMonth();
  const rangeStart = start ? (hover && hover < start ? hover : start) : dateFrom;
  const rangeEnd = start ? (hover && hover > start ? hover : start) : dateTo;
  const yearStart = Math.min(2012, yearNumber, dateFrom ? Number(dateFrom.slice(0, 4)) || 2012 : 2012);

  function closeAndFocus() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const anchor = dateTo && dateTo <= todayKey ? asDate(dateTo) : today;
    setMonth(Number.isFinite(+anchor) ? anchor : today);
    setStart('');
    setHover('');
    setChoosingRange(preset === 'custom');
    setPosition(undefined);
    setOpen(true);
  }

  function chooseDay(day: string) {
    setChoosingRange(true);
    if (!start) {
      setStart(day);
      setHover('');
      return;
    }
    onRange(day < start ? day : start, day < start ? start : day);
    closeAndFocus();
  }

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect || !panel.current) return;
      const edge = 8;
      const width = Math.min(432, window.innerWidth - edge * 2);
      const maxHeight = window.innerHeight - edge * 2;
      const height = Math.min(panel.current.scrollHeight, maxHeight);
      const below = rect.bottom + 6;
      const top = below + height <= window.innerHeight - edge ? below : Math.max(edge, rect.top - height - 6);
      setPosition({ top, left: Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge)), width, maxHeight });
    }
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"], button')?.focus({ preventScroll: true });
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    }
    function scroll(event: Event) {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);

  return <>
    <button type="button" ref={trigger} className="report-period-trigger" aria-label={`${dialogLabel}: ${label}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}>
      {label}<span aria-hidden="true" />
    </button>
    {open && createPortal(
      <div id={id} ref={panel} role="dialog" aria-label={dialogLabel} className="report-period-panel"
        style={position ?? { width: 'min(432px, calc(100vw - 16px))', visibility: 'hidden' }}>
        <div className="report-period-presets">
          {REPORT_PERIODS.map(({ value, label: caption }) =>
            <button type="button" key={value} aria-pressed={!choosingRange && preset === value} onClick={() => {
              onPreset(value);
              closeAndFocus();
            }}>{value === 'all' ? allCaption : caption}</button>)}
          <button type="button" aria-pressed={choosingRange} onClick={() => {
            setChoosingRange(true);
            setStart('');
            setHover('');
            calendar.current?.querySelector<HTMLButtonElement>('[data-edge="true"]:not(:disabled), [aria-current="date"]:not(:disabled), button:not(:disabled)')?.focus();
          }}>Свой период</button>
        </div>
        <div className="report-period-calendar">
          <div className="report-period-month">
            <button type="button" aria-label="Предыдущий месяц"
              onClick={() => setMonth(new Date(Date.UTC(yearNumber, monthIndex - 1, 1)))}>‹</button>
            <select aria-label="Месяц" value={monthIndex}
              onChange={(event) => setMonth(new Date(Date.UTC(yearNumber, Number(event.target.value), 1)))}>
              {months.map((name, index) => <option key={name} value={index}
                disabled={yearNumber === today.getUTCFullYear() && index > today.getUTCMonth()}>{name}</option>)}
            </select>
            <select aria-label="Год" value={yearNumber} onChange={(event) => {
              const year = Number(event.target.value);
              setMonth(new Date(Date.UTC(year, year === today.getUTCFullYear() ? Math.min(monthIndex, today.getUTCMonth()) : monthIndex, 1)));
            }}>
              {Array.from({ length: today.getUTCFullYear() - yearStart + 1 }, (_, i) => yearStart + i)
                .map((year) => <option key={year}>{year}</option>)}
            </select>
            <button type="button" aria-label="Следующий месяц" disabled={atCurrentMonth}
              onClick={() => setMonth(new Date(Date.UTC(yearNumber, monthIndex + 1, 1)))}>›</button>
          </div>
          <div ref={calendar} className="report-period-grid" onPointerLeave={() => setHover('')} onKeyDown={(event) => {
            const delta = keyboardOffsets[event.key];
            if (delta === undefined) return;
            const days = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
            const index = days.indexOf(event.target as HTMLButtonElement);
            if (index < 0) return;
            event.preventDefault();
            if (!days[index + delta]?.disabled) days[index + delta]?.focus();
          }}>
            {weekdays.map((day) => <span key={day} aria-hidden="true">{day}</span>)}
            {Array.from({ length: 42 }, (_, index) => {
              const date = new Date(Date.UTC(yearNumber, monthIndex, index - leading + 1));
              const key = date.toISOString().slice(0, 10);
              const inRange = Boolean(rangeStart && rangeEnd && key >= rangeStart && key <= rangeEnd);
              return <button type="button" key={key} aria-label={fullDay.format(date)} aria-pressed={inRange}
                aria-current={key === todayKey ? 'date' : undefined} disabled={key > todayKey}
                data-outside={date.getUTCMonth() !== monthIndex}
                data-edge={key === rangeStart || key === rangeEnd} onClick={() => chooseDay(key)}
                onPointerEnter={() => { if (start && key <= todayKey) setHover(key); }}>
                {date.getUTCDate()}
              </button>;
            })}
          </div>
          <p className="report-period-hint" aria-live="polite">{start ? 'Выберите конец периода' : 'Выберите начало и конец периода'}</p>
        </div>
      </div>, document.body)}
  </>;
}
