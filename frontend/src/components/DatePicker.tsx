import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/lib/i18n';
import './date-picker.css';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  openOnMount?: boolean;
};

const weekdays = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const months = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toDisplay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function parseDisplay(value: string): Date | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match.map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return year > 0 && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function monthFor(value: string): Date {
  const date = parseDisplay(toDisplay(value)) ?? new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function CalendarIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></svg>;
}

export function DatePicker({ value, onChange, className = '', min, max, disabled, readOnly, openOnMount = false, onFocus, onBlur, onKeyDown, ...inputProps }: Props) {
  const tr = useT();
  const calendarId = useId();
  const [open, setOpen] = useState(openOnMount);
  const [typedDate, setTypedDate] = useState(() => toDisplay(value));
  const [visibleMonth, setVisibleMonth] = useState(() => monthFor(value));
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const iconRef = useRef<HTMLButtonElement>(null);
  const focusCalendar = useRef(openOnMount);
  const canEdit = !disabled && !readOnly;
  const minimum = typeof min === 'string' ? min : '';
  const maximum = typeof max === 'string' ? max : '';
  const allowed = (iso: string) => (!minimum || iso >= minimum) && (!maximum || iso <= maximum);

  useEffect(() => setTypedDate(toDisplay(value)), [value]);

  useLayoutEffect(() => {
    if (!open || !canEdit) return;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const edge = 8;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const width = Math.min(316, viewportWidth - edge * 2);
      const height = Math.min(calendarRef.current?.scrollHeight ?? 340, viewportHeight - edge * 2);
      const below = viewportTop + viewportHeight - rect.bottom - edge;
      const desiredTop = below >= height + 7 ? rect.bottom + 7 : rect.top - height - 7;
      const top = Math.max(viewportTop + edge, Math.min(desiredTop, viewportTop + viewportHeight - height - edge));
      const left = Math.max(viewportLeft + edge, Math.min(rect.right - width, viewportLeft + viewportWidth - width - edge));
      setPosition({ top, left, width, maxHeight: viewportHeight - edge * 2 });
    };
    place();
    const frame = requestAnimationFrame(() => {
      place();
      if (focusCalendar.current) {
        const selected = calendarRef.current?.querySelector<HTMLButtonElement>('.is-selected:not(:disabled)')
          ?? calendarRef.current?.querySelector<HTMLButtonElement>('.is-today:not(:disabled)')
          ?? calendarRef.current?.querySelector<HTMLButtonElement>('[data-date]:not(:disabled)');
        selected?.focus({ preventScroll: true });
        focusCalendar.current = false;
      }
    });
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open, canEdit, visibleMonth]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !calendarRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        iconRef.current?.focus({ preventScroll: true });
      }
    };
    const scroll = (event: Event) => {
      if (!calendarRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);

  const firstWeekday = (visibleMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, index) => new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index - firstWeekday + 1));
  const today = toIso(new Date());
  const label = inputProps['aria-label'] ?? tr('Выбрать дату');

  function showCalendar(moveFocus = false) {
    if (!canEdit) return;
    focusCalendar.current = moveFocus;
    setVisibleMonth(monthFor(value || minimum || maximum));
    setOpen(true);
  }

  function choose(next: string) {
    if (next && !allowed(next)) return;
    onChange(next);
    setTypedDate(toDisplay(next));
    setOpen(false);
    iconRef.current?.focus({ preventScroll: true });
  }

  return (
    <div ref={rootRef} className={`date-picker ${open && canEdit ? 'is-open' : ''} ${className}`}>
      <input
        {...inputProps}
        ref={inputRef}
        type="text"
        className="date-picker-input"
        size={10}
        inputMode="numeric"
        placeholder={inputProps.placeholder ?? 'ДД.ММ.ГГГГ'}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open && canEdit}
        aria-controls={open && canEdit ? calendarId : undefined}
        disabled={disabled}
        readOnly={readOnly}
        value={typedDate}
        onFocus={(event) => { onFocus?.(event); }}
        onClick={() => showCalendar()}
        onBlur={(event) => { setTypedDate(toDisplay(value)); onBlur?.(event); }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && event.key === 'ArrowDown') { event.preventDefault(); showCalendar(true); }
        }}
        onChange={(event) => {
          const next = event.target.value;
          setTypedDate(next);
          if (!next) onChange('');
          const parsed = parseDisplay(next);
          if (parsed && allowed(toIso(parsed))) {
            onChange(toIso(parsed));
            setVisibleMonth(monthFor(toIso(parsed)));
          }
        }}
      />
      <button ref={iconRef} type="button" className="date-picker-icon" aria-label={label} aria-haspopup="dialog" aria-expanded={open && canEdit} aria-controls={open && canEdit ? calendarId : undefined} disabled={!canEdit} onClick={() => open ? setOpen(false) : showCalendar(true)}><CalendarIcon /></button>
      {open && canEdit && createPortal(
        <div ref={calendarRef} id={calendarId} className="date-picker-calendar" role="dialog" aria-label={label} style={position ? { ...position, visibility: 'visible' } : { visibility: 'hidden' }}>
          <div className="date-picker-calendar-header">
            <strong aria-live="polite">{tr(months[visibleMonth.getMonth()])} {visibleMonth.getFullYear()} г.</strong>
            <div className="date-picker-calendar-nav">
              <button type="button" aria-label={tr('Предыдущий месяц')} onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}><ArrowIcon /></button>
              <button type="button" aria-label={tr('Следующий месяц')} onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}><ArrowIcon next /></button>
            </div>
          </div>
          <div className="date-picker-calendar-grid" onKeyDown={(event) => {
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-date]'));
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            if (index < 0) return;
            const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
            const nextIndex = event.key === 'Home' ? index - index % 7 : event.key === 'End' ? index + 6 - index % 7 : offset === undefined ? undefined : index + offset;
            if (nextIndex === undefined) return;
            event.preventDefault();
            const next = buttons[nextIndex];
            if (next && !next.disabled) next.focus({ preventScroll: true });
          }}>
            {weekdays.map((day) => <span className="date-picker-calendar-weekday" key={day}>{tr(day)}</span>)}
            {cells.map((cell) => {
              const iso = toIso(cell);
              return <button type="button" key={iso} data-date={iso} disabled={!allowed(iso)} className={`${cell.getMonth() !== visibleMonth.getMonth() ? 'is-outside' : ''} ${value === iso ? 'is-selected' : ''} ${today === iso ? 'is-today' : ''}`} aria-label={toDisplay(iso)} aria-pressed={value === iso} onClick={() => choose(iso)}>{cell.getDate()}</button>;
            })}
          </div>
          <div className="date-picker-calendar-footer">
            <button type="button" onClick={() => choose('')}>{tr('Очистить')}</button>
            <button type="button" disabled={!allowed(today)} onClick={() => choose(today)}>{tr('Сегодня')}</button>
          </div>
        </div>, document.body,
      )}
    </div>
  );
}

/** Сохраняет локальное время смены при выборе другой даты. */
export function DateTimePicker({ value, onChange, className = '', ...props }: Props) {
  const tr = useT();
  const [date = '', time = ''] = value.split('T');
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <DatePicker {...props} className={`flex-1 ${className}`} value={date} min={typeof props.min === 'string' ? props.min.slice(0, 10) : props.min} max={typeof props.max === 'string' ? props.max.slice(0, 10) : props.max} onChange={(next) => onChange(next ? `${next}T${time || '00:00'}` : '')} />
      <input type="time" className="input w-[110px]" aria-label={tr('Время')} disabled={props.disabled} readOnly={props.readOnly} value={time.slice(0, 5)} onChange={(event) => { const next = event.target.value; onChange(next ? `${date || toIso(new Date())}T${next}` : ''); }} />
    </div>
  );
}

function ArrowIcon({ next = false }: { next?: boolean }) {
  return <svg className={next ? 'is-next' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>;
}
