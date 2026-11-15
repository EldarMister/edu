import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './balance-workspace.css';

export function warehouseMultiFilterValues(value: string): string[] {
  if (!value) return [];
  if (value.startsWith('[')) {
    try {
      const values: unknown = JSON.parse(value);
      if (Array.isArray(values) && values.every((item) => typeof item === 'string')) return values;
    } catch { /* Older links contain a single plain-text selection. */ }
  }
  return [value];
}

export function WarehouseMultiFilter({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0, width: 280, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const selected = warehouseMultiFilterValues(value);
  const visible = options.filter((option) => option.label.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')));
  const choose = (values: string[]) => onChange(values.length ? JSON.stringify(values) : '');

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const roomBelow = window.innerHeight - rect.bottom - 16;
    const below = roomBelow >= 220 || roomBelow >= rect.top - 16;
    const height = Math.min(340, below ? roomBelow : rect.top - 16);
    setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: below ? rect.bottom + 6 : Math.max(12, rect.top - height - 6),
      maxHeight: Math.max(80, height) });
    searchInput.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (trigger.current?.contains(event.target as Node) || panel.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const close = (event: Event) => {
      if (panel.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return <div className="poster-balance-filter" data-active={selected.length ? 'true' : undefined}>
    <button ref={trigger} type="button" className="poster-balance-filter-trigger" aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? id : undefined} aria-label={selected.length ? `${label}: выбрано ${selected.length}` : label}
      onClick={() => { setOpen(!open); setSearch(''); }}>
      {label}{selected.length > 0 && <span className="poster-balance-filter-count">{selected.length}</span>}
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="m2 4 4 4 4-4Z" /></svg>
    </button>
    {selected.length > 0 && <button type="button" className="poster-balance-filter-clear" aria-label={`Очистить фильтр «${label}»`}
      onClick={() => choose([])}>×</button>}
    {open && createPortal(<div ref={panel} id={id} className="poster-balance-filter-panel" role="dialog" aria-label={`Фильтр: ${label}`}
      style={position} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      }} onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && !trigger.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}>
      <div className="poster-balance-filter-commands">
        <button type="button" onClick={() => choose(options.map((option) => option.value))}>Выбрать все</button>
        <button type="button" onClick={() => choose([])}>Очистить</button>
      </div>
      <input ref={searchInput} className="input" type="search" aria-label={`Поиск: ${label}`} placeholder="Поиск" value={search} onChange={(event) => setSearch(event.target.value)} />
      <div className="poster-balance-filter-options" role="group" aria-label={label}>
        {visible.map((option) => <label key={option.value} data-selected={selected.includes(option.value) ? 'true' : undefined}>
          <input type="checkbox" checked={selected.includes(option.value)} onChange={(event) => choose(event.target.checked
            ? [...selected, option.value] : selected.filter((item) => item !== option.value))} />
          <span>{option.label}</span>
        </label>)}
        {!visible.length && <p>Ничего не найдено</p>}
      </div>
    </div>, document.body)}
  </div>;
}
