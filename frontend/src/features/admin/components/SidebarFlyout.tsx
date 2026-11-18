import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function SidebarFlyout({ id, label, anchor, onClose, children, align = 'start' }: {
  id: string;
  label: string;
  anchor: HTMLButtonElement;
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end';
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const gap = 8;
    function place() {
      if (!element || !anchor.offsetWidth) {
        close.current();
        return;
      }
      const rect = anchor.getBoundingClientRect();
      element.style.left = `${rect.right + gap * 2}px`;
      const top = align === 'end' ? rect.bottom - element.offsetHeight : rect.top;
      element.style.top = `${Math.max(gap, Math.min(top, window.innerHeight - element.offsetHeight - gap))}px`;
    }
    function onOutside(event: PointerEvent) {
      if (event.target instanceof Node && !element?.contains(event.target) && !anchor.contains(event.target)) close.current();
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      close.current();
      anchor.focus();
    }
    place();
    element.querySelector<HTMLElement>('button, a[href]')?.focus({ preventScroll: true });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [anchor, align]);

  return createPortal(
    <div ref={panel} id={id} role="group" aria-label={label}
      className="workspace-sidebar-flyout fixed z-50 max-h-[calc(100dvh-16px)] w-56 overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-soft"
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== anchor) onClose();
      }}>
      {children}
    </div>,
    document.body,
  );
}
