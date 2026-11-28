import { useState, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { REPORT_PERIODS, ReportPeriodFilter, type PeriodPreset } from '@/features/admin/pages/warehouse/ReportPeriodFilter';
import { warehouseDay, warehousePeriodRange } from '@/features/admin/pages/warehouse/warehouse-period';
import { Spinner } from '@/components/Spinner';
import { usePermissions } from '@/hooks/usePermissions';
import { displayOrderNumber, orderItemDisplayName, orderPlaceLabel, paymentMethodLabel, taxRateLabel } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { ORDER_STATUS } from '@/lib/status';
import { useLocale } from '@/store/locale';
import { OrderRefunds } from '@/features/refunds/OrderRefunds';
import type { Order } from '@/types';
import { useOrderDetails, useWaiterOrderHistory, type ArchiveFilter } from './api';

const FILTERS: { value: ArchiveFilter; label: string }[] = [
  { value: 'all', label: 'Все заказы' },
  { value: 'cash', label: 'Наличные' },
  { value: 'card', label: 'Карта' },
  { value: 'qr', label: 'QR-код' },
  { value: 'refunds', label: 'Возвраты' },
];

const amounts = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dates = {
  ru: new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bishkek' }),
  ky: new Intl.DateTimeFormat('ky-KG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bishkek' }),
};

function amount(value: string | number, currency = true) {
  return amounts.format(Number(value)) + (currency ? ' с' : '');
}

