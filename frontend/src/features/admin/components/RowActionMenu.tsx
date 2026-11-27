import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconTrash } from './icons';

function menuPosition(anchor: HTMLButtonElement | null, count: number) {
  const rect = anchor?.getBoundingClientRect();
  if (!rect || rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return null;
  const height = count * 40 + 12;
  return {
    top: rect.bottom + height < window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height),
    left: Math.max(8, Math.min(window.innerWidth - 184, rect.right - 176)),
  };
}

type RowAction = { label: string; onAction: () => void; danger?: boolean };
type RowActionMenuProps = { label: string } & ({ actions: RowAction[] } | { action: string; onAction: () => void });

export function RowActionMenu(props: RowActionMenuProps) {
  const { label } = props;
  const actions: RowAction[] = 'actions' in props ? props.actions : [{ label: props.action, onAction: props.onAction, danger: true }];
  const count = actions.length;
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const open = position !== null;

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector('button')?.focus({ preventScroll: true });
    const close = () => setPosition(null);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        trigger.current?.focus({ preventScroll: true });
      }
      if (event.key === 'Tab') close();
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !menu.current?.contains(document.activeElement)) return;
      event.preventDefault();
      const items = Array.from(menu.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const current = items.findIndex((item) => item === document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (current + items.length + (event.key === 'ArrowDown' ? 1 : -1)) % items.length;
      items[next]?.focus({ preventScroll: true });
    };
    const reposition = () => setPosition((current) => {
      if (!current) return current;
      const next = menuPosition(trigger.current, count);
      return next?.top === current.top && next.left === current.left ? current : next;
    });
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', reposition, { capture: true, passive: true });
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, count]);

  return <>
    <button ref={trigger} type="button" className="rounded px-1 text-primary hover:bg-background"
      aria-label={'Другие действия: ' + label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setPosition(open ? null : menuPosition(trigger.current, count))}>•••</button>
    {position && createPortal(
      <div ref={menu} id={id} role="menu" aria-label={label} style={position}
        className="fixed z-[70] w-44 rounded-md border border-border bg-card p-1 text-sm shadow-lg">
        {actions.map((action) => <button key={action.label} type="button" role="menuitem"
          className={'flex w-full items-center gap-2 rounded px-3 py-2.5 text-left hover:bg-background ' + (action.danger ? 'text-danger' : 'text-text-primary')}
          onClick={() => {
            setPosition(null);
            trigger.current?.focus({ preventScroll: true });
            action.onAction();
          }}>{action.label === 'Удалить' && <IconTrash className="h-4 w-4 shrink-0" aria-hidden="true" />}{action.label}</button>)}
      </div>,
      document.body,
    )}
  </>;
}
