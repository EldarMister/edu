import { useEffect, useRef, useState } from 'react';
import { money, dishUnitPrice } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Spinner } from '@/components/Spinner';
import { useCart, cartTotals } from './cart';

/**
 * Корзина как нижний bottom sheet поверх экрана меню.
 * Открывается по тапу на мини-блок корзины над нижней навигацией.
 */
export function CartSheet({
  open,
  onClose,
  onSubmit,
  submitting,
  canSubmit,
}: {
  open: boolean;
  onClose: () => void;
  /** Отправка заказа по текущей логике (create / addItems). */
  onSubmit: () => void;
  submitting: boolean;
  /** Есть ли активная смена (иначе отправка заблокирована вышестоящей логикой). */
  canSubmit: boolean;
}) {
  const t = useT();
  const { lines, inc, dec, clear } = useCart();
  const totals = cartTotals(lines);
  const hasLines = lines.length > 0;

  // Монтирование + анимация входа/выхода.
  const [render, setRender] = useState(open);
  const [visible, setVisible] = useState(false);
  // Свайп вниз для закрытия.
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      setRender(true);
      setDrag(0);
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const id = setTimeout(() => setRender(false), 260);
    return () => clearTimeout(id);
  }, [open]);

  // Закрытие по Escape и по системной кнопке «назад» (Android).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    const onPop = () => onCloseRef.current();
    window.addEventListener('keydown', onKey);
    window.history.pushState({ __cartSheet: true }, '');
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      // Снимаем добавленную запись истории, если она ещё наверху.
      if (window.history.state?.__cartSheet) window.history.back();
    };
  }, [open]);

  if (!render) return null;

  const sheetTransform = visible ? `translateY(${drag}px)` : 'translateY(100%)';

  // Drag вниз для закрытия (pointer events: работает с тачем, мышью и пером).
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
    // Сначала включаем обратно анимацию (dragging=false), затем на следующем
    // кадре сбрасываем смещение — так возврат «немножко» проходит плавно.
    setDragging(false);
    if (drag > 110) onClose();
    else requestAnimationFrame(() => setDrag(0));
  }

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      {/* Затемнение фона */}
      <div
        className="absolute inset-0 bg-black/40"
        style={{ transition: 'opacity 260ms ease', opacity: visible ? 1 : 0 }}
        onClick={onClose}
        aria-hidden
      />

      {/* Лист корзины */}
      <div
        className="absolute inset-x-0 bottom-0 flex max-h-[78vh] flex-col rounded-t-2xl bg-white shadow-soft"
        style={{
          transform: sheetTransform,
          transition: dragging ? 'none' : 'transform 260ms cubic-bezier(0.32, 0.72, 0, 1)',
          paddingBottom: 'calc(58px + env(safe-area-inset-bottom))',
        }}
        role="dialog"
        aria-label={t('Корзина')}
      >
        {/* Шапка с drag handle */}
        <div
          className="shrink-0 cursor-grab touch-none px-4 pb-2 pt-2.5"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-slate-300" />
          <h2 className="text-lg font-semibold text-text-primary">{t('Корзина')}</h2>
        </div>

        {/* Список блюд */}
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4">
          {!hasLines ? (
            <p className="py-12 text-center text-sm text-text-muted">{t('Корзина пуста')}</p>
          ) : (
            <div className="divide-y divide-border">
              {lines.map((l) => {
                const unit = dishUnitPrice(l.dish.price, l.dish.discountType, l.dish.discountValue);
                return (
                  <div key={l.dish.id} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-[15px] text-text-primary">
                      {l.dish.name}
                    </span>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <RoundBtn variant="dec" onClick={() => dec(l.dish.id)} label={t('Уменьшить количество')} />
                      <span className="w-5 text-center text-[15px] font-medium text-text-primary">
                        {l.quantity}
                      </span>
                      <RoundBtn variant="inc" onClick={() => inc(l.dish.id)} label={t('Увеличить количество')} />
                    </div>
                    <span className="w-[68px] shrink-0 text-right text-[15px] font-semibold text-text-primary">
                      {money(unit * l.quantity)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Итог + действия */}
        <div className="shrink-0 px-4 pt-3">
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-[15px] font-medium text-text-secondary">{t('Итого')}</span>
            <span className="text-lg font-semibold text-text-primary">{money(totals.final)}</span>
          </div>

          <button
            className="btn-primary mt-3 h-12 w-full rounded-lg font-semibold disabled:opacity-50"
            disabled={!hasLines || submitting || !canSubmit}
            onClick={onSubmit}
          >
            {submitting ? <Spinner /> : t('Отправить на кухню')}
          </button>

          {hasLines && (
            <button
              className="mt-2 h-9 w-full text-sm font-medium text-primary hover:underline"
              onClick={() => clear()}
            >
              {t('Очистить')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RoundBtn({
  variant,
  onClick,
  label,
}: {
  variant: 'inc' | 'dec';
  onClick: () => void;
  label: string;
}) {
  const isDec = variant === 'dec';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex h-7 w-7 items-center justify-center rounded-full border bg-white transition-colors ${
        isDec
          ? 'border-red-400 text-red-500 hover:bg-red-50'
          : 'border-primary text-primary hover:bg-primary/5'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M3 7h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        {!isDec && <path d="M7 3v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
      </svg>
    </button>
  );
}
