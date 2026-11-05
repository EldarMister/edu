import { ORDER_PERMISSION_STAGES, type WaiterOrderPermissions } from '@/lib/order-permissions';

export function OrderPermissionsSettings({ permissions, disabled, onPermissions }: {
  permissions: WaiterOrderPermissions; disabled?: boolean;
  onPermissions: (value: WaiterOrderPermissions) => void;
}) {
  return <details className="group rounded-2xl border border-border bg-white p-5" aria-labelledby="order-settings-heading">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
      <h2 id="order-settings-heading" className="text-lg font-semibold">Заказы</h2>
      <svg className="h-5 w-5 shrink-0 text-text-muted transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </summary>
    <div className="mt-5 space-y-5">
    <div>
      <h3 className="font-semibold">Права официантов</h3>
      <p className="mt-1 text-sm text-text-muted">Правила применяются к каждой позиции отдельно. Удаление, замена и уменьшение количества требуют разрешения на отмену.</p>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead><tr className="border-b border-border"><th className="py-3">Этап блюда / заказа</th><th className="px-3">Отмена</th><th className="px-3">Редактирование</th></tr></thead>
        <tbody>{ORDER_PERMISSION_STAGES.map(([stage, label]) => <tr key={stage} className="border-b border-border/60">
          <td className="py-3 pr-3">{label}</td>
          {(['cancel', 'edit'] as const).map((action) => <td className="px-3" key={action}>
            <input type="checkbox" className="h-5 w-5 accent-primary" disabled={disabled}
              aria-label={`${action === 'cancel' ? 'Отмена' : 'Редактирование'}: ${label}`}
              checked={permissions[stage][action]}
              onChange={(e) => onPermissions({ ...permissions, [stage]: { ...permissions[stage], [action]: e.target.checked } })} />
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <p className="text-xs text-text-muted">Оплаченные позиции и закрытые чеки обрабатываются через права на отмену оплаты / возврат. Эти правила не разрешают менять оплату.</p>

    </div>
  </details>;
}
