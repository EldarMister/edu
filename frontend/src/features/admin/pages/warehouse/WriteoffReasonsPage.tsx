import { useState } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { RowIconButton } from '../../components/RowIconButton';
import { RowActionMenu } from '../../components/RowActionMenu';
import { WorkspaceHeaderActions } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { useListPeriod } from './ListPeriodFilter';
import { useRemoveWriteoffReason, useStockDocuments, useWriteoffReasons, type WriteoffReasonOption } from './stock-documents-api';
import { writeoffPostedTotals } from './stock-document-format';
import { balanceMoney } from './balance-format';
import { QueryState } from './WarehouseUi';
import { WriteoffReasonEditor } from './WriteoffReasonField';
import { RemoveDirectoryEntry } from './RemoveDirectoryEntry';
import { WriteoffReasonBadge } from './WriteoffReasonBadge';
import { usePageFilters } from './workspace-route';
import { WarehouseFilters } from './WarehouseFilters';

export function WriteoffReasonsPage({ onSelect, navigation }: {
  onSelect: (id: string, period: Pick<ReturnType<typeof useListPeriod>, 'preset' | 'range'>) => void;
  navigation: React.ReactNode;
}) {
  const [editor, setEditor] = useState<WriteoffReasonOption | 'new' | null>(null);
  const [removing, setRemoving] = useState<WriteoffReasonOption | null>(null);
  const remove = useRemoveWriteoffReason();
  const [{ writeoffReasonsSearch: search }, update] = usePageFilters({
    writeoffReasonsSearch: '', writeoffReasonsPeriod: 'all', writeoffReasonsFrom: '', writeoffReasonsTo: '',
  });
  const period = useListPeriod('writeoffReasons');
  const reasons = useWriteoffReasons();
  const documents = useStockDocuments(undefined, 'writeoff');
  const { can } = usePermissions();
  const showCost = can('actions.warehouseCosts');
  const editable = can('actions.warehouseSettings');
  const filtered = (reasons.data ?? []).filter(({ label }) => label.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  const linked = new Map<string, NonNullable<typeof documents.data>>();
  for (const item of documents.data ?? []) {
    const reason = item.writeoffReasonId ?? item.reason;
    if (!reason || !period.includes(item.effectiveAt ?? item.postedAt ?? item.createdAt)) continue;
    const group = linked.get(reason);
    if (group) group.push(item);
    else linked.set(reason, [item]);
  }
  const total = writeoffPostedTotals(filtered.flatMap(({ id }) => linked.get(id) ?? []));
  const cost = (summary: typeof total) => <>{balanceMoney(summary.amount)}{summary.partial && <span className="block text-xs text-text-muted">Неполная оценка</span>}</>;
  if (editor) return <WriteoffReasonEditor page reason={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSaved={() => setEditor(null)} />;
  return <>
    {navigation}
    <WorkspaceHeaderActions>
      {editable && <button type="button" className="btn-primary btn-md" onClick={() => setEditor('new')}>Добавить причину</button>}
    </WorkspaceHeaderActions>
    <div className="poster-register-surface">
      <div className="poster-toolbar">
        <WarehouseFilters view="writeoff-reasons" onClear={update} filters={[
          { key: 'period', label: 'Период', defaultVisible: true, control: period.filter,
            clear: period.active ? { writeoffReasonsPeriod: 'all', writeoffReasonsFrom: '', writeoffReasonsTo: '' } : undefined },
        ]} />
        <WorkspaceSearch label="Поиск причин" placeholder="Поиск причин" value={search}
          onChange={(value) => update({ writeoffReasonsSearch: value })} />
      </div>
      <QueryState pending={reasons.isPending || documents.isPending} error={reasons.error ?? documents.error} empty={!filtered.length}>
        <div className="overflow-x-auto"><table className="poster-table poster-register-table w-full min-w-[580px] text-left text-sm">
          <thead><tr><th>Название</th><th>Блок в P&L</th><th className="text-right">Проведено списаний</th>
            {showCost && <th className="text-right">Стоимость продуктов</th>}<th /></tr></thead>
          <tbody>{filtered.map((reason) => {
            const summary = writeoffPostedTotals(linked.get(reason.id) ?? []);
            return <tr key={reason.id}>
              <td><button type="button" className="text-left text-primary" onClick={() => onSelect(reason.id, period)}>
                <WriteoffReasonBadge id={reason.id}>{reason.label}</WriteoffReasonBadge>
              </button></td>
              <td>{reason.expense ? 'Расходы' : 'Себестоимость'}</td>
              <td className="text-right tabular-nums">{summary.count}</td>
              {showCost && <td className="text-right tabular-nums">{cost(summary)}</td>}
              <td>{editable && <div className="poster-row-actions">
                {reason.custom && <RowIconButton icon="edit" label={`Редактировать причину «${reason.label}»`} onClick={() => setEditor(reason)} />}
                <RowActionMenu label={reason.label} action="Удалить" onAction={() => { remove.reset(); setRemoving(reason); }} />
              </div>}</td>
            </tr>;
          })}</tbody>
          <tfoot><tr className="border-t border-border font-medium"><td colSpan={2}>Итого</td><td className="text-right tabular-nums">{total.count}</td>
            {showCost && <td className="text-right tabular-nums">{cost(total)}</td>}<td /></tr></tfoot>
        </table></div>
      </QueryState>
    </div>
    {removing && <RemoveDirectoryEntry title="Удалить причину списания?" pending={remove.isPending} error={remove.error}
      onClose={() => setRemoving(null)} onRemove={() => remove.mutate(removing.id, { onSuccess: () => setRemoving(null) })}>
      Причина «{removing.label}» исчезнет из списка выбора. Она сохранится в списаниях, в которых уже использована.
    </RemoveDirectoryEntry>}
  </>;
}
