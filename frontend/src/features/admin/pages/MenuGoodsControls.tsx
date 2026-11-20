import { useEffect, useRef, useState } from 'react';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { WorkspaceHeaderActions } from './WorkspaceHeader';
import { visibleWarehouseColumns, WarehouseColumnSettings } from './warehouse/WarehouseColumnSettings';
import { WarehouseMultiFilter, warehouseMultiFilterValues } from './warehouse/WarehouseMultiFilter';
import type { AdminGood } from '../api';
import { effectiveMenuTaxId } from '../../settings/MenuTaxSelect';

export const menuGoodsColumns = {
  name: 'Название', category: 'Категория', price: 'Цена', station: 'Цех', barcode: 'Штрихкод',
  unit: 'Ед. измерения', weighted: 'Весовой товар', availability: 'Доступность', tax: 'Налог',
};
export type MenuGoodsColumn = Exclude<keyof typeof menuGoodsColumns, 'name'>;
type Column = keyof typeof menuGoodsColumns;
const columnOptions = Object.keys(menuGoodsColumns) as Column[];
const defaults: Column[] = ['name', 'category', 'price'];

export const menuListFilters = {
  search: '', category: '', station: '', availability: '', goodsName: '', barcode: '', goodsUnit: '', goodsWeighted: '', tax: '', nameSort: 'asc',
};
type Filters = typeof menuListFilters;
type Option = { value: string; label: string };

export function filterMenuGoods(items: AdminGood[], filters: Filters) {
  const categories = warehouseMultiFilterValues(filters.category);
  const stations = warehouseMultiFilterValues(filters.station);
  const units = warehouseMultiFilterValues(filters.goodsUnit);
  const search = filters.search.trim().toLocaleLowerCase();
  const name = filters.goodsName.trim().toLocaleLowerCase();
  const barcode = filters.barcode.trim().toLocaleLowerCase();
  return items.filter((item) => {
    const itemName = item.name.toLocaleLowerCase();
    return (!search || itemName.includes(search)) && (!name || itemName.includes(name))
      && (!categories.length || categories.includes(item.categoryId))
      && (!stations.length || stations.includes(item.goodsStation))
      && (!barcode || item.barcodes.some((code) => code.toLocaleLowerCase().includes(barcode)))
      && (!units.length || item.goodsUnits.some((unit) => units.includes(unit)))
      && (!filters.tax || (effectiveMenuTaxId(item) ?? 'none') === filters.tax)
      && (!filters.goodsWeighted || !!item.isWeighted === (filters.goodsWeighted === 'yes'))
      && (!filters.availability || (item.isAvailable && item.isActive) === (filters.availability === 'visible'));
  });
}

export function useMenuGoodsColumns(enabled: boolean) {
  const userId = useAuth((state) => state.user?.id);
  const key = `edu-pos-menu-goods-columns:${userId ?? ''}`;
  const [stored, setStored] = useState(() => {
    if (!enabled || !userId) return '';
    try { return localStorage.getItem(key) ?? ''; }
    catch { return ''; }
  });
  return {
    columns: stored ? visibleWarehouseColumns(stored, columnOptions) : defaults,
    saveColumns(columns: Column[]) {
      const value = columns.join(',');
      setStored(value);
      if (userId) {
        try { localStorage.setItem(key, value); }
        catch { /* The current table keeps the selection. */ }
      }
    },
  };
}

