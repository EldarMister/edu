import { useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { useWarehousePolicy, useUpdateWarehousePolicy } from './settings-api';
export function AccountingSettings() {
  const query = useWarehousePolicy();
  const update = useUpdateWarehousePolicy();
  const [error, setError] = useState('');
  async function set(allowed: boolean) {
    setError('');
    try {
      await update.mutateAsync({ allowNegativeIngredientStock: allowed });
    } catch (err) {
      setError(apiError(err));
    }
  }
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
        <h4 className="mb-2 font-semibold">Отрицательные остатки</h4>
        {query.isPending && <Spinner />}
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
