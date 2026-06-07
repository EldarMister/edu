import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Order } from '@/types';
import { OrderBadge } from '@/components/StatusBadge';
import { displayOrderNumber, money, timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';

export function OrdersList({
  orders,
  onOpen,
  onEdit,
  onCancel,
}: {
  orders: Order[];
  onOpen: (order: Order) => void;
  onEdit: (order: Order) => void;
  onCancel: (order: Order) => void;
}) {
  const t = useT();
  const [menuFor, setMenuFor] = useState<string | null>(null);

  if (orders.length === 0) {
    return <p className="py-12 text-center text-sm text-text-muted">{t('Активных заказов нет')}</p>;
  }
  const sortedOrders = [...orders].sort((a, b) => {
    const aAttention = isAttentionOrder(a) ? 1 : 0;
    const bAttention = isAttentionOrder(b) ? 1 : 0;
    if (aAttention !== bAttention) return bAttention - aAttention;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="space-y-3 px-1.5">
      {sortedOrders.map((o) => {
        const attention = isAttentionOrder(o);
        return (
          <div
            key={o.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(o)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(o);
              }
            }}
            className={`card flex w-full cursor-pointer items-stretch gap-3 px-4 py-3.5 text-left transition-colors hover:border-primary/40 ${
              attention ? 'border-primary/40 bg-primary/5 shadow-soft' : ''
            }`}
          >
            {/* Левая часть: номер, стол, время, позиции */}
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="text-base font-semibold text-text-primary">
                  {displayOrderNumber(o.orderNumber)}
                </span>
                <span className="text-sm text-text-muted">{t('Стол')} {o.table.number}</span>
              </div>
              <p className="flex items-center gap-1.5 text-xs text-text-light">
                <ClockIcon />
                {timeHM(o.createdAt)} · {o.items.length} {t('поз')}.
              </p>
            </div>

            {/* Правая часть: статус сверху, сумма снизу — зеркально левой */}
            <div className="flex shrink-0 flex-col items-end justify-between gap-2">
              <OrderBadge status={o.status} />
              <span className="text-base font-semibold text-text-primary">
                {money(o.finalAmount)}
              </span>
            </div>

            {/* Три точки — меню действий над заказом */}
            <OrderActionsMenu
              order={o}
              open={menuFor === o.id}
              onToggle={() => setMenuFor((id) => (id === o.id ? null : o.id))}
              onClose={() => setMenuFor(null)}
              onEdit={() => {
                setMenuFor(null);
                onEdit(o);
              }}
              onCancel={() => {
                setMenuFor(null);
                onCancel(o);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function OrderActionsMenu({
  order,
  open,
  onToggle,
  onClose,
  onEdit,
  onCancel,
}: {
  order: Order;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    // Меню привязано к позиции кнопки — при прокрутке списка просто закрываем его.
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [open, onClose]);

  // Фаза 1: прямое действие доступно только пока кухня не приняла заказ.
  const editable = order.status === 'sent_to_kitchen';
  const cancellable = order.status === 'sent_to_kitchen';
  const showEdit = order.status !== 'ready'; // для готового заказа редактирование скрыто
  const needsKitchen = ['accepted_by_kitchen', 'cooking', 'ready'].includes(order.status);

  return (
    <div className="self-center" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        aria-label={t('Действия с заказом')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
        className="-mr-1.5 flex w-6 items-center justify-center rounded-lg py-2 text-text-light transition-colors hover:bg-background hover:text-text-secondary"
      >
        <svg width="4" height="16" viewBox="0 0 4 16" fill="currentColor" aria-hidden>
          <circle cx="2" cy="2" r="1.6" />
          <circle cx="2" cy="8" r="1.6" />
          <circle cx="2" cy="14" r="1.6" />
        </svg>
      </button>

      {/* Меню рендерится в портал, чтобы его не обрезал прокручиваемый список. */}
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', top: pos.top, right: pos.right }}
            className="z-50 w-52 overflow-hidden rounded-xl border border-border bg-white py-1 shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            {showEdit && (
              <MenuItem disabled={!editable} onClick={onEdit}>
                {t('Редактировать заказ')}
              </MenuItem>
            )}
            <MenuItem disabled={!cancellable} danger onClick={onCancel}>
              {t('Отменить заказ')}
            </MenuItem>
            {needsKitchen && (
              <p className="px-3 pb-1.5 pt-1 text-[11px] leading-snug text-text-light">
                {t('Кухня уже приняла заказ — изменения и отмена скоро будут через её подтверждение.')}
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`block w-full px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? 'text-danger hover:bg-danger/5' : 'text-text-primary hover:bg-background'
      }`}
    >
      {children}
    </button>
  );
}

function ClockIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function isAttentionOrder(order: Order) {
  return order.requiresWaiterDecision || ['ready', 'rejected'].includes(order.status);
}
