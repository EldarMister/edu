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
            <p className="mt-2 rounded-lg bg-warning/10 p-3 text-sm">{query.data.warning}</p>
            <p className="mt-2 text-xs text-text-muted">{query.data.valuationRule}</p>
          </>
        )}
        {(error || query.isError) && (
          <p role="alert" className="text-danger">
            {error || apiError(query.error)}
          </p>
        )}
      </section>
      <section className="border-t border-border pt-3">
        <h4 className="font-semibold">Единицы измерения</h4>
        <p className="mt-2 text-sm text-text-secondary">
          Масса: г и кг (1 кг = 1000 г). Объём: мл и л (1 л = 1000 мл). Поштучный учёт: шт. Фасовки
          настраиваются в разделе «Склад → Фасовки».
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Масса и объём автоматически друг в друга не переводятся.
        </p>
      </section>
      <section className="border-t border-border pt-3">
        <h4 className="font-semibold">Доступ сотрудников</h4>
        <p className="mt-2 text-sm text-text-secondary">
          Используйте «Персонал → Права сотрудника». Там отдельно разрешаются приходы, перемещения, списания,
          подсчёт, утверждение, рецептуры, производство, себестоимость, отчёты и настройки склада.
        </p>
      </section>
    </div>
  );
}
