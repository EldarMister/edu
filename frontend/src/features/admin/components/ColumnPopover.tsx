import { useLayoutEffect, useRef, type KeyboardEventHandler, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/lib/i18n';
import './column-popover.css';

export function ColumnPopover({ anchor, onClose, children, onReset, title, align = 'end' }: {
  anchor: HTMLButtonElement;
  onClose: () => void;
  children: ReactNode;
  onReset?: () => void;
  title?: string;
  align?: 'start' | 'end';
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const t = useT();
  const heading = title ?? t('Отображать столбцы');

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const gap = 10;
    function place() {
      if (!element || !anchor.isConnected) { close.current(); return; }
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(270, window.innerWidth - 2 * gap);
      const anchorEdge = align === 'start' ? rect.left : rect.right - width;
      const left = Math.max(gap, Math.min(anchorEdge, window.innerWidth - width - gap));
      const below = window.innerHeight - rect.bottom - 2 * gap;
      const above = rect.top - 2 * gap;
      const openAbove = below < 320 && above > below;
      const pointer = Math.min(width - 16, Math.max(16, rect.left + rect.width / 2 - left));
      element.style.width = `${width}px`;
      element.style.left = `${left}px`;
      element.style.maxHeight = `${Math.max(0, openAbove ? above : below)}px`;
      element.style.top = openAbove ? 'auto' : `${rect.bottom + gap}px`;
      element.style.bottom = openAbove ? `${window.innerHeight - rect.top + gap}px` : 'auto';
      element.style.setProperty('--column-pointer', `${pointer}px`);
      element.dataset.side = openAbove ? 'above' : 'below';
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
    element.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')?.focus({ preventScroll: true });
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
  }, [align, anchor]);

  return createPortal(
    <div ref={panel} role="dialog" aria-label={heading} className="column-popover"
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== anchor) onClose();
      }}>
      <h3 className="column-popover-title">{heading}</h3>
      <div className="column-popover-options app-scrollbar-subtle">{children}</div>
      {onReset && <div className="column-popover-footer">
        <button type="button" onClick={onReset}>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 8a7 7 0 1 1-1.5 8M7 4v4h4" />
          </svg>
          {t('Сбросить')}
        </button>
      </div>}
    </div>,
    document.body,
  );
}

export function ColumnCheckbox({ checked, disabled, children, onChange, onKeyDown }: {
  checked: boolean;
  disabled?: boolean;
  children: ReactNode;
  onChange: (checked: boolean) => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}) {
  return <label className="column-checkbox">
    <input type="checkbox" checked={checked} disabled={disabled} onKeyDown={onKeyDown}
      aria-keyshortcuts={onKeyDown ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
      onChange={(event) => onChange(event.target.checked)} />
    <span>{children}</span>
  </label>;
}