export function WaiterOrderArchive({
  onClose, onNewOrder, canStartOrder, onPrint, printing, titleActions,
}: {
  onClose: () => void;
  onNewOrder: () => void;
  canStartOrder: boolean;
  onPrint?: (order: Order) => void;
  printing: boolean;
  titleActions: ReactNode;
}) {
  const t = useT();
  const date = dates[useLocale((s) => s.locale)];
  const [filter, setFilter] = useState<ArchiveFilter>('all');
  const [period, setPeriod] = useState<PeriodPreset>('today');
  const [{ from, to }, setDates] = useState({ from: '', to: '' });
  const today = warehouseDay();
  const range = warehousePeriodRange(period, today, from, to);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMobileReceipt, setShowMobileReceipt] = useState(false);
  const history = useWaiterOrderHistory(filter, range);
  const orders = history.data?.pages.flatMap((page) => page.items) ?? [];
  const selected = orders.find((order) => order.id === selectedId) ?? orders[0];

  function resetSelection() {
    setSelectedId(null);
    setShowMobileReceipt(false);
  }

  return (
    <Modal open fullScreen title={t('История заказов')} titleActions={titleActions} onClose={onClose}>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-white px-3 py-3 md:px-5">
          <div role="group" aria-label={t('Способ оплаты')} className="order-last flex w-full gap-1 overflow-x-auto md:order-none md:w-auto">
            {FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => { setFilter(value); resetSelection(); }}
                className={`min-h-10 shrink-0 rounded-lg px-3 text-sm font-medium ${filter === value
                  ? 'bg-primary/10 text-link'
                  : 'text-text-secondary hover:bg-background hover:text-text-primary'}`}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <ReportPeriodFilter
              preset={period}
              today={today}
              range={range}
              label={t('Период')}
              allCaption={t('За всё время')}
              presets={REPORT_PERIODS}
              onPreset={(value) => { setPeriod(value); resetSelection(); }}
              onRange={(from, to) => { setDates({ from, to }); setPeriod('custom'); resetSelection(); }}
            />
            <button type="button" className="btn-primary btn-md" onClick={onNewOrder} disabled={!canStartOrder}>
              {t('Новый заказ')}
            </button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(15rem,24%)_minmax(0,1fr)]">
          <div
            key={[filter, range.dateFrom, range.dateTo].join(':')}
            className={`min-h-0 overflow-y-auto bg-background md:block md:border-r md:border-border ${showMobileReceipt && selected ? 'hidden' : ''}`}
          >
            {history.isPending && <div className="flex justify-center p-5 text-primary"><Spinner className="h-5 w-5" /></div>}
            {!orders.length && history.isSuccess && (
              <p className="px-4 py-8 text-center text-sm text-text-muted">{t('За выбранный период заказов нет')}</p>
            )}
            <ul className="space-y-1 p-2">
              {orders.map((order) => {
                const active = order.id === selected?.id;
                const refunded = Number(order.refundedAmount ?? 0);
                const state = order.paymentStatus === 'refunded' ? 'Возвращён'
                  : refunded > 0 ? 'Частичный возврат' : ORDER_STATUS[order.status]?.label ?? order.status;
                const preview = order.items?.map((item) => orderItemDisplayName(item)).join(', ');
                return (
                  <li key={order.id}>
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => { setSelectedId(order.id); setShowMobileReceipt(true); }}
                      className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 rounded-xl border p-3 text-left text-sm ${active
                        ? 'border-primary/30 bg-white shadow-sm'
                        : 'border-transparent hover:border-border hover:bg-white'}`}
                    >
                      <span className="font-semibold">{displayOrderNumber(order.orderNumber)}</span>
                      <span className="font-semibold tabular-nums">{amount(order.finalAmount)}</span>
                      <span className="col-span-2 truncate text-text-secondary">
                        {preview || (order.source === 'delivery' ? t('Доставка') : `${t('Стол')} ${order.tableNumber}`)}
                      </span>
                      <span className="col-span-2 text-xs text-text-muted">
                        {date.format(new Date(order.closedAt ?? order.createdAt))} · {t(state)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {history.isError && <p role="alert" className="px-4 py-2 text-sm text-danger">{t('Не удалось загрузить заказы')}</p>}
            {(history.hasNextPage || history.isError) && (
              <div className="p-3">
                <button
                  type="button"
                  className="btn-secondary btn-md w-full"
                  disabled={history.isFetching}
                  onClick={() => void (history.isFetchNextPageError || !history.isError
                    ? history.fetchNextPage({ cancelRefetch: false })
                    : history.refetch())}
                >
                  {t(history.isError ? 'Повторить' : 'Показать ещё')}
                </button>
              </div>
            )}
          </div>
          <div
            className={`min-h-0 min-w-0 overflow-y-auto md:block ${showMobileReceipt && selected ? '' : 'hidden'}`}
          >
            {selected ? (
              <ArchiveReceipt
                key={selected.id}
                id={selected.id}
                onShowList={() => setShowMobileReceipt(false)}
                onPrint={onPrint}
                printing={printing}
              />
            ) : !history.isPending && (
              <p className="px-4 py-10 text-center text-sm text-text-muted">{t('Здесь откроется выбранный заказ')}</p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ArchiveReceipt({
  id, onShowList, onPrint, printing,
}: {
  id: string;
  onShowList: () => void;
  onPrint?: (order: Order) => void;
  printing: boolean;
}) {
  const t = useT();
  const date = dates[useLocale((s) => s.locale)];
  const { canOwnerOperation } = usePermissions();
  const [showRefunds, setShowRefunds] = useState(false);
  const detail = useOrderDetails(id);
  const order = detail.data;
  const isReceipt = order?.status === 'paid';
  const refunded = Number(order?.refundedAmount ?? 0);
  const cashiers = Array.from(new Set(order?.payments?.flatMap((payment) => payment.cashier?.name ? [payment.cashier.name] : [])));
  const items = order?.items.filter((item) => !isReceipt || (item.status !== 'cancelled' && item.status !== 'rejected'));
  const payments = order?.payments?.length
    ? order.payments
    : order?.paymentMethod && isReceipt ? [{ method: order.paymentMethod, amount: order.finalAmount }] : [];

  return (
    <article className="px-4 py-4 md:px-6 md:py-6 lg:px-8">
      <button type="button" className="btn-secondary btn-md mb-3 md:hidden" onClick={onShowList}>{t('Список заказов')}</button>
      {detail.isPending && <div className="flex justify-center p-6 text-primary"><Spinner className="h-5 w-5" /></div>}
      {detail.isError && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-danger">{t('Не удалось загрузить заказ')}</p>
          <button type="button" className="btn-secondary btn-md" onClick={() => void detail.refetch()}>{t('Повторить')}</button>
        </div>
      )}
      {order && <>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold">{t(isReceipt ? 'Чек' : 'Заказ')} {displayOrderNumber(order.orderNumber)}</h2>
            <p className="mt-1 text-sm text-text-muted">{orderPlaceLabel(order, t)}</p>
          </div>
          {isReceipt && (
            <div className="flex flex-wrap gap-2">
              {onPrint && (
                <button type="button" className="btn-primary btn-md" onClick={() => onPrint(order)} disabled={printing}>
                  {t('Печать чека')}
                </button>
              )}
              {canOwnerOperation('refunds') && (
                <button type="button" className="btn-secondary btn-md" onClick={() => setShowRefunds(true)}>{t('Возврат')}</button>
              )}
            </div>
          )}
        </div>
        <dl className="my-5 grid gap-x-6 gap-y-2 rounded-xl border border-border bg-background px-4 py-3 text-sm sm:grid-cols-[max-content_1fr]">
          {cashiers.length > 0 ? <>
            <dt className="text-text-muted">{t('Кассир')}</dt><dd>{cashiers.join(', ')}</dd>
          </> : order.waiter && <>
            <dt className="text-text-muted">{t('Официант')}</dt><dd>{order.waiter.name}</dd>
          </>}
          <dt className="text-text-muted">{t('Открыт')}</dt>
          <dd><time dateTime={order.createdAt}>{date.format(new Date(order.createdAt))}</time></dd>
          {order.closedAt && <>
            <dt className="text-text-muted">{t('Закрыт')}</dt>
            <dd><time dateTime={order.closedAt}>{date.format(new Date(order.closedAt))}</time></dd>
          </>}
        </dl>
        {order.comment && <p className="mb-4 break-words text-sm"><span className="text-text-muted">{t('Комментарий')} · </span>{order.comment}</p>}
        <table className="w-full table-fixed border-collapse text-sm">
          <thead className="border-b border-border text-text-secondary">
            <tr>
              <th scope="col" className="w-[46%] pb-2 pr-2 text-left font-semibold">{t('Наименование')}</th>
              <th scope="col" className="pb-2 text-right font-semibold">{t('Кол-во')}</th>
              <th scope="col" className="pb-2 text-right font-semibold">{t('Цена')}</th>
              <th scope="col" className="pb-2 text-right font-semibold">{t('Итого')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {items?.map((item) => (
              <tr key={item.id}>
                <td className="break-words py-3 pr-2">
                  {orderItemDisplayName(item)}
                  {item.status === 'cancelled' || item.status === 'rejected'
                    ? <span className="block text-xs text-text-muted">{t(item.status === 'cancelled' ? 'Отменено' : 'Отказано')}</span> : null}
                  {item.comment && <span className="block text-xs text-text-muted">{item.comment}</span>}
                  {item.rejectReason && <span className="block text-xs text-danger">{item.rejectReason}</span>}
                  {!!item.refundedQuantity && <span className="block text-xs text-text-muted">{t('Возвращено')} · {item.refundedQuantity} / {item.quantity}</span>}
                </td>
                <td className="py-3 text-right">{item.quantity}</td>
                <td className="py-3 text-right">{amount(item.priceSnapshot, false)}</td>
                <td className="py-3 text-right">{amount(item.finalPrice, false)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-2 border-t border-border py-4">
          <ReceiptLine label={t('Итого')}>{amount(order.totalAmount)}</ReceiptLine>
          {Number(order.discountAmount) > 0 && <ReceiptLine label={t('Скидка')}>{amount(-Number(order.discountAmount))}</ReceiptLine>}
          {Number(order.serviceChargeAmount) > 0 && <ReceiptLine label={t('Обслуживание')}>{amount(order.serviceChargeAmount)}</ReceiptLine>}
          {Number(order.roundingAmount ?? 0) !== 0 && <ReceiptLine label={t('Округление')}>{amount(-Number(order.roundingAmount))}</ReceiptLine>}
          {order.taxes?.map((tax) => <ReceiptLine key={tax.id} label={`${t('В т. ч.')} ${tax.name} (${taxRateLabel(tax.rate)})`}>{amount(tax.amount)}</ReceiptLine>)}
          <ReceiptLine label={t(isReceipt ? 'Оплачено' : 'К оплате')} strong>{amount(order.finalAmount)}</ReceiptLine>
          {refunded > 0 && <>
            <ReceiptLine label={t('Возвращено')}>{amount(refunded)}</ReceiptLine>
            <ReceiptLine label={t('Оплата после возврата')}>{amount(Number(order.finalAmount) - refunded)}</ReceiptLine>
          </>}
        </div>
        {payments.length > 0 && (
          <section className="space-y-2 border-t border-border py-4">
            <h3 className="mb-2 font-semibold">{t('Оплата')}</h3>
            {payments.map((payment, index) => (
              <ReceiptLine key={index} label={t(paymentMethodLabel(payment.method))}>{amount(payment.amount)}</ReceiptLine>
            ))}
          </section>
        )}
        {showRefunds && (
          <Modal open title={t('Возврат')} onClose={() => setShowRefunds(false)}>
            <OrderRefunds order={order} mode="request" />
          </Modal>
        )}
      </>}
    </article>
  );
}

function ReceiptLine({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline gap-2 ${strong ? 'text-lg font-semibold' : 'text-sm'}`}>
      <span>{label}</span>
      <span aria-hidden className="min-w-2 flex-1 border-b border-dotted border-border" />
      <span className="shrink-0 tabular-nums">{children}</span>
    </div>
  );
}
