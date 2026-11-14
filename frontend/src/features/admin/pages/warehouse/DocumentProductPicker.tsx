import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type ProductChoice = { id: string; name: string; unit?: string; barcode?: string | null; group?: string; detail?: string };
type PopupPosition = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };

/** Keep the selected ID until the user explicitly chooses another product. */
export function DocumentProductPicker({
  value,
  options,
  onChange,
  disabled,
  label = 'Продукт',
  fallbackName,
  loading = false,
  loadError,
  onRetry,
  error,
}: {
  value: string;
  options: ProductChoice[];
  onChange: (id: string) => void;
  disabled?: boolean;
  label?: string;
  fallbackName?: string;
  loading?: boolean;
  loadError?: string;
  onRetry?: () => void;
  error?: string;
}) {
  const listId = useId();
  const selecting = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selectedName = options.find((option) => option.id === value)?.name ?? fallbackName ?? '';
  const [text, setText] = useState(selectedName);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<PopupPosition>();
  const unavailable = loading || !!loadError;
  const matches = unavailable ? [] : options.filter((option) =>
    `${option.name} ${option.barcode ?? ''} ${option.group ?? ''} ${option.detail ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));

  useEffect(() => {
    setText(selectedName);
  }, [selectedName, value]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    function place(event?: Event) {
      if (event?.target instanceof Node && list.current?.contains(event.target)) return;
      const rect = field.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const upward = below < 180 && above > below;
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        width,
        maxHeight: Math.max(72, Math.min(260, upward ? above : below)),
        ...(upward ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (
        !(event.target instanceof Node) ||
        field.current?.contains(event.target) ||
        list.current?.contains(event.target)
      )
        return;
      setOpen(false);
      setText(selectedName);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, selectedName]);
  useEffect(() => {
    if (open)
      list.current
        ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, search, position]);

  function choose(option: ProductChoice) {
    if (option.id !== value) onChange(option.id);
    setText(option.name);
    setOpen(false);
    selecting.current = true;
    input.current?.focus({ preventScroll: true });
    selecting.current = false;
  }
  function show() {
    if (disabled) return;
    setSearch('');
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.id === value),
      ),
    );
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setText(selectedName);
  }

  return (
    <div ref={field} className="relative min-w-0">
      <div className="relative">
      <input
        ref={input}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && matches.length ? `${listId}-${activeIndex}` : undefined}
        aria-busy={loading || undefined}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${listId}-error` : undefined}
        className="input h-9 w-full !pr-8"
        value={text}
        disabled={disabled}
        readOnly={unavailable}
        aria-label={label}
        placeholder={loading ? 'Загрузка продуктов…' : loadError ? 'Не удалось загрузить продукты' : 'Выберите продукт…'}
        autoComplete="off"
        onFocus={(event) => {
          if (!selecting.current) {
            show();
            event.currentTarget.select();
          }
        }}
        onClick={() => {
          if (!open) show();
        }}
        onChange={(event) => {
          if (unavailable) return;
          setText(event.target.value);
          setSearch(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onBlur={(event) => {
          if (!list.current?.contains(event.relatedTarget as Node | null)) close();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) show();
            else
              setActive((current) =>
                Math.max(0, Math.min(matches.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))),
              );
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (open && matches[activeIndex]) choose(matches[activeIndex]);
            else show();
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            close();
          } else if (event.key === 'Tab') close();
        }}
      />
      <svg
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
      >
        <path d="m2 4 4 4 4-4" strokeWidth="1.5" />
      </svg>
      </div>
      {error && <p id={`${listId}-error`} className="mt-1 text-left text-xs text-danger">{error}</p>}
      {open &&
        position &&
        createPortal(
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label={label}
            style={position}
            className="fixed z-[90] overflow-y-auto rounded-[3px] border border-border bg-white py-1 text-sm text-text-primary shadow-lg"
          >
            {loading ? (
              <p role="status" className="px-3 py-3 text-text-muted">Загрузка продуктов…</p>
            ) : loadError ? (
              <div className="px-3 py-3">
                <p role="alert" className="text-danger">{loadError}</p>
                {onRetry && <button type="button" className="mt-2 text-primary" onClick={() => { onRetry(); input.current?.focus({ preventScroll: true }); }}>Повторить загрузку</button>}
              </div>
            ) : matches.length ? (
              matches.map((option, index) => (
                <Fragment key={option.id}>
                {option.group && (index === 0 || matches[index - 1].group !== option.group) && <div role="presentation" className="bg-background px-3 py-2 text-xs font-semibold text-text-secondary">{option.group}</div>}
                <button
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={option.id === value}
                  data-index={index}
                  className={`flex min-h-9 w-full items-center justify-between gap-3 px-3 py-2 text-left ${index === activeIndex ? 'bg-primary/10 text-primary' : 'hover:bg-background'}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                >
                  <span className="min-w-0 break-words">{option.name}{option.detail && <span className="mt-0.5 block text-xs text-text-muted">{option.detail}</span>}</span>
                  <span className="shrink-0 text-xs text-text-muted">
                    {[option.unit, option.barcode].filter(Boolean).join(' · ')}
                    {option.id === value ? ' ✓' : ''}
                  </span>
                </button>
                </Fragment>
              ))
            ) : (
              <p role="status" className="px-3 py-3 text-text-muted">{search.trim() ? 'Продукты не найдены. Попробуйте другое название.' : 'Нет доступных продуктов'}</p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
