import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { Spinner } from '@/components/Spinner';
import { NumberTicker } from '@/components/NumberTicker';
import { useCart, cartTotals } from './cart';
import { CartLinesList, TakeawaySwitch } from './CartItems';

// Длительность и плавность открытия/закрытия листа.
// Мягкий старт и плавное замедление (без резкого рывка в начале).
const SHEET_MS = 440;
const SHEET_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

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
  submitLabel,
}: {
  open: boolean;
  onClose: () => void;
  /** Отправка заказа по текущей логике (create / addItems). */
  onSubmit: () => void;
  submitting: boolean;
  /** Есть ли активная смена (иначе отправка заблокирована вышестоящей логикой). */
  canSubmit: boolean;
  /** Текст основной кнопки (зависит от режима и направления позиций). */
  submitLabel: string;
}) {
  const t = useT();
  const { lines, comment, commentOpen, inc, dec, setComment, setCommentOpen, setLineTakeaway, setAllTakeaway, clear } =
    useCart();
  const totals = cartTotals(lines);
  const hasLines = lines.length > 0;
  const allTakeaway = hasLines && lines.every((l) => l.takeaway);

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
      // Двойной rAF: гарантируем, что стартовое положение (translateY(100%))
      // отрисовано до переключения на 0, иначе переход «проскакивает».
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
        style={{ transition: `opacity ${SHEET_MS}ms ease`, opacity: visible ? 1 : 0 }}
        onClick={onClose}
        aria-hidden
      />

      {/* Лист корзины */}
      <div
        className="absolute inset-x-0 bottom-0 flex max-h-[78vh] flex-col rounded-t-2xl bg-white shadow-soft"
        style={{
          transform: sheetTransform,
          transition: dragging ? 'none' : `transform ${SHEET_MS}ms ${SHEET_EASE}`,
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
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-text-primary">{t('Корзина')}</h2>
            {hasLines && (
              <span onPointerDown={(e) => e.stopPropagation()}>
                <TakeawaySwitch on={allTakeaway} onChange={setAllTakeaway} />
              </span>
            )}
          </div>
        </div>

        {/* Список блюд */}
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4">
          {!hasLines ? (
            <p className="py-12 text-center text-sm text-text-muted">{t('Корзина пуста')}</p>
          ) : (
            <CartLinesList lines={lines} inc={inc} dec={dec} onToggleTakeaway={setLineTakeaway} />
          )}
        </div>

        {/* Итог + действия */}
        <div className="shrink-0 px-4 pt-3">
          {commentOpen && (
            <input
              className="input mb-3 h-10 text-sm"
              placeholder={t('Комментарий к заказу')}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              autoFocus
            />
          )}

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-[15px] font-medium text-text-secondary">{t('Итого')}</span>
            <NumberTicker value={totals.final} className="text-lg font-semibold text-text-primary" />
          </div>

          <button
            className="btn-primary mt-3 h-12 w-full rounded-lg font-semibold disabled:opacity-50"
            disabled={!hasLines || submitting || !canSubmit}
            onClick={onSubmit}
          >
            {submitting ? <Spinner /> : submitLabel}
          </button>

          {hasLines && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                className="h-9 text-sm font-medium text-primary hover:underline"
                onClick={() => clear()}
              >
                {t('Очистить')}
              </button>
              <button
                className={`h-9 text-sm font-medium hover:underline ${
                  commentOpen ? 'text-text-secondary' : 'text-primary'
                }`}
                onClick={() => setCommentOpen(!commentOpen)}
              >
                {commentOpen ? t('Скрыть комментарий') : t('Комментарий')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
