import { useEffect, useRef, useState, type ReactNode } from 'react';
import { resolveApiImage } from '@/lib/image';

const SHEET_MS = 260;
const SHEET_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const SHEET_CLOSE_DRAG_PX = 190;

/** Логотип EDU MENU — картинка из public. */
export function EduMenuLogo() {
  return <img src="/iconmenu.png" alt="EDU MENU" className="h-5 w-auto select-none" />;
}

/** Шапка экранов QR-меню: логотип слева, «Стол N» справа. */
export function QrHeader({ tableNumber }: { tableNumber: number }) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3">
      <EduMenuLogo />
      <span className="rounded-full bg-background px-3 py-1 text-[13px] font-semibold text-text-secondary">
        Стол {tableNumber}
      </span>
    </header>
  );
}

/** Экран завершённого визита: стол закрыт официантом, заказывать нельзя. */
export function ClosedScreen({
  tableNumber,
  busy = false,
  onNewOrder,
}: {
  tableNumber: number;
  busy?: boolean;
  onNewOrder: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <QrHeader tableNumber={tableNumber} />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <h2 className="text-[19px] font-semibold text-text-primary">Заказ завершён</h2>
          <p className="mt-1.5 text-[14px] leading-5 text-text-secondary">
            Спасибо, что были у нас! Этот заказ закрыт.
          </p>
          <p className="mt-1 text-[13px] text-text-muted">
            Чтобы заказать снова, начните новый заказ.
          </p>
        </div>
        <button type="button" onClick={onNewOrder} disabled={busy} className="btn-primary btn-md w-full max-w-xs">
          Сделать новый заказ
        </button>
      </div>
    </div>
  );
}

/** Маленькая зелёная точка online. */
export function OnlineDot({ on = true }: { on?: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${on ? 'bg-success' : 'bg-text-light'}`}
      aria-hidden
    />
  );
}

/** Степпер количества: − N + */
export function QtyStepper({
  value,
  onChange,
  min = 1,
  size = 'md',
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  size?: 'sm' | 'md';
}) {
  const btn =
    size === 'sm'
      ? 'h-8 w-8 text-base'
      : 'h-10 w-10 text-lg';
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className={`${btn} flex items-center justify-center rounded-full border border-border bg-white font-semibold text-primary transition-colors hover:bg-background disabled:opacity-40`}
        aria-label="Меньше"
      >
        −
      </button>
      <span className={`min-w-6 text-center font-semibold text-text-primary ${size === 'sm' ? 'text-sm' : ''}`}>
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className={`${btn} flex items-center justify-center rounded-full border border-border bg-white font-semibold text-primary transition-colors hover:bg-background`}
        aria-label="Больше"
      >
        +
      </button>
    </div>
  );
}

/** Bottom-sheet: затемнение + панель, выезжающая снизу. */
export function BottomSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [render, setRender] = useState(open);
  const [visible, setVisible] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setRender(true);
      setDrag(0);
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    setVisible(false);
    const id = setTimeout(() => setRender(false), SHEET_MS);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!render) return null;

  const sheetTransform = visible ? `translateY(${drag}px)` : 'translateY(100%)';

  function onPointerDown(e: React.PointerEvent) {
    startY.current = e.clientY;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (startY.current === null) return;
    const dy = e.clientY - startY.current;
    setDrag(dy > 0 ? dy : 0);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (startY.current === null) return;
    startY.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragging(false);
    if (drag > SHEET_CLOSE_DRAG_PX) onClose();
    else requestAnimationFrame(() => setDrag(0));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="modal-backdrop"
        style={{ transition: `opacity ${SHEET_MS}ms ease`, opacity: visible ? 1 : 0 }}
        onClick={onClose}
      />
      <div
        className="relative z-10 flex max-h-[88vh] w-full max-w-md flex-col rounded-t-3xl bg-card shadow-soft"
        style={{
          transform: sheetTransform,
          transition: dragging ? 'none' : `transform ${SHEET_MS}ms ${SHEET_EASE}`,
        }}
      >
        <div
          className="shrink-0 cursor-grab touch-none px-5 pb-2 pt-2.5"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="mx-auto h-1 w-12 rounded-full bg-slate-300" />
        </div>
        {children}
      </div>
    </div>
  );
}

/** Центрированная модалка подтверждения (отправка заказа). */
export function ConfirmModal({
  open,
  title,
  text,
  cancelLabel = 'Отмена',
  confirmLabel = 'Отправить',
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  text: string;
  cancelLabel?: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="modal-backdrop animate-fade-in" onClick={onCancel} />
      <div className="animate-card-pop relative z-10 w-full max-w-sm rounded-2xl bg-card p-5 shadow-soft">
        <h3 className="text-[17px] font-semibold text-text-primary">{title}</h3>
        <p className="mt-1.5 text-sm leading-5 text-text-secondary">{text}</p>
        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onCancel} className="btn-secondary btn-md flex-1">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn-primary btn-md flex-1">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const PhotoPlaceholder = ({ className = '' }: { className?: string }) => (
  <div className={`flex items-center justify-center bg-background text-text-light ${className}`}>
    <svg width="40%" height="40%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 7h18v12H3zM3 7l2-3h14l2 3M8 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
);

/** Фото блюда с fallback-заглушкой при отсутствии или ошибке загрузки. */
export function DishPhoto({ src, name, className = '' }: { src: string | null; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const resolved = resolveApiImage(src);
  if (!resolved || failed) return <PhotoPlaceholder className={className} />;
  return (
    <img
      src={resolved}
      alt={name}
      className={`object-cover ${className}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
