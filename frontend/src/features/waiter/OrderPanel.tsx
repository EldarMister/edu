import { useEffect, useState } from 'react';
import type { Order } from '@/types';
import { OrderBadge } from '@/components/StatusBadge';
import { ORDER_STATUS } from '@/lib/status';
import { displayOrderNumber, money, orderItemDisplayName } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Spinner } from '@/components/Spinner';

function InfoIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-primary"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      <path d="m21.7 18.6-8.5-15a1.4 1.4 0 0 0-2.4 0l-8.5 15A1.4 1.4 0 0 0 3.5 21h17a1.4 1.4 0 0 0 1.2-2.4Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** Возвращает null если строка состоит только из U+FFFD (кракозябры из bash-тестов). */
function safeComment(s: string | null | undefined): string | null {
  if (!s) return null;
  if ([...s].every(c => c === '�' || c === ' ')) return null;
  return s;
}

export function OrderPanel({
  order,
  submitting,
  preliminaryPending,
  onPickedUp,
  onServed,
  onToPayment,
  onPreliminaryReceipt,
  onContinueAfterRejection,
  onReplaceRejectedItem,
  onRemoveRejectedItem,
  onCancelOrder,
  onEdit,
}: {
  order: Order;
  submitting: boolean;
  preliminaryPending: boolean;
  onPickedUp: () => void;
  onServed: () => void;
  onToPayment: () => void;
  onPreliminaryReceipt: () => void;
  onContinueAfterRejection: () => void;
  onReplaceRejectedItem: (item: Order['items'][number]) => void;
  onRemoveRejectedItem: (item: Order['items'][number]) => void;
  onCancelOrder: () => void;
  /** Открыть редактирование заказа (переиспользует логику корзины/сетов). */
  onEdit?: () => void;
}) {
  const t = useT();
  const waitingDecision = order.status === 'partially_rejected' && order.requiresWaiterDecision;
  // Редактирование доступно, пока кухня не завершила заказ (как в списке заказов).
  const editable = ['sent_to_kitchen', 'accepted_by_kitchen', 'cooking'].includes(order.status);

  if (waitingDecision) {
    return (
      <PartialRejectionPanel
        order={order}
        submitting={submitting}
        onContinueAfterRejection={onContinueAfterRejection}
        onReplaceRejectedItem={onReplaceRejectedItem}
        onRemoveRejectedItem={onRemoveRejectedItem}
        onCancelOrder={onCancelOrder}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Компактная шапка: номер + стол слева, лёгкий бейдж и «Редактировать» справа */}
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold leading-tight text-text-primary">
            {t('Заказ')} {displayOrderNumber(order.orderNumber)}
            <span className="ml-2 text-[13px] font-normal text-text-muted">{t('Стол')} {order.table.number}</span>
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {waitingDecision && (
            <span className="rounded-md bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
              {t('Нужен ответ')}
            </span>
          )}
          <OrderBadge status={order.status} size="sm" />
          {onEdit && editable && (
            <button
              onClick={onEdit}
              className="flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border px-2 text-[12px] font-medium text-text-secondary transition-colors hover:border-primary/50 hover:text-primary"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              {t('Изменить')}
            </button>
          )}
        </div>
      </div>

      {/* Позиции — компактный список */}
      <div className="no-scrollbar flex-1 space-y-1.5 overflow-y-auto py-3">
        {order.items.map((it) => {
          const rejected = it.status === 'rejected';
          const waitingItem = waitingDecision && !rejected;
          const comment = safeComment(it.comment);
          const hasExtra = comment || (rejected && it.rejectReason) || waitingItem;
          return (
            <div
              key={it.id}
              className={`rounded-lg border px-3 py-2 ${
                rejected
                  ? 'border-danger/30 bg-danger/5'
                  : waitingItem
                    ? 'border-warning/20 bg-warning/5'
                    : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className={`min-w-0 flex-1 truncate text-[15px] ${
                    rejected ? 'text-danger line-through' : 'text-text-primary'
                  }`}
                >
                  {orderItemDisplayName(it)}
                </span>
                <span className="shrink-0 text-sm text-text-secondary">×{it.quantity}</span>
                <div className="flex flex-col items-end shrink-0 min-w-[80px]">
                  <span className="text-[15px] font-medium text-text-primary">
                    {money(it.finalPrice)}
                  </span>
                  {!rejected && !waitingItem && (it.status === 'ready' || it.status === 'served') && (
                    <span className="text-xs font-semibold text-green-600 mt-0.5">
                      ✓ {t('Готово')}
                    </span>
                  )}
                  {!rejected && !waitingItem && (it.status === 'cooking' || it.status === 'accepted') && (
                    <span className="text-xs font-medium text-text-muted mt-0.5">
                      {t('Готовится')}
                    </span>
                  )}
                  {(rejected || it.status === 'cancelled') && (
                    <span className="text-xs font-medium text-danger mt-0.5">
                      {t('Отказано')}
                    </span>
                  )}
                </div>
              </div>
              {hasExtra && (
                <div className="mt-0.5 text-xs">
                  {comment && <p className="text-text-muted">{comment}</p>}
                  {rejected && it.rejectReason && <p className="text-danger">{t('Отказ')}: {it.rejectReason}</p>}
                  {waitingItem && <p className="text-warning">{t('Ожидает решения клиента')}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Низ */}
      <div className="border-t border-border pt-3">
        {order.comment && (
          <p className="mb-2 rounded-lg bg-background px-3 py-2 text-sm text-text-secondary">
            {order.comment}
          </p>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-medium text-text-secondary">{t('Итого')}</span>
          <span className="text-xl font-semibold text-text-primary">{money(order.finalAmount)}</span>
        </div>

        <div className="mt-3">
          <ActionButton
            order={order}
            submitting={submitting}
            preliminaryPending={preliminaryPending}
            onPickedUp={onPickedUp}
            onServed={onServed}
            onToPayment={onToPayment}
            onPreliminaryReceipt={onPreliminaryReceipt}
            onContinueAfterRejection={onContinueAfterRejection}
            onCancelOrder={onCancelOrder}
          />
        </div>
      </div>
    </div>
  );
}

function PartialRejectionPanel({
  order,
  submitting,
  onContinueAfterRejection,
  onReplaceRejectedItem,
  onRemoveRejectedItem,
  onCancelOrder,
}: {
  order: Order;
  submitting: boolean;
  onContinueAfterRejection: () => void;
  onReplaceRejectedItem: (item: Order['items'][number]) => void;
  onRemoveRejectedItem: (item: Order['items'][number]) => void;
  onCancelOrder: () => void;
}) {
  const t = useT();
  const activeItems = order.items.filter((item) => item.status !== 'rejected' && item.status !== 'cancelled');
  const rejectedItems = order.items.filter(
    (item) =>
      item.status === 'rejected' &&
      (item.rejectionDecision === undefined || item.rejectionDecision === null || item.rejectionDecision === 'pending'),
  );
  const activeTotal = activeItems.reduce((sum, item) => sum + Number(item.finalPrice), 0);

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-1 pb-1.5 pt-0.5">
        <div className="min-w-0">
          <h2 className="truncate text-[18px] font-semibold leading-tight text-text-primary sm:text-[20px]">
            {t('Заказ')} {displayOrderNumber(order.orderNumber)}
            <span className="ml-2 text-[14px] font-normal text-text-muted">{t('Стол')} {order.table.number}</span>
          </h2>
        </div>
        <span className="shrink-0 rounded-lg border border-danger/25 bg-danger/5 px-2.5 py-1 text-[12px] font-medium text-danger">
          {t('Отказ кухни')}
        </span>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-2.5">
        <section>
          <h3 className="mb-2 text-[15px] font-semibold text-text-primary">{t('1. Активные блюда')}</h3>
          <div className="space-y-2">
            {activeItems.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border bg-white px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-text-primary">
                  {orderItemDisplayName(item)}
                </span>
                <span className="w-9 shrink-0 text-right text-[13px] text-text-muted">×{item.quantity}</span>
                <span className="w-[72px] shrink-0 text-right text-[16px] font-semibold text-text-primary">
                  {money(item.finalPrice)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[15px] font-semibold text-text-primary">{t('2. Требуют решения')}</h3>
          <div className="space-y-2">
            {rejectedItems.map((item) => (
              <div key={item.id} className="rounded-lg border border-danger/25 bg-danger/[0.04] px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text-muted line-through">
                    {orderItemDisplayName(item)}
                  </span>
                  <span className="w-8 shrink-0 text-right text-[13px] font-semibold text-text-primary">×{item.quantity}</span>
                  <span className="w-16 shrink-0 text-right text-[15px] font-semibold text-text-primary">
                    {money(item.finalPrice)}
                  </span>
                  <span className="shrink-0 text-[12px] font-medium text-danger">{t('Отказано')}</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    className="h-8 rounded-lg border border-primary px-3.5 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
                    disabled={submitting}
                    onClick={() => onReplaceRejectedItem(item)}
                  >
                    {t('Заменить')}
                  </button>
                  <button
                    className="h-8 rounded-lg border border-danger/60 px-3.5 text-[13px] font-semibold text-danger transition-colors hover:bg-danger/5 disabled:opacity-50"
                    disabled={submitting}
                    onClick={() => onRemoveRejectedItem(item)}
                  >
                    {t('Убрать')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="border-y border-border py-3">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-medium text-text-primary">{t('Итого')}</span>
            <span className="text-[22px] font-semibold text-text-primary">{money(activeTotal)}</span>
          </div>
        </div>

        <section className="space-y-2">
          <h3 className="text-[15px] font-semibold text-text-primary">{t('3. Решение')}</h3>
          <div className="flex items-center gap-2.5 rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-[13px] leading-5 text-warning">
            <WarningIcon />
            <span>{t('Кухня отказала часть заказа. Решите по каждой отказанной позиции.')}</span>
          </div>
          <button
            className="btn-primary h-11 w-full rounded-xl text-[15px] font-semibold"
            disabled={submitting}
            onClick={onContinueAfterRejection}
          >
            {submitting ? <Spinner /> : t('Продолжить без отказанных блюд')}
          </button>
          <button
            className="h-9 w-full rounded-xl text-[14px] font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50"
            disabled={submitting}
            onClick={onCancelOrder}
          >
            {t('Отменить весь заказ')}
          </button>
        </section>
      </div>
    </div>
  );
}

function ActionButton({
  order,
  submitting,
  preliminaryPending,
  onPickedUp,
  onServed,
  onToPayment,
  onPreliminaryReceipt,
  onContinueAfterRejection,
  onCancelOrder,
}: {
  order: Order;
  submitting: boolean;
  preliminaryPending: boolean;
  onPickedUp: () => void;
  onServed: () => void;
  onToPayment: () => void;
  onPreliminaryReceipt: () => void;
  onContinueAfterRejection: () => void;
  onCancelOrder: () => void;
}) {
  const t = useT();
  const [actionCooldown, setActionCooldown] = useState(0);
  const s = order.status;
  const spin = submitting ? <Spinner /> : null;
  const waitingDecision = s === 'partially_rejected' && order.requiresWaiterDecision;
  // Кухонная/барная логика — только по позициям, реально отправленным на станцию.
  // Позиции «Без отправки» (prepStation === 'none') не участвуют в кухне/баре.
  const stationItems = order.items.filter((item) => item.prepStation !== 'none');
  const hasReadyStationItem = stationItems.some((item) => item.status === 'ready');
  const cooldownActive = actionCooldown > 0;

  useEffect(() => {
    if (!cooldownActive) return;
    const id = window.setTimeout(() => setActionCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [cooldownActive, actionCooldown]);

  useEffect(() => {
    setActionCooldown(0);
  }, [order.id]);

  function runProtectedAction(action: () => void) {
    setActionCooldown(5);
    action();
  }

  if (waitingDecision) {
    return (
      <div className="space-y-2.5">
        <div className="rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">
          {t('Кухня отказала часть заказа. Уточните у клиента, что делать дальше.')}
        </div>
        <button className="btn-primary btn-lg w-full font-semibold" disabled={submitting} onClick={onContinueAfterRejection}>
          {spin ?? t('Продолжить без отказанного блюда')}
        </button>
        <button className="btn-danger btn-lg w-full font-semibold" disabled={submitting} onClick={onCancelOrder}>
          {t('Отменить весь заказ')}
        </button>
      </div>
    );
  }

  // «Забрал с кухни» — только если есть готовая позиция, реально отправленная на станцию.
  if (
    hasReadyStationItem &&
    !['paid', 'cancelled', 'rejected', 'waiting_payment', 'picked_up', 'served', 'ready'].includes(s)
  ) {
    return (
      <button className="btn-primary btn-lg w-full font-semibold" disabled={submitting || cooldownActive} onClick={() => runProtectedAction(onPickedUp)}>
        {cooldownActive ? actionCooldown : spin ?? t('Забрал с кухни')}
      </button>
    );
  }

  // Заказ готов (ready) — независимо от того, есть ли кухонные позиции, показываем «Вынес гостям».
  if (s === 'ready') {
    return (
      <button className="btn-primary btn-lg w-full font-semibold" disabled={submitting || cooldownActive} onClick={() => runProtectedAction(onServed)}>
        {cooldownActive ? actionCooldown : spin ?? t('Вынес гостям')}
      </button>
    );
  }

  if (s === 'sent_to_kitchen' || s === 'accepted_by_kitchen' || s === 'cooking' || s === 'partially_rejected') {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl bg-background px-3 py-2.5 text-sm text-text-muted">
        <InfoIcon />
        <span>{t(ORDER_STATUS[s].label)} - {t('ожидаем кухню')}</span>
      </div>
    );
  }
  if (s === 'picked_up') {
    return (
      <button className="btn-primary btn-lg w-full font-semibold" disabled={submitting || cooldownActive} onClick={() => runProtectedAction(onServed)}>
        {cooldownActive ? actionCooldown : spin ?? t('Вынес гостям')}
      </button>
    );
  }
  if (s === 'served') {
    return (
      <div className="flex gap-2">
        <button
          className="btn btn-lg shrink-0 border border-primary bg-white px-4 font-medium text-primary hover:bg-primary/5"
          disabled={preliminaryPending}
          onClick={onPreliminaryReceipt}
        >
          {preliminaryPending ? <Spinner /> : t('Счёт')}
        </button>
        <button
          className="btn-primary btn-lg flex-1 font-semibold"
          disabled={submitting || cooldownActive}
          onClick={() => runProtectedAction(onToPayment)}
        >
          {cooldownActive ? actionCooldown : spin ?? t('Перейти к оплате')}
        </button>
      </div>
    );
  }
  if (s === 'waiting_payment') {
    return (
      <div className="rounded-xl bg-purple-50 py-3 text-center text-sm text-purple-600">
        {t('Ожидает оплаты')}
      </div>
    );
  }
  if (s === 'rejected') {
    return (
      <div className="rounded-xl bg-danger/5 py-3 text-center text-sm text-danger">
        {t('Кухня отказала в заказе')}
      </div>
    );
  }
  return null;
}
