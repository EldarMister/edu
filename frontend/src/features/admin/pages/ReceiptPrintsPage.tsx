import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WorkspacePending } from '../components/WorkspacePending';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import { displayOrderNumber, money, timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import type { ReceiptPrintRequest } from '@/types';
import { useOrderReceiptPrinter } from '@/features/waiter/useOrderReceiptPrinter';
import { usePublicSettings } from '@/features/settings/api';
import { OrderDetailsModal } from '../components/OrderDetailsModal';
import { useAdminOrderDetails, useReceiptPrintRequests, useReceiptPrintActions } from '../api';

/** Раздел администратора «Печать чека»: заявки официантов на печать. */
export function ReceiptPrintsPage({ terminal = false }: { terminal?: boolean }) {
  const { canAction, canEditSection } = usePermissions();
  const editable = terminal ? canAction('printReceipts') : canEditSection('checks');
  const t = useT();
  const q = useReceiptPrintRequests();
  const { approve, printed, reject } = useReceiptPrintActions();
  const print = useOrderReceiptPrinter();
  const settings = usePublicSettings();
  const queryClient = useQueryClient();
  const refresh = () => { if (terminal) void queryClient.invalidateQueries({ queryKey: ['admin', 'receipt-prints'] }); };
  useSocketEvent('receipt_print_request_created', refresh, [terminal, queryClient]);
  useSocketEvent('receipt_print_request_approved', refresh, [terminal, queryClient]);
  useSocketEvent('receipt_print_request_printed', refresh, [terminal, queryClient]);
  useSocketEvent('receipt_print_request_rejected', refresh, [terminal, queryClient]);
  const push = useNotifications((s) => s.push);
  const [printing, setPrinting] = useState(false);
  const [detailsOrderId, setDetailsOrderId] = useState<string | null>(null);
  const detailsQ = useAdminOrderDetails(detailsOrderId);

  const items = q.data ?? [];
  const requestedItems = items.filter((item) => (item.source ?? 'request') === 'request');
  const availableItems = items.filter((item) => item.source === 'order');
  const busy = !editable || printing || approve.isPending || printed.isPending || reject.isPending;

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
    if (busy) return;
    const printWindow = window.open('', '_blank', 'width=380,height=640');
    if (!printWindow) {
      push({ message: t('Разрешите всплывающие окна и повторите печать.'), type: 'error', at: new Date().toISOString() });
      return;
    }
    const isRequest = (row.source ?? 'request') === 'request';
    const alreadyApproved = row.status === 'approved';
    try {
      setPrinting(true);
      const request = isRequest && !alreadyApproved ? await approve.mutateAsync(row.id) : row;
      await print(request.orderId, printWindow, {
        preliminary: request.type === 'preliminary',
        requestId: isRequest ? request.id : undefined,
        onAfterPrint: async () => {
          try {
            // Запрос официанта: подтверждаем печать (backend пометит printed; фискализация идемпотентна).
            if (isRequest) await printed.mutateAsync(row.id);
            push({ message: okMessage, type: 'success', at: new Date().toISOString() });
          } catch (err) {
            push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
          }
        },
      });
    } catch (err) {
      printWindow.close();
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    } finally {
      setPrinting(false);
    }
  }

  const renderRows = (rows: ReceiptPrintRequest[]) =>
    rows.map((r) => {
      const prelim = r.type === 'preliminary';
      const isRequest = (r.source ?? 'request') === 'request';
      const approved = r.status === 'approved';
      const primaryAction = isRequest && !approved ? t('Принять') : t('Печать');
      return (
        <tr
          key={r.id}
          className={`border-b border-border last:border-0 ${terminal ? '' : 'cursor-pointer hover:bg-background/60'}`}
          tabIndex={terminal ? undefined : 0}
          role={terminal ? undefined : 'button'}
          onClick={terminal ? undefined : () => setDetailsOrderId(r.orderId)}
          onKeyDown={terminal ? undefined : (e) => {
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
          <td className="px-4 py-3 text-text-secondary">{r.orderSource === 'delivery' ? t('Доставка') : r.tableNumber}</td>
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
              {isRequest && !approved && (
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
    <div className="workspace-stagger space-y-4">
      {q.isLoading ? (
        <WorkspacePending />
      ) : q.isError ? (
        <p role="alert" className="p-4 text-danger">{apiError(q.error)}</p>
      ) : (
        <>
          {renderSection(t('Запрошенные на печать'), requestedItems, t('Запросов на печать нет'))}
          {settings.isSuccess && !settings.data.receiptPrintRequestsOnly && renderSection(
            t('Доступные к печати'), availableItems, t('Доступных заказов к печати нет'),
          )}
        </>
      )}
      <OrderDetailsModal
        order={detailsQ.data ?? null}
        onClose={() => setDetailsOrderId(null)}
      />
    </div>
  );
}
