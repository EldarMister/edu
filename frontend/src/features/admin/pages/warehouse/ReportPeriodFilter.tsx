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
export type PeriodPreset = typeof REPORT_PERIODS[number]['value'] | 'lastWeek' | 'lastTwoWeeks' | 'twoWeeks' | 'custom';

type PeriodOption = { value: Exclude<PeriodPreset, 'custom'>; label: string };
const defaultPresets = REPORT_PERIODS.filter(({ value }) => value !== 'month');
const panelWidth = 480;

const weekdays = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const months = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' }).format(Date.UTC(2024, index, 1)));
const fullDay = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'UTC' });
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
  const formatter = start.getUTCFullYear() === end.getUTCFullYear() ? shortDay : fullDay;
  return from === to ? formatter.format(start) : formatter.format(start) + ' — ' + formatter.format(end);
}

interface Props {
  preset: PeriodPreset;
  today: Date;
  range: { dateFrom?: string; dateTo?: string };
  label?: string;
  allCaption?: string;
  presets?: readonly PeriodOption[];
  includeAll?: boolean;
  onPreset: (preset: PeriodPreset) => void;
  onRange: (from: string, to: string) => void;
}

export function ReportPeriodFilter({ preset, today, range, label: dialogLabel = 'Период отчёта',
  allCaption = 'Всё время', presets = defaultPresets, includeAll = true, onPreset, onRange }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number }>();
  const [month, setMonth] = useState(() => today);
  const [start, setStart] = useState('');
  const [hover, setHover] = useState('');
  const todayKey = today.toISOString().slice(0, 10);
  const { dateFrom, dateTo } = range;
  const label = preset === 'all' ? allCaption
    : dateFrom && dateTo ? rangeCaption(dateFrom, dateTo) : presets.find(({ value }) => value === preset)?.label ?? 'Выбрать период';
  const yearNumber = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const atCurrentMonth = yearNumber === today.getUTCFullYear() && monthIndex === today.getUTCMonth();
  const monthName = (index: number) => {
    const name = months[(index + 12) % 12];
    return name[0].toLocaleUpperCase('ru') + name.slice(1);
  };
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
    setPosition(undefined);
    setOpen(true);
  }

  function chooseDay(day: string) {
    if (!start) {
      setStart(day);
      setHover('');
      return;
    }
    const [from, to] = day < start ? [day, start] : [start, day];
    onRange(from, to);
    closeAndFocus();
  }

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect || !panel.current) return;
      const edge = 8;
      const width = Math.min(panelWidth, window.innerWidth - edge * 2);
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
    const first = panel.current?.querySelector<HTMLButtonElement>('.report-period-grid [data-edge="true"]:not(:disabled)')
      ?? panel.current?.querySelector<HTMLButtonElement>('.report-period-grid [aria-current="date"]')
      ?? panel.current?.querySelector<HTMLButtonElement>('.report-period-presets [aria-pressed="true"]')
      ?? panel.current?.querySelector<HTMLButtonElement>('.report-period-grid button:not(:disabled)');
    first?.focus({ preventScroll: true });
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    }
    function scroll(event: Event) {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);

  function calendarDays(year: number, index: number) {
    const firstDay = new Date(Date.UTC(year, index, 1));
    const leading = (firstDay.getUTCDay() + 6) % 7;
    const normalizedMonth = firstDay.getUTCMonth();
    return <div className="report-period-grid" onPointerLeave={() => setHover('')} onKeyDown={(event) => {
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
        if (date.getUTCMonth() !== normalizedMonth) return <span aria-hidden="true" key={key} />;
        const inRange = Boolean(rangeStart && rangeEnd && key >= rangeStart && key <= rangeEnd);
        return <button type="button" key={key} aria-label={fullDay.format(date)} aria-pressed={inRange}
          aria-current={key === todayKey ? 'date' : undefined} disabled={key > todayKey}
          data-edge={key === rangeStart || key === rangeEnd} onClick={() => chooseDay(key)}
          onPointerEnter={() => { if (start && key <= todayKey) setHover(key); }}
          onFocus={() => { if (start) setHover(key); }}>
          {date.getUTCDate()}
        </button>;
      })}
    </div>;
  }

  return <>
    <button type="button" ref={trigger} className="report-period-trigger" aria-label={`${dialogLabel}: ${label}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}>
      {label}<span aria-hidden="true" />
    </button>
    {open && createPortal(
      <div id={id} ref={panel} role="dialog" aria-label={dialogLabel}
        className="report-period-panel"
        style={position ?? { width: `min(${panelWidth}px, calc(100vw - 16px))`, visibility: 'hidden' }}>
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
          {calendarDays(yearNumber, monthIndex)}
          <p className="report-period-hint" aria-live="polite">
            {start ? 'Выберите конец периода' : 'Выберите начало и конец периода'}
          </p>
        </div>
        <div className="report-period-presets">
          {presets.filter(({ value }) => includeAll || value !== 'all').map(({ value, label: caption }) =>
            <button type="button" key={value} aria-pressed={!start && preset === value} onClick={() => {
              onPreset(value);
              closeAndFocus();
            }}>{value === 'all' ? allCaption
              : value === 'currentMonth' ? monthName(today.getUTCMonth())
                : value === 'lastMonth' ? monthName(today.getUTCMonth() - 1) : caption}</button>)}
        </div>
      </div>, document.body)}
  </>;
}
