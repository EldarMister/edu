import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Кастомный селект в стиле UI (нативный <select> нельзя стилизовать).
 * Меню рендерится в портал с fixed-позиционированием, поэтому не обрезается
 * модалкой и панелями с overflow.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = 'Выберите',
  className = '',
  disabled = false,
  ariaLabel,
  ariaInvalid,
  ariaDescribedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const id = useId();
  const typeahead = useRef({ text: '', time: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number; workspace: boolean } | null>(null);

  const selected = options.find((o) => o.value === value);

  function place() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    const edge = 8;
    const workspace = !!el.closest('.poster-workspace');
    const desiredHeight = Math.min(256, options.length * (workspace ? 34 : 40) + 8);
    const spaceBelow = window.innerHeight - r.bottom - edge;
    const spaceAbove = r.top - edge;
    const openUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.max(80, Math.min(256, (openUp ? spaceAbove : spaceBelow) - gap));
    const top = openUp ? Math.max(edge, r.top - gap - Math.min(desiredHeight, maxHeight)) : r.bottom + gap;
    const width = Math.min(Math.max(r.width, 160), window.innerWidth - edge * 2);
    setPos({ top, left: Math.max(edge, Math.min(r.left, window.innerWidth - width - edge)), width, maxHeight, workspace });
  }

  function closeAndFocus() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  function showMenu(fromEnd = false) {
    const selectedIndex = options.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : fromEnd ? options.length - 1 : 0);
    typeahead.current = { text: '', time: 0 };
    setOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Tab') {
      if (open) closeAndFocus();
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        showMenu(event.key === 'ArrowUp' || event.key === 'End');
        if (event.key === 'Home') setActiveIndex(0);
        if (event.key === 'End') setActiveIndex(options.length - 1);
      }
      else setActiveIndex((index) => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % Math.max(1, options.length));
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      if (options[activeIndex]) onChange(options[activeIndex].value);
      closeAndFocus();
      return;
    }
    if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const character = event.key.toLocaleLowerCase();
      const previous = now - typeahead.current.time < 700 ? typeahead.current.text : '';
      const search = previous === character ? character : previous + character;
      typeahead.current = { text: search, time: now };
      const start = open ? activeIndex : options.findIndex((option) => option.value === value);
      for (let offset = 1; offset <= options.length; offset += 1) {
        const index = (start + offset + options.length) % options.length;
        if (options[index].label.toLocaleLowerCase().startsWith(search)) {
          setActiveIndex(index);
          break;
        }
      }
      if (!open) setOpen(true);
    }
  }

  useLayoutEffect(() => {
    if (open) place();
  }, [open, options.length]);

  useLayoutEffect(() => {
    if (!open || !pos) return;
    menuRef.current?.focus({ preventScroll: true });
    menuRef.current?.querySelector(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, pos, activeIndex]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const close = (e?: Event) => {
      const t = e?.target as Node | null;
      if (t && (triggerRef.current?.contains(t) || menuRef.current?.contains(t))) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        id={id}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        disabled={disabled}
        onClick={() => open ? setOpen(false) : showMenu()}
        onKeyDown={handleKeyDown}
        className={`flex items-center justify-between gap-2 rounded-xl border bg-white px-3.5 text-left text-[15px] outline-none transition-colors ${
          open ? 'border-primary ring-2 ring-primary/15' : 'border-border hover:border-primary/40'
        } focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <span className={`truncate ${selected ? 'text-text-primary' : 'text-text-light'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-text-light transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            id={`${id}-listbox`}
            role="listbox"
            aria-labelledby={id}
            aria-activedescendant={options[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            data-radio-blocking
            className={`fixed z-[70] overflow-y-auto rounded-xl border border-border bg-white p-1 shadow-soft outline-none ${pos.workspace ? 'poster-select-menu' : ''}`}
            style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
          >
            {options.length === 0 && <div className="px-3 py-2 text-sm text-text-muted">Нет доступных вариантов</div>}
            {options.map((o, index) => {
              const active = o.value === value;
              return (
                <button
                  key={o.value}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={active}
                  data-option-index={index}
                  data-highlighted={index === activeIndex}
                  tabIndex={-1}
                  type="button"
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => {
                    onChange(o.value);
                    closeAndFocus();
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[15px] transition-colors ${
                    active
                      ? 'bg-primary/5 font-medium text-primary'
                      : index === activeIndex ? 'bg-background text-text-primary' : 'text-text-secondary hover:bg-background'
                  }`}
                >
                  <span className="min-w-0 break-words">{o.label}</span>
                  {active && (
                    <svg
                      className="h-4 w-4 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m5 12 5 5 9-9" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
