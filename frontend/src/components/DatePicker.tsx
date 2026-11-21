import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/lib/i18n';
import {
  dateToIso as toIso,
  dateToDisplay as toDisplay,
  parseDateDisplay as parseDisplay,
  validateDateInput,
  isCompleteTime,
  nextDateTimeForTime,
} from './date-picker-values';
import './date-picker.css';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  openOnMount?: boolean;
  onValidityChange?: (valid: boolean) => void;
  containerClassName?: string;
};

const weekdays = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const months = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function monthFor(value: string): Date {
  const date = parseDisplay(toDisplay(value)) ?? new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function CalendarIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></svg>;
}

export function DatePicker({ value, onChange, onValidityChange, className = '', containerClassName = '', min, max, disabled, readOnly, openOnMount = false, onFocus, onBlur, onKeyDown, ...inputProps }: Props) {
  const tr = useT();
  const calendarId = useId();
  const errorId = useId();
  const [open, setOpen] = useState(openOnMount);
  const [typedDate, setTypedDate] = useState(() => toDisplay(value));
  const [touched, setTouched] = useState(false);
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
  const validation = validateDateInput(typedDate, { min: minimum, max: maximum, required: inputProps.required });
  const error = validation.error === 'required' ? tr('Укажите дату')
    : validation.error === 'format' ? tr('Введите дату в формате ДД.ММ.ГГГГ')
    : validation.error === 'min' ? `${tr('Дата не раньше')} ${toDisplay(minimum)}`
    : validation.error === 'max' ? `${tr('Дата не позже')} ${toDisplay(maximum)}`
    : '';
  const visibleError = canEdit && (touched || typedDate.length >= 10) ? error : '';

  useEffect(() => { setTypedDate(toDisplay(value)); setTouched(false); }, [value]);
  useEffect(() => {
    inputRef.current?.setCustomValidity(error);
    onValidityChange?.(!validation.error);
  }, [error, validation.error, onValidityChange]);

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
    setTouched(false);
    setOpen(false);
    iconRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className={`date-picker-field ${containerClassName}`}>
    <div ref={rootRef} className={`date-picker ${open && canEdit ? 'is-open' : ''} ${visibleError ? 'is-invalid' : ''} ${className}`}>
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
        aria-invalid={validation.error ? true : inputProps['aria-invalid']}
        aria-describedby={[inputProps['aria-describedby'], visibleError ? errorId : ''].filter(Boolean).join(' ') || undefined}
        disabled={disabled}
        readOnly={readOnly}
        value={typedDate}
        onFocus={(event) => { onFocus?.(event); }}
        onClick={() => showCalendar()}
        onBlur={(event) => { setTouched(true); onBlur?.(event); }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && event.key === 'ArrowDown') { event.preventDefault(); showCalendar(true); }
        }}
        onChange={(event) => {
          const next = event.target.value;
          setTypedDate(next);
          if (!next) onChange('');
          const result = validateDateInput(next, { min: minimum, max: maximum, required: inputProps.required });
          if (result.value) {
            onChange(result.value);
            setVisibleMonth(monthFor(result.value));
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
    {visibleError && <span id={errorId} className="date-picker-error" role="alert">{visibleError}</span>}
    </div>
  );
}

/** Сохраняет локальное время смены при выборе другой даты. */
export function DateTimePicker({ value, onChange, onValidityChange, className = '', containerClassName = '', ...props }: Props) {
  const tr = useT();
  const [date = '', time = ''] = value.split('T');
  const [typedTime, setTypedTime] = useState(() => time.slice(0, 5));
  const [timeTouched, setTimeTouched] = useState(false);
  const [dateValid, setDateValid] = useState(() => !validateDateInput(toDisplay(date), {
    required: props.required,
    min: typeof props.min === 'string' ? props.min.slice(0, 10) : '',
    max: typeof props.max === 'string' ? props.max.slice(0, 10) : '',
  }).error);
  const timeRef = useRef<HTMLInputElement>(null);
  const timeEdited = useRef(false);
  const emittedValue = useRef<string | null>(null);
  const timeErrorId = useId();
  const timeInvalid = !!(date || props.required || typedTime) && !isCompleteTime(typedTime);
  const timeError = timeInvalid ? (typedTime ? tr('Введите время в формате ЧЧ:ММ') : tr('Укажите время')) : '';

  useEffect(() => {
    if (emittedValue.current === value) {
      emittedValue.current = null;
      return;
    }
    setTypedTime(time.slice(0, 5));
    setTimeTouched(false);
    timeEdited.current = false;
  }, [value, time]);
  useEffect(() => {
    timeRef.current?.setCustomValidity(timeError);
    onValidityChange?.(dateValid && !timeInvalid);
  }, [dateValid, timeInvalid, timeError, onValidityChange]);

  function emit(next: string) {
    emittedValue.current = next;
    onChange(next);
  }

  function changeDate(next: string) {
    if (!next) {
      setTypedTime('');
      setTimeTouched(false);
      timeEdited.current = false;
      emit('');
      return;
    }
    const nextTime = isCompleteTime(typedTime) ? typedTime : isCompleteTime(time.slice(0, 5)) ? time.slice(0, 5) : '00:00';
    if (!timeEdited.current) setTypedTime(nextTime);
    emit(`${next}T${nextTime}`);
  }

  return (
    <div className="flex min-w-0 flex-wrap items-start gap-2">
      <DatePicker {...props} containerClassName={`flex-1 ${containerClassName}`} className={`w-full ${className}`} value={date} min={typeof props.min === 'string' ? props.min.slice(0, 10) : props.min} max={typeof props.max === 'string' ? props.max.slice(0, 10) : props.max} onChange={changeDate} onValidityChange={setDateValid} />
      <input
        ref={timeRef}
        type="time"
        className="input w-[110px]"
        aria-label={tr('Время')}
        aria-invalid={timeInvalid || undefined}
        aria-describedby={timeTouched && timeError ? timeErrorId : undefined}
        disabled={props.disabled}
        readOnly={props.readOnly}
        required={props.required || !!date}
        value={typedTime}
        onBlur={() => setTimeTouched(true)}
        onChange={(event) => {
          const next = event.target.value;
          timeEdited.current = true;
          setTypedTime(next);
          const committed = nextDateTimeForTime(value, next, toIso(new Date()));
          if (committed !== undefined && dateValid) emit(committed);
        }}
      />
      {timeTouched && timeError && <p id={timeErrorId} className="date-time-error w-full text-xs text-danger" role="alert">{timeError}</p>}
    </div>
  );
}

function ArrowIcon({ next = false }: { next?: boolean }) {
  return <svg className={next ? 'is-next' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>;
}
