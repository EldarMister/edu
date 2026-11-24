import { useState } from 'react';
import { WorkspacePending } from '../../components/WorkspacePending';
import { apiError } from '@/lib/api';
import { useWarehousePolicy, useUpdateWarehousePolicy } from './settings-api';
import { WRITEOFF_REASONS } from './stock-document-format';
export function AccountingSettings() {
  const query = useWarehousePolicy();
  const update = useUpdateWarehousePolicy();
  const [error, setError] = useState('');
  const expenses = query.data?.expenseWriteoffReasons ?? [];
  async function set(allowed: boolean) {
    setError('');
    try {
      await update.mutateAsync({ allowNegativeIngredientStock: allowed });
    } catch (err) {
      setError(apiError(err));
    }
  }
  if (query.isPending) return <WorkspacePending />;
  return (
    <div className="space-y-4">
      <section>
        <h4 className="mb-3 font-semibold">Операции склада</h4>
        {query.data && ([
          { key: 'warehouseProductionEnabled' as const, label: 'Производство полуфабрикатов', inUse: query.data.productionInUse },
          { key: 'warehouseProcessingEnabled' as const, label: 'Переработки и разделка', inUse: query.data.processingInUse },
        ]).map((option) => <div key={option.key} className="mb-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={query.data![option.key] || option.inUse} disabled={update.isPending || option.inUse}
              onChange={async (event) => {
                try { setError(''); await update.mutateAsync({ [option.key]: event.target.checked }); }
                catch (err) { setError(apiError(err)); }
              }} />
            {option.label}
          </label>
          {option.inUse && <p className="ml-6 mt-1 text-xs text-text-muted">Раздел доступен для существующих рецептур и документов.</p>}
        </div>)}
      </section>
      <section>
        <h4 className="mb-1 font-semibold">Списания в отчёте о прибылях и убытках</h4>
        <p className="mb-3 text-sm text-text-secondary">Выберите причины, которые нужно включить в расходы. Остальные списания войдут в себестоимость.</p>
        {query.data && WRITEOFF_REASONS.map(({ value, label }) => <label key={value} className="mb-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={expenses.includes(value)} disabled={update.isPending}
            onChange={async (event) => {
              setError('');
              const next = event.target.checked ? [...expenses, value] : expenses.filter((reason) => reason !== value);
              try { await update.mutateAsync({ expenseWriteoffReasons: next }); } catch (err) { setError(apiError(err)); }
            }} />{label}
        </label>)}
      </section>
      <section>
        <h4 className="mb-2 font-semibold">Отрицательные остатки</h4>
        {query.data && (
          <>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={query.data.allowNegativeIngredientStock}
                disabled={update.isPending}
                onChange={(e) => void set(e.target.checked)}
              />
              <span>Разрешить продажи при нехватке товара</span>
            </label>
            {query.data.allowNegativeIngredientStock && <p className="mt-2 text-sm text-text-secondary">При отрицательном остатке себестоимость будет предварительной. Оформляйте поставки вовремя.</p>}
          </>
        )}
        {(error || query.isError) && (
          <p role="alert" className="text-danger">
            {error || apiError(query.error)}
          </p>
        )}
      </section>
    </div>
  );
}
