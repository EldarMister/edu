import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/lib/i18n';
import { IconTables } from './icons';

export function ColumnSettingsButton({ expanded, className = 'btn-secondary btn-md', ...props }: {
  expanded: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const t = useT();
  return <button type="button" className={`inline-flex items-center gap-1.5 ${className}`} aria-haspopup="dialog" aria-expanded={expanded} {...props}>
    <IconTables className="h-4 w-4 shrink-0" /> {t('Столбцы')}
    <svg aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${expanded ? 'rotate-180' : ''}`}
      viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="m4 6 4 4 4-4" />
    </svg>
  </button>;
}

export function ColumnPopover({ anchor, onClose, children, footer }: {
  anchor: HTMLButtonElement;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const t = useT();

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const margin = 8;
    function place() {
      if (!element || !anchor.isConnected) { close.current(); return; }
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(304, window.innerWidth - 2 * margin);
      const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
      const below = window.innerHeight - rect.bottom - 2 * margin;
      const above = rect.top - 2 * margin;
      const openAbove = below < 360 && above > below;
      element.style.width = `${width}px`;
      element.style.left = `${left}px`;
      element.style.maxHeight = `${Math.min(490, Math.max(100, openAbove ? above : below))}px`;
      element.style.top = openAbove ? 'auto' : `${Math.max(margin, rect.bottom + margin)}px`;
      element.style.bottom = openAbove ? `${window.innerHeight - rect.top + margin}px` : 'auto';
    }
    function closeFromKeyboard(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      close.current();
      anchor.focus();
    }
    function closeFromPointer(event: PointerEvent) {
      if (event.target instanceof Node && !element?.contains(event.target) && !anchor.contains(event.target)) close.current();
    }
    place();
    element.querySelector<HTMLElement>('input:not([disabled]), button')?.focus({ preventScroll: true });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('keydown', closeFromKeyboard);
    document.addEventListener('pointerdown', closeFromPointer);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('keydown', closeFromKeyboard);
      document.removeEventListener('pointerdown', closeFromPointer);
    };
  }, [anchor]);

  return createPortal(
    <div ref={panel} role="dialog" aria-label={t('Отображать столбцы')}
      className="fixed z-[75] flex flex-col overflow-hidden rounded-xl border border-border bg-card px-3 shadow-soft"
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== anchor) onClose();
      }}>
      <h3 className="shrink-0 border-b border-border px-1 py-3 text-sm font-semibold">{t('Отображать столбцы')}</h3>
      <div className="app-scrollbar-subtle min-h-0 overflow-y-auto py-1">{children}</div>
      {footer && <div className="shrink-0 border-t border-border py-2">{footer}</div>}
    </div>,
    document.body,
  );
}

export function ColumnCheckbox({ checked, disabled, children, onChange }: {
  checked: boolean;
  disabled?: boolean;
  children: ReactNode;
  onChange: (checked: boolean) => void;
}) {
  return <label className="flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1.5 text-sm hover:bg-background">
    <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={checked} disabled={disabled}
      onChange={(event) => onChange(event.target.checked)} />
    <span className={disabled ? 'text-text-muted' : undefined}>{children}</span>
  </label>;
}
