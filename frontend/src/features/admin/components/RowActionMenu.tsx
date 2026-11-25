import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconTrash } from './icons';

function menuPosition(anchor: HTMLButtonElement | null) {
  const rect = anchor?.getBoundingClientRect();
  if (!rect || rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return null;
  return {
    top: rect.bottom + 52 < window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - 52),
    left: Math.max(8, Math.min(window.innerWidth - 184, rect.right - 176)),
  };
}

export function RowActionMenu({ label, action, onAction }: { label: string; action: string; onAction: () => void }) {
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
    };
    const reposition = () => setPosition((current) => {
      if (!current) return current;
      const next = menuPosition(trigger.current);
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
  }, [open]);

  return <>
    <button ref={trigger} type="button" className="rounded px-1 text-primary hover:bg-background"
      aria-label={'Другие действия: ' + label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setPosition(open ? null : menuPosition(trigger.current))}>•••</button>
    {position && createPortal(
      <div ref={menu} id={id} role="menu" aria-label={label} style={position}
        className="fixed z-[70] w-44 rounded-md border border-border bg-card p-1 text-sm shadow-lg">
        <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded px-3 py-2.5 text-left text-danger hover:bg-background"
          onClick={() => {
            setPosition(null);
            trigger.current?.focus({ preventScroll: true });
            onAction();
          }}>{action === 'Удалить' && <IconTrash className="h-4 w-4 shrink-0" aria-hidden="true" />}{action}</button>
      </div>,
      document.body,
    )}
  </>;
}
