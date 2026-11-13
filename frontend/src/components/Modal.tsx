import { SheetHandle } from '@/components/SheetHandle';
import { type ReactNode, useEffect, useRef } from 'react';

let openModalCount = 0;

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  panelClassName = 'max-w-md',
  suspended = false,
  bottomSheet = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  panelClassName?: string;
  suspended?: boolean;
  bottomSheet?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    openModalCount += 1;
    document.documentElement.classList.add('modal-open');
    document.body.classList.add('modal-open');
    return () => {
      openModalCount -= 1;
      if (openModalCount > 0) return;
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

  if (!open) return null;

  return (
    <div className={`modal-backdrop z-[60] flex items-end justify-center p-0 ${bottomSheet ? '' : 'sm:items-center sm:p-4'}`} style={suspended ? { visibility: 'hidden' } : undefined} aria-hidden={suspended || undefined}>
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panel}
        data-modal-panel
        role="dialog"
        aria-modal={!suspended}
        aria-label={title}
        className={`card relative z-10 flex w-full flex-col rounded-b-none ${bottomSheet ? 'motion-safe:animate-panel-open' : 'max-sm:motion-safe:animate-panel-open sm:rounded-2xl'} ${panelClassName}`}
        // dvh (динамическая высота вьюпорта) учитывает адресную строку браузера —
        // иначе на низких телефонах низ модалки с кнопками уезжает за экран.
        style={{ maxHeight: 'calc(92dvh - env(safe-area-inset-bottom, 0px))' }}
      >
        <SheetHandle panel={panel} onClose={onClose} enabled={!suspended} className={bottomSheet ? '' : 'sm:hidden'} />
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
