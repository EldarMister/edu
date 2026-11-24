import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string;
  label: string;
  alwaysVisible?: boolean;
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
  searchable = false,
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
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [search, setSearch] = useState('');
  const id = useId();
  const typeahead = useRef({ text: '', time: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number; workspace: boolean } | null>(null);

  const selected = options.find((o) => o.value === value);
  const query = searchable ? search.trim().toLocaleLowerCase() : '';
  const visibleOptions = query ? options.filter((option) => option.alwaysVisible || option.label.toLocaleLowerCase().includes(query)) : options;
  const activeOptionId = visibleOptions[activeIndex] ? `${id}-option-${activeIndex}` : undefined;

  function place() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    const edge = 8;
    const workspace = !!el.closest('.poster-workspace');
    const heightLimit = searchable ? 340 : 256;
    const desiredHeight = Math.min(heightLimit, options.length * (workspace ? 34 : 40) + (searchable ? 56 : 8));
    const spaceBelow = window.innerHeight - r.bottom - edge;
    const spaceAbove = r.top - edge;
    const openUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.max(80, Math.min(heightLimit, (openUp ? spaceAbove : spaceBelow) - gap));
    const top = openUp ? Math.max(edge, r.top - gap - Math.min(desiredHeight, maxHeight)) : r.bottom + gap;
    const width = Math.min(Math.max(r.width, 160), window.innerWidth - edge * 2);
    setPos({ top, left: Math.max(edge, Math.min(r.left, window.innerWidth - width - edge)), width, maxHeight, workspace });
  }

  function closeAndFocus() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  function showMenu(fromEnd = false) {
    setSearch('');
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
    const fromSearch = event.target === searchRef.current;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' ||
      (!fromSearch && (event.key === 'Home' || event.key === 'End'))) {
      event.preventDefault();
      if (!open) {
        showMenu(event.key === 'ArrowUp' || event.key === 'End');
        if (event.key === 'Home') setActiveIndex(0);
        if (event.key === 'End') setActiveIndex(options.length - 1);
      }
      else setActiveIndex((index) => event.key === 'Home' ? 0 : event.key === 'End' ? visibleOptions.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + visibleOptions.length) % Math.max(1, visibleOptions.length));
      return;
    }
    if ((event.key === 'Enter' || (!fromSearch && event.key === ' ')) && open) {
      event.preventDefault();
      if (visibleOptions[activeIndex]) onChange(visibleOptions[activeIndex].value);
      closeAndFocus();
      return;
    }
    if (!searchable && event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
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
  }, [open, options.length, searchable]);

  useLayoutEffect(() => {
    if (!open || !pos) return;
    if (!searchable) menuRef.current?.focus({ preventScroll: true });
    menuRef.current?.querySelector(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, pos, activeIndex, searchable]);

  useLayoutEffect(() => {
    if (open && pos && searchable) searchRef.current?.focus({ preventScroll: true });
  }, [open, pos, searchable]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const close = (event: Event) => {
      // Only a scroll which can move the trigger invalidates the portal position.
      if (event.type === 'scroll' && event.target instanceof Element && !event.target.contains(triggerRef.current)) return;
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
        aria-haspopup={searchable ? 'dialog' : 'listbox'}
        aria-expanded={open}
        aria-controls={open ? `${id}-${searchable ? 'search-panel' : 'listbox'}` : undefined}
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
            id={`${id}-${searchable ? 'search-panel' : 'listbox'}`}
            role={searchable ? 'dialog' : 'listbox'}
            aria-labelledby={id}
            aria-activedescendant={searchable ? undefined : activeOptionId}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            data-radio-blocking
            className={`fixed z-[70] border border-border bg-white shadow-soft outline-none ${searchable
              ? 'flex flex-col rounded-md p-2.5'
              : `overflow-y-auto rounded-xl p-1 ${pos.workspace ? 'poster-select-menu' : ''}`}`}
            style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
          >
            {searchable && <input ref={searchRef} type="search" role="combobox"
              aria-label={ariaLabel ? `Поиск: ${ariaLabel}` : 'Поиск'} aria-expanded="true"
              aria-controls={`${id}-listbox`} aria-activedescendant={activeOptionId}
              className="input mb-2 h-9 shrink-0 rounded-md text-sm" placeholder="Поиск" value={search}
              onChange={(event) => { setSearch(event.target.value); setActiveIndex(0); }} />}
            <div id={searchable ? `${id}-listbox` : undefined} role={searchable ? 'listbox' : undefined}
              aria-labelledby={searchable ? id : undefined}
              className={searchable ? `min-h-0 overflow-y-auto ${pos.workspace ? 'poster-select-menu' : ''}` : 'contents'}>
              {!visibleOptions.length && <div className="px-3 py-2 text-sm text-text-muted">
                {query ? 'Ничего не найдено' : 'Нет доступных вариантов'}
              </div>}
              {visibleOptions.map((o, index) => {
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
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
