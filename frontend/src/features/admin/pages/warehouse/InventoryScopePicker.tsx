import { useEffect, useId, useRef, useState } from 'react';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { inventoryScopeGroups, toggleInventoryScope, type InventoryScopeProduct } from './inventory-workflow';
import './inventory-workspace.css';

function ScopeCheckbox({ label, checked, mixed, disabled, onChange }: {
  label: string; checked: boolean; mixed?: boolean; disabled?: boolean; onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!mixed; }, [mixed]);
  return <input ref={ref} type="checkbox" className="h-4 w-4 shrink-0 accent-primary" aria-label={label}
    aria-checked={mixed ? 'mixed' : checked} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />;
}

export function InventoryScopePicker({ products, selected, onChange, disabled, loading, error, onRetry }: {
  products: (InventoryScopeProduct & { unit: string })[];
  selected: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const id = useId();
  const groups = inventoryScopeGroups(products, search);
  const selectedIds = new Set(selected);
  const shown = groups.flatMap((group) => group.items.map((item) => item.id));
  const selectedShown = shown.filter((itemId) => selectedIds.has(itemId)).length;
  function toggle(key: string) { setExpanded((current) => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next; }); }
  const select = (ids: string[], checked: boolean) => onChange(toggleInventoryScope(selected, ids, checked));
  return <section className="poster-inventory-scope" aria-label="Продукты частичной инвентаризации">
    <p className="mb-3 text-sm text-text-secondary">Выберите продукты или категории, которые будете проверять.</p>
    <div className="poster-inventory-scope-toolbar">
      <WorkspaceSearch label="Быстрый поиск продуктов и категорий" value={search} onChange={setSearch} />
      <span role="status" className="text-sm text-text-muted">Выбрано: {selected.length}{search.trim() && selected.length > selectedShown ? ` · вне поиска: ${selected.length - selectedShown}` : ''}</span>
      {!!selected.length && <button type="button" className="ml-auto text-sm text-primary" disabled={disabled} onClick={() => onChange([])}>Снять выбор</button>}
    </div>
    {loading ? <p role="status" className="py-5 text-sm text-text-muted">Загрузка продуктов…</p> : error ? <p role="alert" className="py-5 text-sm text-danger">Не удалось загрузить продукты. <button type="button" className="text-primary" onClick={onRetry}>Повторить загрузку</button></p> : <>
      <label className="poster-inventory-scope-all"><ScopeCheckbox label="Выбрать все найденные продукты" checked={shown.length > 0 && selectedShown === shown.length} mixed={selectedShown > 0 && selectedShown < shown.length} disabled={disabled || !shown.length} onChange={(checked) => select(shown, checked)} /><span>{search.trim() ? 'Все найденные продукты' : 'Все продукты'}</span><span className="text-text-muted">{shown.length}</span></label>
      {groups.map((group, groupIndex) => {
        const groupIds = group.items.map((item) => item.id);
        const count = groupIds.filter((itemId) => selectedIds.has(itemId)).length;
        const open = !!search.trim() || expanded.has(group.id);
        const bodyId = `${id}-group-${groupIndex}`;
        return <div key={group.id} className="poster-inventory-scope-group">
          <div className="poster-inventory-scope-heading">
            <ScopeCheckbox label={`Выбрать группу ${group.name}`} checked={groupIds.length > 0 && count === groupIds.length} mixed={count > 0 && count < groupIds.length} disabled={disabled || !groupIds.length} onChange={(checked) => select(groupIds, checked)} />
            <button type="button" aria-expanded={open} aria-controls={bodyId} disabled={!group.items.length} onClick={() => toggle(group.id)}><span aria-hidden className="poster-inventory-scope-arrow">{open ? '⌄' : '›'}</span>{group.name}<span className="text-xs text-text-muted">{group.items.length ? `${count} из ${group.items.length}` : 'Нет продуктов'}</span></button>
          </div>
          <div id={bodyId} hidden={!open}>{group.categories.map((category, categoryIndex) => {
            const categoryKey = `${group.id}:${category.name}`;
            const categoryIds = category.items.map((item) => item.id);
            const categoryCount = categoryIds.filter((itemId) => selectedIds.has(itemId)).length;
            const categoryOpen = !!search.trim() || expanded.has(categoryKey);
            const categoryBodyId = `${bodyId}-category-${categoryIndex}`;
            return <div key={category.name} className="poster-inventory-scope-category">
              <div className="poster-inventory-scope-heading">
                <ScopeCheckbox label={`Выбрать категорию ${category.name} в группе ${group.name}`} checked={categoryCount === categoryIds.length} mixed={categoryCount > 0 && categoryCount < categoryIds.length} disabled={disabled} onChange={(checked) => select(categoryIds, checked)} />
                <button type="button" aria-expanded={categoryOpen} aria-controls={categoryBodyId} onClick={() => toggle(categoryKey)}><span aria-hidden className="poster-inventory-scope-arrow">{categoryOpen ? '⌄' : '›'}</span>{category.name}<span className="text-xs text-text-muted">{categoryCount} из {categoryIds.length}</span></button>
              </div>
              <div id={categoryBodyId} hidden={!categoryOpen}>{category.items.map((item) => <label key={item.id} className="poster-inventory-scope-product">
                <ScopeCheckbox label={`Выбрать ${item.name}`} checked={selectedIds.has(item.id)} disabled={disabled} onChange={(checked) => select([item.id], checked)} />
                <span>{item.name}</span><span className="ml-auto whitespace-nowrap text-text-muted">{item.unit}</span>
              </label>)}</div>
            </div>;
          })}</div>
        </div>;
      })}
      {!shown.length && <p role="status" className="py-5 text-sm text-text-muted">{search.trim() ? 'Продукты не найдены. Измените поиск.' : 'Нет продуктов для проверки.'}</p>}
    </>}
  </section>;
}
