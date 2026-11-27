import { IconExport } from '@/features/admin/components/icons';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { WorkspaceHeaderActions } from '../WorkspaceHeader';
import { downloadWarehouseWorkbook } from '../warehouse/stock-documents-api';
import { usePageFilters } from '../warehouse/workspace-route';
import { QueryState } from '../warehouse/WarehouseUi';
import { FinancePeriod } from './FinancePeriod';
import { financeKey } from './api';
import { financeDay, financeMoney } from './finance-format';

type ReportRow = { label: string; value: number | null; percent: number | null; detail: boolean };

export function ProfitLossPage() {
  const { canAction } = usePermissions();
  const today = financeDay();
  const [{ pnlFrom, pnlTo }, update] = usePageFilters({ pnlFrom: today.slice(0, 7) + '-01', pnlTo: today });
  const params = { from: pnlFrom, to: pnlTo };
  const endpoint = '/admin/finance/profit-loss';
  const query = useQuery({ queryKey: [...financeKey, 'profit-loss', params],
    queryFn: async ({ signal }) => (await api.get<{ rows: ReportRow[] }>(endpoint, { params, signal })).data });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.get<Blob>(endpoint + '.xlsx', { params, responseType: 'blob' });
      downloadWarehouseWorkbook(data, `Прибыли и убытки ${pnlFrom} — ${pnlTo}.xlsx`);
    } catch (failure) { setError(apiError(failure)); }
    finally { setBusy(false); }
  }
  return <section aria-label="Отчёт о прибылях и убытках">
    <WorkspaceHeaderActions>
      {canAction('exportReports') && <button className="workspace-tool" type="button" disabled={busy || !query.data}
        onClick={() => void download()}><IconExport />Экспорт в Excel</button>}
    </WorkspaceHeaderActions>
    <div className="poster-toolbar">
      <FinancePeriod from={pnlFrom} to={pnlTo} onApply={({ from, to }) => update({ pnlFrom: from, pnlTo: to })} />
    </div>
    {error && <p role="alert" className="text-danger">{error}</p>}
    <QueryState pending={query.isPending} error={query.error}>
      <table className="poster-table w-full"><thead><tr><th scope="col">Статья</th><th scope="col" className="text-right">Сумма</th>
        <th scope="col" className="text-right">Доля дохода</th></tr></thead><tbody>
        {query.data?.rows.map((row, index) => <tr key={index} className={row.detail ? 'text-text-secondary' : 'bg-background font-semibold'}>
          <td className={row.detail ? 'pl-6' : ''}>{row.label}</td><td className="text-right tabular-nums">{financeMoney(row.value)}</td>
          <td className="text-right tabular-nums">{row.percent == null ? '—' : row.percent.toLocaleString('ru-RU') + '%'}</td>
        </tr>)}
      </tbody></table>
      <p className="mt-3 text-sm text-text-secondary">Продажи учтены по дате закрытия чека, доходы и расходы — по дате сделки.
        Оплаты поставщикам относятся к дате поставки. Их включение в расходы задаёт категория «Поставки».</p>
      {query.data?.rows.some((row) => row.value == null) && <p className="mt-1 text-sm text-text-secondary">Для части позиций неизвестна себестоимость. Зависящие от неё итоги отмечены прочерком.</p>}
    </QueryState>
  </section>;
}
