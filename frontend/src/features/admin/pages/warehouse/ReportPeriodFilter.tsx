import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { warehousePeriodRange } from './warehouse-period';
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
const shortDay = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
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
  confirmSelection?: boolean;
  includeAll?: boolean;
  allRange?: { dateFrom: string; dateTo: string };
  onPreset: (preset: PeriodPreset) => void;
  onRange: (from: string, to: string) => void;
}

export function ReportPeriodFilter({ preset, today, range, label: dialogLabel = 'Период отчёта',
  allCaption = 'Всё время', confirmSelection = false, includeAll = true, allRange, onPreset, onRange }: Props) {
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
  const [pending, setPending] = useState<{ preset: PeriodPreset; range: Props['range'] }>();
  const todayKey = today.toISOString().slice(0, 10);
  const { dateFrom, dateTo } = range;
  const label = preset === 'all' ? allCaption : confirmSelection && dateFrom && dateTo
    ? formatFinanceRange(dateFrom, dateTo)
    : REPORT_PERIODS.find(({ value }) => value === preset)?.label ?? rangeCaption(dateFrom, dateTo);
  const yearNumber = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const atCurrentMonth = yearNumber === today.getUTCFullYear() && monthIndex === today.getUTCMonth();
  const monthName = (index: number) => {
    const name = months[(index + 12) % 12];
    return name[0].toLocaleUpperCase('ru') + name.slice(1);
  };
  const rangeStart = start ? (hover && hover < start ? hover : start) : pending ? pending.range.dateFrom : dateFrom;
  const rangeEnd = start ? (hover && hover > start ? hover : start) : pending ? pending.range.dateTo : dateTo;
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
    setPending(undefined);
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
    const range = { dateFrom: day < start ? day : start, dateTo: day < start ? start : day };
    if (confirmSelection) {
      setPending({ preset: 'custom', range });
      setStart('');
      setHover('');
      return;
    }
    onRange(range.dateFrom, range.dateTo);
    closeAndFocus();
  }

  function choosePreset(value: PeriodPreset) {
    if (!confirmSelection) {
      onPreset(value);
      closeAndFocus();
      return;
    }
    const next = value === 'all' && allRange ? allRange : warehousePeriodRange(value, today, dateFrom ?? todayKey, dateTo ?? todayKey);
    setPending({ preset: value, range: next });
    setChoosingRange(false);
    setStart('');
    setHover('');
    setMonth(next.dateTo ? asDate(next.dateTo) : today);
  }

  function applyPending() {
    if (start) onRange(start, start);
    else if (pending?.preset === 'custom' && pending.range.dateFrom && pending.range.dateTo) onRange(pending.range.dateFrom, pending.range.dateTo);
    else if (pending) onPreset(pending.preset);
    closeAndFocus();
  }

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect || !panel.current) return;
      const edge = 8;
      const width = Math.min(confirmSelection ? 680 : 432, window.innerWidth - edge * 2);
      const maxHeight = window.innerHeight - edge * 2;
      const height = Math.min(panel.current.scrollHeight, maxHeight);
      const below = rect.bottom + 6;
      const top = below + height <= window.innerHeight - edge ? below : Math.max(edge, rect.top - height - 6);
      setPosition({ top, left: Math.max(edge, Math.min(confirmSelection ? rect.right - width : rect.left, window.innerWidth - width - edge)), width, maxHeight });
    }
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, confirmSelection]);

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

  function calendarDays(year: number, index: number, current: boolean) {
    const firstDay = new Date(Date.UTC(year, index, 1));
    const leading = (firstDay.getUTCDay() + 6) % 7;
    const normalizedMonth = firstDay.getUTCMonth();
    return <div ref={current ? calendar : undefined} className="report-period-grid" onPointerLeave={() => setHover('')} onKeyDown={(event) => {
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
        const date = new Date(firstDay);
        date.setUTCDate(index - leading + 1);
        const key = date.toISOString().slice(0, 10);
        if (confirmSelection && date.getUTCMonth() !== normalizedMonth) return <span aria-hidden="true" key={key} />;
        const inRange = Boolean(rangeStart && rangeEnd && key >= rangeStart && key <= rangeEnd);
        return <button type="button" key={key} aria-label={fullDay.format(date)} aria-pressed={inRange}
          aria-current={key === todayKey ? 'date' : undefined} disabled={key > todayKey}
          data-outside={date.getUTCMonth() !== normalizedMonth}
          data-edge={key === rangeStart || key === rangeEnd} onClick={() => chooseDay(key)}
          onPointerEnter={() => { if (start && key <= todayKey) setHover(key); }}>
          {date.getUTCDate()}
        </button>;
      })}
    </div>;
  }

  const previousMonth = new Date(Date.UTC(yearNumber, monthIndex - 1, 1));
  return <>
    <button type="button" ref={trigger} className="report-period-trigger" aria-label={`${dialogLabel}: ${label}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}>
      {label}<span aria-hidden="true" />
    </button>
    {open && createPortal(
      <div id={id} ref={panel} role="dialog" aria-label={dialogLabel}
        className={`report-period-panel ${confirmSelection ? 'report-period-panel--confirm' : ''}`}
        style={position ?? { width: `min(${confirmSelection ? 680 : 432}px, calc(100vw - 16px))`, visibility: 'hidden' }}>
        <div className="report-period-presets">
          {REPORT_PERIODS.filter(({ value }) => value !== 'month' && (includeAll || value !== 'all')).map(({ value, label: caption }) =>
            <button type="button" key={value} aria-pressed={!choosingRange && (pending?.preset ?? preset) === value}
              onClick={() => choosePreset(value)}>{value === 'all' ? allCaption
                : confirmSelection && value === 'currentMonth' ? monthName(today.getUTCMonth())
                  : confirmSelection && value === 'lastMonth' ? monthName(today.getUTCMonth() - 1) : caption}</button>)}
          {!confirmSelection && <button type="button" aria-pressed={choosingRange} onClick={() => {
            setChoosingRange(true);
            setStart('');
            setHover('');
            calendar.current?.querySelector<HTMLButtonElement>('[data-edge="true"]:not(:disabled), [aria-current="date"]:not(:disabled), button:not(:disabled)')?.focus();
          }}>Свой период</button>}
        </div>
        <div className="report-period-calendar">
          <div className={confirmSelection ? 'report-period-months' : undefined}>
            {confirmSelection && <div className="report-period-previous-grid">
              <div className="report-period-submonth">{months[previousMonth.getUTCMonth()]} {previousMonth.getUTCFullYear()}</div>
              {calendarDays(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth(), false)}
            </div>}
            <div>
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
              {calendarDays(yearNumber, monthIndex, true)}
            </div>
          </div>
          <p className={confirmSelection ? 'sr-only' : 'report-period-hint'} aria-live="polite">
            {start ? 'Выберите конец периода' : 'Выберите начало и конец периода'}
          </p>
        </div>
        {confirmSelection && <div className="report-period-confirm">
          <button className="btn-primary btn-md" type="button" disabled={!pending && !start} onClick={applyPending}>Применить</button>
          <span>{rangeStart && rangeEnd ? formatFinanceRange(rangeStart, rangeEnd) : allCaption}</span>
        </div>}
      </div>, document.body)}
  </>;
}

function formatFinanceRange(from: string, to: string) {
  const start = asDate(from);
  const end = asDate(to);
  if (!Number.isFinite(+start) || !Number.isFinite(+end)) return 'Период';
  const formatter = start.getUTCFullYear() === end.getUTCFullYear() ? shortDay : fullDay;
  if (from === to) return formatter.format(start);
  return formatter.format(start) + ' — ' + formatter.format(end);
}