export function MenuGoodsHeader({ filters, columns, saveColumns, ready, canExport }: {
  filters: Filters;
  columns: Column[];
  saveColumns: (columns: Column[]) => void;
  ready: boolean;
  canExport: boolean;
}) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  async function exportGoods() {
    if (!canExport || exporting) return;
    setExporting(true);
    setError('');
    try {
      const params = new URLSearchParams({ columns: columns.join(','), sort: filters.nameSort === 'desc' ? 'desc' : 'asc' });
      const values = { search: filters.search, name: filters.goodsName, barcode: filters.barcode,
        weighted: filters.goodsWeighted, availability: filters.availability, tax: filters.tax };
      Object.entries(values).forEach(([key, value]) => { if (value.trim()) params.set(key, value.trim()); });
      warehouseMultiFilterValues(filters.category).forEach((value) => params.append('categories', value));
      warehouseMultiFilterValues(filters.station).forEach((value) => params.append('stations', value));
      warehouseMultiFilterValues(filters.goodsUnit).forEach((value) => params.append('units', value));
      const response = await api.get<Blob>(`/admin/menu/goods/export.xlsx?${params}`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Товары.xlsx';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(apiError(failure)); }
    finally { setExporting(false); }
  }
  return <>
    <WorkspaceHeaderActions>
      <button type="button" className="supply-header-action" onClick={() => setColumnsOpen(true)}>Столбцы</button>
      {canExport && <button type="button" className="supply-header-action" disabled={!ready || exporting}
        onClick={() => void exportGoods()}>{exporting ? 'Выгрузка…' : 'Экспорт'}</button>}
    </WorkspaceHeaderActions>
    {columnsOpen && <WarehouseColumnSettings columns={columns} defaults={columnOptions} resetColumns={defaults}
      label={(key) => menuGoodsColumns[key]} onClose={() => setColumnsOpen(false)}
      onApply={(selected) => { saveColumns(selected); setColumnsOpen(false); }} />}
    {error && <p className="py-2 text-sm text-danger" role="alert">{error}</p>}
  </>;
}

const extraFields = {
  goodsName: 'Название', barcode: 'Штрихкод', goodsWeighted: 'Весовой товар', goodsUnit: 'Ед. измерения', availability: 'Доступность', tax: 'Налог',
};
type Field = keyof typeof extraFields;
const fieldKeys = Object.keys(extraFields) as Field[];
const weightedOptions = [{ value: 'yes', label: 'Да' }, { value: 'no', label: 'Нет' }];
const availabilityOptions = [{ value: 'visible', label: 'Доступен в меню' }, { value: 'hidden', label: 'Скрыт' }];

export function MenuGoodsFilters({ filters, update, categories, stations, units, taxes }: {
  filters: Filters;
  update: (patch: Partial<Filters>) => void;
  categories: Option[];
  stations: Option[];
  units: Option[];
  taxes: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<Field | ''>('');
  const root = useRef<HTMLDivElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const options: Partial<Record<Field, Option[]>> = { goodsWeighted: weightedOptions, availability: availabilityOptions, tax: taxes };
  const fieldOptions = field ? options[field] : undefined;
  function caption(key: Field) {
    if (key === 'goodsUnit') return warehouseMultiFilterValues(filters.goodsUnit).join(', ');
    return options[key]?.find((option) => option.value === filters[key])?.label ?? filters[key];
  }

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return <>
    <WarehouseMultiFilter label="Категория" value={filters.category} onChange={(category) => update({ category })} options={categories} />
    <WarehouseMultiFilter label="Цех" value={filters.station} onChange={(station) => update({ station })} options={stations} />
    <div ref={root} className="relative flex flex-wrap items-center gap-2" onKeyDown={(event) => {
      if (event.key === 'Escape' && open) { setOpen(false); add.current?.focus(); }
    }}>
      {fieldKeys.filter((key) => filters[key]).map((key) => <div key={key}
        className="flex min-h-8 items-center rounded-lg border border-primary/20 bg-primary/10 text-sm text-primary">
        <button type="button" className="max-w-48 truncate px-2 py-1" title={caption(key)}
          onClick={() => { setField(key); setOpen(true); }}>
          {extraFields[key]}: {caption(key)}
        </button>
        <button type="button" className="px-2 py-1" aria-label={`Очистить фильтр «${extraFields[key]}»`}
          onClick={() => update({ [key]: '' })}>×</button>
      </div>)}
      <button ref={add} type="button" className="min-h-8 px-2 text-sm text-primary"
        aria-haspopup="dialog" aria-expanded={open} onClick={() => { setField(''); setOpen(!open); }}>+ Фильтр</button>
      {open && <div role="dialog" aria-label="Дополнительный фильтр"
        className="absolute right-0 top-full z-30 mt-2 grid w-64 gap-2 rounded-xl border border-border bg-card p-3 shadow-soft max-sm:fixed max-sm:inset-x-4 max-sm:top-32 max-sm:w-auto">
        <select aria-label="Поле фильтра" className="input" value={field}
          onChange={(event) => setField(event.target.value as Field | '')}>
          <option value="">Выберите поле</option>
          {fieldKeys.map((key) => <option key={key} value={key}>{extraFields[key]}</option>)}
        </select>
        {field === 'goodsUnit' ? <MenuGoodsUnitOptions units={units} value={filters.goodsUnit}
          onChange={(goodsUnit) => update({ goodsUnit })} /> : field && (fieldOptions
          ? <select aria-label={extraFields[field]} className="input" value={filters[field]}
              onChange={(event) => update({ [field]: event.target.value })}>
              <option value="">Все</option>
              {fieldOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          : <input type="search" className="input" aria-label={extraFields[field]} placeholder={extraFields[field]}
              maxLength={160} value={filters[field]} onChange={(event) => update({ [field]: event.target.value })} />)}
      </div>}
    </div>
  </>;
}

function MenuGoodsUnitOptions({ units, value, onChange }: { units: Option[]; value: string; onChange: (value: string) => void }) {
  const [search, setSearch] = useState('');
  const selected = warehouseMultiFilterValues(value);
  const visible = units.filter((unit) => unit.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const choose = (values: string[]) => onChange(values.length ? JSON.stringify(values) : '');
  return <div className="grid gap-2">
    <div className="flex gap-3 text-sm text-primary">
      <button type="button" onClick={() => choose(units.map((unit) => unit.value))}>Выбрать все</button>
      <button type="button" onClick={() => choose([])}>Очистить</button>
    </div>
    <input type="search" className="input" aria-label="Поиск единицы измерения"
      placeholder="Поиск" value={search} onChange={(event) => setSearch(event.target.value)} />
    <div className="max-h-40 overflow-y-auto" role="group" aria-label="Ед. измерения">
      {visible.map((unit) => <label key={unit.value} className="flex min-h-8 items-center gap-2 rounded px-2 text-sm hover:bg-background">
        <input type="checkbox" className="accent-primary" checked={selected.includes(unit.value)}
          onChange={(event) => choose(event.target.checked ? [...selected, unit.value] : selected.filter((item) => item !== unit.value))} />
        {unit.label}
      </label>)}
      {!visible.length && <p className="px-2 py-1 text-sm text-text-muted">Ничего не найдено</p>}
    </div>
  </div>;
}
