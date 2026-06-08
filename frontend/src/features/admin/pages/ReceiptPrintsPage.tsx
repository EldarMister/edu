import { Spinner } from '@/components/Spinner';
import { api, apiError } from '@/lib/api';
import { displayOrderNumber, money, timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import type { Receipt } from '@/types';
import { printReceipt } from '@/features/waiter/printReceipt';
import { useReceiptPrintRequests, useReceiptPrintActions } from '../api';

/** Раздел администратора «Печать чека»: заявки официантов на печать. */
export function ReceiptPrintsPage() {
  const t = useT();
  const q = useReceiptPrintRequests();
  const { approve, reject } = useReceiptPrintActions();
  const push = useNotifications((s) => s.push);

  const items = q.data ?? [];
  const pendingId =
    approve.isPending ? (approve.variables as string) : reject.isPending ? (reject.variables as string) : null;

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

  async function approveAndPrint(id: string, okMessage: string) {
    const printWindow = window.open('', '_blank', 'width=380,height=640');
    try {
      const request = await approve.mutateAsync(id);
      const receipt = (await api.get<Receipt>(`/payments/${request.orderId}/receipt`)).data;
      printReceipt(receipt, printWindow, { preliminary: request.type === 'preliminary' });
      push({ message: okMessage, type: 'success', at: new Date().toISOString() });
    } catch (err) {
      printWindow?.close();
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  return (
    <div className="card overflow-hidden">
      {q.isLoading ? (
        <div className="flex justify-center py-16 text-primary">
          <Spinner className="h-7 w-7" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-16 text-center text-sm text-text-muted">{t('Запросов на печать чека нет')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3">{t('№ заказа')}</th>
                <th className="px-4 py-3">{t('Тип')}</th>
                <th className="px-4 py-3">{t('Стол')}</th>
                <th className="px-4 py-3">{t('Официант')}</th>
                <th className="px-4 py-3">{t('Сумма')}</th>
                <th className="px-4 py-3">{t('Время запроса')}</th>
                <th className="px-4 py-3 text-right">{t('Действия')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const busy = pendingId === r.id;
                const prelim = r.type === 'preliminary';
                return (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {displayOrderNumber(r.orderNumber)}
                    </td>
                    <td className="px-4 py-3">
                      {prelim ? (
                        <span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                          {t('Предчек')}
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                          {t('Чек')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{r.tableNumber}</td>
                    <td className="px-4 py-3 text-text-secondary">{r.waiterName}</td>
                    <td className="px-4 py-3 font-medium text-text-primary">{money(r.amount)}</td>
                    <td className="px-4 py-3 text-text-muted">{timeHM(r.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          aria-label={t('Принять')}
                          title={t('Принять')}
                          disabled={busy}
                          onClick={() => approveAndPrint(r.id, `${prelim ? 'Предчек' : 'Чек'} ${displayOrderNumber(r.orderNumber)} распечатан`)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-success/40 text-success transition-colors hover:bg-success/10 disabled:opacity-50"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        </button>
                        <button
                          aria-label={t('Отклонить')}
                          title={t('Отклонить')}
                          disabled={busy}
                          onClick={() => run(reject, r.id, 'Заявка отклонена')}
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-danger/40 text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
