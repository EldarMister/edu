import { type PointerEvent, type ReactNode, useEffect, useRef } from 'react';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  panelClassName = 'max-w-md',
  suspended = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  panelClassName?: string;
  suspended?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; time: number; active: boolean; offset: number } | null>(null);
  const dismissTimer = useRef<number>();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => () => window.clearTimeout(dismissTimer.current), [open]);
  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add('modal-open');
    document.body.classList.add('modal-open');
    return () => {
      if (document.querySelector('.modal-backdrop')) return;
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
    };
  }, [open]);
  useEffect(() => {
    if (!open || suspended) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panel.current === Array.from(document.querySelectorAll('[data-modal-panel]')).at(-1)) close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, suspended]);

  function move(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    const node = panel.current;
    if (!start || !node) return;
    const distance = event.clientY - start.y;
    if (!start.active && Math.abs(distance) < 8) return;
    start.active = true;
    node.style.animation = 'none';
    node.style.transition = 'none';
    const offset = start.offset + distance;
    node.style.transform = `translateY(${offset < 0 ? offset * 0.2 : offset}px)`;
  }

  function finish(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    drag.current = null;
    const node = panel.current;
    if (!node || !start) return;
    const distance = event.clientY - start.y;
    const speed = distance / Math.max(1, event.timeStamp - start.time);
    if (start.active && event.type === 'pointerup' && (distance > Math.min(120, node.offsetHeight * 0.3) || (distance > 20 && speed > 0.55))) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        close.current();
        return;
      }
      node.style.transition = 'transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1)';
      node.style.transform = 'translateY(100%)';
      dismissTimer.current = window.setTimeout(() => {
        dismissTimer.current = undefined;
        close.current();
      }, 300);
      return;
    }
    node.style.transition = 'transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    node.style.transform = 'translateY(0)';
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4" style={suspended ? { visibility: 'hidden' } : undefined} aria-hidden={suspended || undefined}>
      <div
        ref={panel}
        data-modal-panel
        role="dialog"
        aria-modal={!suspended}
        aria-label={title}
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={`card relative z-10 flex w-full flex-col rounded-b-none max-sm:motion-safe:animate-panel-open sm:rounded-2xl ${panelClassName}`}
        // dvh (динамическая высота вьюпорта) учитывает адресную строку браузера —
        // иначе на низких телефонах низ модалки с кнопками уезжает за экран.
        style={{ maxHeight: 'calc(92dvh - env(safe-area-inset-bottom, 0px))' }}
      >
        <button type="button" aria-label="Закрыть панель" className="flex h-7 shrink-0 touch-none items-center justify-center sm:hidden"
          onClick={(event) => { if (event.detail === 0) close.current(); }}
          onPointerDown={(event) => {
            const node = panel.current;
            if (!node || !event.isPrimary || event.button !== 0) return;
            window.clearTimeout(dismissTimer.current);
            dismissTimer.current = undefined;
            event.currentTarget.setPointerCapture(event.pointerId);
            const transform = getComputedStyle(node).transform;
            const offset = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
            node.style.animation = 'none';
            node.style.transition = 'none';
            node.style.transform = `translateY(${offset}px)`;
            drag.current = { y: event.clientY, time: event.timeStamp, active: false, offset };
          }}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
        ><span className="h-1 w-[34px] rounded-full bg-slate-300" /></button>
        {title && (
          <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
            <h3 className="text-base font-semibold text-text-primary">{title}</h3>
            <button onClick={onClose} className="text-text-light hover:text-text-secondary" aria-label="Закрыть">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-border px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
