import { useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { api, apiError } from '@/lib/api';
import { displayOrderNumber, money, timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import type { Receipt, ReceiptPrintRequest } from '@/types';
import { printReceipt, type FiscalPrintData } from '@/features/waiter/printReceipt';
import { usePublicSettings } from '@/features/settings/api';
import { OrderDetailsModal } from '../components/OrderDetailsModal';
import { useAdminOrderDetails, useReceiptPrintRequests, useReceiptPrintActions, useFiscalizeForPrint } from '../api';

/** Раздел администратора «Печать чека»: заявки официантов на печать. */
export function ReceiptPrintsPage() {
  const t = useT();
  const q = useReceiptPrintRequests();
  const { approve, printed, reject } = useReceiptPrintActions();
  const fiscalizeForPrint = useFiscalizeForPrint();
  const fiscalEnabled = usePublicSettings().data?.fiscalEnabled ?? false;
  const push = useNotifications((s) => s.push);
  const [directPendingId, setDirectPendingId] = useState<string | null>(null);
  const [detailsOrderId, setDetailsOrderId] = useState<string | null>(null);
  const detailsQ = useAdminOrderDetails(detailsOrderId);

  const items = q.data ?? [];
  const requestedItems = items.filter((item) => (item.source ?? 'request') === 'request');
  const availableItems = items.filter((item) => item.source === 'order');
  const pendingId =
    directPendingId ??
    (approve.isPending ? (approve.variables as string) : printed.isPending ? (printed.variables as string) : reject.isPending ? (reject.variables as string) : null);

  async function run(
    action: typeof approve | typeof reject,
    id: string,
    okMessage: string,
  ) {
    try {
      await action.mutateAsync(id);
      push({ message: okMessage, type: 'success', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  async function approveAndPrint(row: ReceiptPrintRequest, okMessage: string) {
    const printWindow = window.open('', '_blank', 'width=380,height=640');
    const isRequest = (row.source ?? 'request') === 'request';
    const alreadyApproved = row.status === 'approved';
    try {
      setDirectPendingId(isRequest ? null : row.id);
      const request = isRequest && !alreadyApproved ? await approve.mutateAsync(row.id) : row;
      const receipt = (await api.get<Receipt>(`/payments/${request.orderId}/receipt`)).data;
      const prelim = request.type === 'preliminary';

      // ККМ: фискализируем ДО печати, чтобы напечатать фискальный чек (номер + QR ГНС).
      // Предчек не фискализируется. Ошибка ККМ не блокирует — печатаем обычный товарный чек.
      let fiscal: FiscalPrintData | undefined;
      if (!prelim && fiscalEnabled) {
        try {
          const res = await fiscalizeForPrint.mutateAsync(request.orderId);
          if (res?.success) {
            fiscal = { receiptNumber: res.fiscalReceiptNumber, sign: res.fiscalSign, qrCode: res.qrCode };
          } else if (res?.error) {
            push({ message: `Чек печатается, но ККМ вернул ошибку: ${res.error}`, type: 'error', at: new Date().toISOString() });
          }
        } catch (err) {
          push({ message: `ККМ недоступна: ${apiError(err)}`, type: 'error', at: new Date().toISOString() });
        }
      }

      await printReceipt(receipt, printWindow, {
        preliminary: prelim,
        fiscal,
        onAfterPrint: async () => {
          try {
            // Запрос официанта: подтверждаем печать (backend пометит printed; фискализация идемпотентна).
            if (isRequest) await printed.mutateAsync(row.id);
            push({ message: okMessage, type: 'success', at: new Date().toISOString() });
          } catch (err) {
            push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
          } finally {
            setDirectPendingId(null);
          }
        },
      });
    } catch (err) {
      printWindow?.close();
      setDirectPendingId(null);
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  const renderRows = (rows: ReceiptPrintRequest[]) =>
    rows.map((r) => {
      const busy = pendingId === r.id;
      const prelim = r.type === 'preliminary';
      const isRequest = (r.source ?? 'request') === 'request';
      const approved = r.status === 'approved';
      const primaryAction = isRequest && !approved ? t('Принять') : t('Печать');
      return (
        <tr
          key={r.id}
          className="cursor-pointer border-b border-border last:border-0 hover:bg-background/60"
          tabIndex={0}
          role="button"
          onClick={() => setDetailsOrderId(r.orderId)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setDetailsOrderId(r.orderId);
            }
          }}
        >
          <td className="px-4 py-3 font-medium text-text-primary">
            {displayOrderNumber(r.orderNumber)}
          </td>
          <td className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {prelim ? (
                <span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  {t('Счёт')}
                </span>
              ) : (
                <span className="inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {t('Чек')}
                </span>
              )}
            </div>
          </td>
          <td className="px-4 py-3 text-text-secondary">{r.tableNumber}</td>
          <td className="px-4 py-3 text-text-secondary">{r.waiterName}</td>
          <td className="px-4 py-3 font-medium text-text-primary">{money(r.amount)}</td>
          <td className="px-4 py-3 text-text-muted">{timeHM(r.createdAt)}</td>
          <td className="px-4 py-3">
            <div className="flex items-center justify-end gap-2">
              <button
                aria-label={primaryAction}
                title={primaryAction}
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  approveAndPrint(r, `${prelim ? 'Счёт' : 'Чек'} ${displayOrderNumber(r.orderNumber)} распечатан`);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-success/40 text-success transition-colors hover:bg-success/10 disabled:opacity-50"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </button>
              {isRequest && (
                <button
                  aria-label={t('Отклонить')}
                  title={t('Отклонить')}
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    run(reject, r.id, 'Заявка отклонена');
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-danger/40 text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </td>
        </tr>
      );
    });

  const renderSection = (title: string, rows: ReceiptPrintRequest[], emptyText: string) => (
    <section className="overflow-hidden rounded-xl border border-border bg-white">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-text-muted">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] table-fixed text-sm">
            <colgroup>
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[10%]" />
              <col className="w-[18%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[16%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-background text-left text-xs font-medium uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3">{t('№ заказа')}</th>
                <th className="px-4 py-3">{t('Тип')}</th>
                <th className="px-4 py-3">{t('Стол')}</th>
                <th className="px-4 py-3">{t('Официант')}</th>
                <th className="px-4 py-3">{t('Сумма')}</th>
                <th className="px-4 py-3">{t('Время')}</th>
                <th className="px-4 py-3 text-right">{t('Действия')}</th>
              </tr>
            </thead>
            <tbody>{renderRows(rows)}</tbody>
          </table>
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-4">
      {q.isLoading ? (
        <div className="flex justify-center rounded-xl border border-border bg-white py-16 text-primary">
          <Spinner className="h-7 w-7" />
        </div>
      ) : (
        <>
          {renderSection(t('Запрошенные на печать'), requestedItems, t('Запросов на печать нет'))}
          {renderSection(t('Доступные к печати'), availableItems, t('Доступных заказов к печати нет'))}
        </>
      )}
      <OrderDetailsModal
        order={detailsQ.data ?? null}
        onClose={() => setDetailsOrderId(null)}
      />
    </div>
  );
}
