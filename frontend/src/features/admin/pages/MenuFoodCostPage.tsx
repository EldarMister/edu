import { IconExport } from '@/features/admin/components/icons';
import { useDeferredValue, useState } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { exportCsv } from '@/lib/report-output';
import { WorkspacePending } from '../components/WorkspacePending';
import { MenuFoodCostCalculation } from './MenuFoodCostCalculation';
import { FoodCostPositions, FoodCostIngredients, foodCostExportRows, formatFoodCost, formatPercent, priceCaption } from './FoodCostReportTables';
import { FoodCostPriceBasket, usePriceBasket } from './FoodCostPriceBasket';
import { downloadFoodCostExcel, useFoodCostAnalysis, useFoodCostReport, type FoodCostMetric, type FoodCostPosition, type FoodCostRange, type FoodCostReport, type FoodCostTab } from './food-cost-api';
import { foodCostInsights, MAX_MENU_PRICE, percentChange, projectFoodCostPrice } from './food-cost-model';
import { financeDateTime, financeMoney, parseMoney } from './finance/finance-format';
import type { MenuCostRow } from './menu-cost-api';
import { WorkspaceSearch } from './WorkspaceSearch';
import { COMPARISON_PERIODS, ReportPeriodFilter } from './warehouse/ReportPeriodFilter';
import { calendarDate, warehouseDay, warehousePeriodRange } from './warehouse/warehouse-period';
import { usePageFilters } from './warehouse/workspace-route';
import './food-cost-report.css';

type MenuLink = Pick<MenuCostRow, 'dishId' | 'variantId' | 'isSet' | 'catalogKind'>;
const dayFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const measures = [
  { key: 'revenue', label: 'Выручка', prefersLower: false },
  { key: 'cost', label: 'Себестоимость', prefersLower: true },
  { key: 'margin', label: 'Маржа', prefersLower: false },
  { key: 'foodCostPercent', label: 'Фудкост', prefersLower: true },
] as const;
type Measure = typeof measures[number]['key'];

function formatDay(day: string) { return dayFormatter.format(new Date(day + 'T00:00:00Z')); }
function periodLabel(from: string, to: string) {
  return from === to ? formatDay(from) : `${formatDay(from)} — ${formatDay(to)}`;
}

export function MenuFoodCostPage({ onOpen }: { onOpen: (row: MenuLink) => void }) {
  const [filters, setFilters] = usePageFilters({
    foodMode: 'report', foodReportPeriod: 'lastWeek', foodReportFrom: '', foodReportTo: '',
    foodReportTab: 'positions', foodReportSearch: '',
  });
  return <section aria-label="Фудкост меню" className="food-cost-workspace min-w-0 space-y-5">
    <nav className="food-cost-tabs" aria-label="Разделы фудкоста">
      <button type="button" aria-current={filters.foodMode !== 'calculation' ? 'page' : undefined}
        onClick={() => setFilters({ foodMode: 'report' })}>Контроль за период</button>
      <button type="button" aria-current={filters.foodMode === 'calculation' ? 'page' : undefined}
        onClick={() => setFilters({ foodMode: 'calculation' })}>Текущая калькуляция</button>
    </nav>
    {filters.foodMode === 'calculation' ? <MenuFoodCostCalculation onOpen={onOpen} /> : <FoodCostControl onOpen={onOpen} />}
  </section>;
}

function FoodCostControl({ onOpen }: { onOpen: (row: MenuLink) => void }) {
  const { canAction, canEditSection } = usePermissions();
  const canExport = canAction('exportReports');
  const canApply = canEditSection('menu');
  const [filters, setFilters] = usePageFilters({
    foodReportPeriod: 'lastWeek', foodReportFrom: '', foodReportTo: '', foodReportTab: 'positions', foodReportSearch: '',
  });
  const preset = filters.foodReportPeriod === 'custom' ? 'custom'
    : COMPARISON_PERIODS.find(({ value }) => value === filters.foodReportPeriod)?.value ?? 'lastWeek';
  const today = warehouseDay();
  const range = warehousePeriodRange(preset, today, filters.foodReportFrom || calendarDate(today), filters.foodReportTo || calendarDate(today));
  const from = range.dateFrom ?? calendarDate(today);
  const to = range.dateTo ?? from;
  const tab: FoodCostTab = filters.foodReportTab === 'ingredients' ? 'ingredients' : 'positions';
  const search = useDeferredValue(filters.foodReportSearch).trim().slice(0, 160);
  const report = useFoodCostReport({ from, to });
  const basket = usePriceBasket();
  const [basketOpen, setBasketOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const data = report.data;
  const insights = data ? foodCostInsights(data) : null;
  const normalizedSearch = search.toLocaleLowerCase('ru');
  const positions = data?.positions.filter((row) => (row.name + ' ' + row.category).toLocaleLowerCase('ru').includes(normalizedSearch)) ?? [];
  const ingredients = data?.ingredients.filter((row) => row.name.toLocaleLowerCase('ru').includes(normalizedSearch)) ?? [];
  const label = periodLabel(from, to);

  function openPosition(row: FoodCostPosition) {
    if (row.dishId) onOpen({ dishId: row.dishId, variantId: row.variantId, isSet: row.isSet, catalogKind: row.catalogKind });
  }

  async function exportExcel() {
    setExporting(true);
    setExportError('');
    try {
      await downloadFoodCostExcel({ from, to }, tab, search);
    } catch (error) {
      setExportError(apiError(error));
    } finally {
      setExporting(false);
    }
  }

  function exportTable() {
    const { title, headings, rows } = foodCostExportRows(tab, positions, ingredients);
    exportCsv(`${title} ${from} — ${to}`, headings, rows);
  }

  return <>
    <header className="food-cost-report-header">
      <div>
        <h2>Фудкост за {label}</h2>
        {data && <p className="text-sm text-text-muted">Сравнение с {periodLabel(data.previous.from, data.previous.to)} · Обновлено {financeDateTime(data.asOf)}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ReportPeriodFilter comparison includeAll={false} confirmSelection label="Период фудкоста" today={today} range={range} preset={preset}
          onPreset={(foodReportPeriod) => setFilters({ foodReportPeriod, foodReportFrom: '', foodReportTo: '' })}
          onRange={(foodReportFrom, foodReportTo) => setFilters({ foodReportPeriod: 'custom', foodReportFrom, foodReportTo })} />
        <button type="button" className="btn-secondary btn-md" disabled={report.isFetching}
          onClick={() => void report.refetch()}>Обновить</button>
        {canApply && basket.entries.length > 0 && <button type="button" className="btn-primary btn-md"
          onClick={() => setBasketOpen(true)}>План цен · {basket.entries.length}</button>}
      </div>
    </header>
    {report.isError && <p className="text-sm text-danger" role="alert">{apiError(report.error)}</p>}
    {report.isPending && <WorkspacePending />}
    {data && insights && <>
      <FoodCostSummary report={data} />
      {(data.positions.length > 0 || data.ingredients.length > 0) &&
        <FoodCostAnalysis key={from + ':' + to + ':' + data.asOf} range={{ from, to }} drivers={insights.drivers} />}
      {insights.recommendations.length > 0 && <section aria-labelledby="food-cost-recommendations" className="space-y-3">
        <h3 id="food-cost-recommendations" className="food-cost-section-title">Рекомендации</h3>
        <div className="food-cost-panel food-cost-recommendations">
          {insights.recommendations.map((item) => {
            const row = data.positions.find((position) => position.id === item.positionId);
            const newPrice = item.newPrice;
            return <details key={item.id}>
              <summary>
                <span className="food-cost-priority" data-priority={item.priority}>
                  {{ critical: 'Критично', important: 'Проверить', opportunity: 'Возможность' }[item.priority]}
                </span>
                <span className="min-w-0 flex-1 font-medium">{item.title}</span>
                {item.monthlyMarginChange != null && <span className="food-cost-recommendation-impact">
                  {item.monthlyMarginChange > 0 ? '+' : ''}{financeMoney(item.monthlyMarginChange)} / 30 дн.
                </span>}
              </summary>
              <div className="food-cost-recommendation-body">
                <p>{item.text}</p>
                {row?.dishId && row.active && row.price != null && newPrice != null && <RecommendationPrice
                  key={[newPrice, row.price, basket.prices[row.id]].join(':')} report={data} row={row} suggested={newPrice}
                  planned={basket.prices[row.id]} onPlan={canApply ? basket.set : undefined} />}
              </div>
            </details>;
          })}
        </div>
      </section>}
      <section aria-label="Детализация фудкоста" className="space-y-3">
        <div className="food-cost-report-toolbar">
          <nav className="food-cost-tabs" aria-label="Данные отчёта">
            <button type="button" aria-current={tab === 'positions' ? 'page' : undefined}
              onClick={() => setFilters({ foodReportTab: 'positions', foodReportSearch: '' })}>Позиции</button>
            <button type="button" aria-current={tab === 'ingredients' ? 'page' : undefined}
              onClick={() => setFilters({ foodReportTab: 'ingredients', foodReportSearch: '' })}>Ингредиенты</button>
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            <WorkspaceSearch label={tab === 'positions' ? 'Поиск позиций' : 'Поиск ингредиентов'}
              value={filters.foodReportSearch} onChange={(foodReportSearch) => setFilters({ foodReportSearch })} />
            {canExport && <>
              <button type="button" className="btn-secondary btn-md" disabled={!(tab === 'positions' ? positions : ingredients).length}
                onClick={exportTable}><IconExport />CSV</button>
              <button type="button" className="btn-secondary btn-md" disabled={exporting || !(tab === 'positions' ? positions : ingredients).length}
                onClick={() => void exportExcel()}><IconExport />Excel</button>
            </>}
          </div>
        </div>
        {exportError && <p className="text-sm text-danger" role="alert">{exportError}</p>}
        {tab === 'positions' ? <FoodCostPositions report={data} rows={positions} search={!!search} canApply={canApply}
          draft={basket.prices} onPlan={basket.set} onOpen={openPosition} /> :
          <FoodCostIngredients rows={ingredients} search={!!search} />}
      </section>
      {canApply && basketOpen && <FoodCostPriceBasket basket={basket} report={data} close={() => setBasketOpen(false)} />}
    </>}
  </>;
}

function RecommendationPrice({ report, row, suggested, planned, onPlan }: {
  report: FoodCostReport; row: FoodCostPosition; suggested: number; planned?: number;
  onPlan?: (position: FoodCostPosition, price: number) => void;
}) {
  const [input, setInput] = useState(String(planned ?? suggested));
  const price = parseMoney(input);
  const valid = price != null && price >= 0 && price <= MAX_MENU_PRICE;
  const projection = valid && price !== row.price ? projectFoodCostPrice(report, row.id, price)?.position : null;
  return <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(event) => {
    event.preventDefault();
    if (projection && price != null && price !== planned) onPlan?.(row, price);
  }}>
    <label className="grid gap-1 text-sm">
      <span>Цена меню {financeMoney(row.price)}{priceCaption(row)} → Новая цена{priceCaption(row)}</span>
      <input className="input w-32" inputMode="decimal" aria-label={'Предложенная цена — ' + row.name}
        value={input} aria-invalid={!valid} onChange={(event) => setInput(event.target.value)} />
    </label>
    {onPlan && <button type="submit" className="btn-secondary btn-md" disabled={!projection || price === planned}>
      {price === planned ? 'В плане цен' : 'Добавить в план'}
    </button>}
    <output className="basis-full text-sm">{!valid ? 'Введите неотрицательную цену с точностью до двух знаков.' :
      projection ? 'Фудкост ' + formatFoodCost(projection.foodCostPercent) + ' · Изменение маржи за 30 дней ' +
        financeMoney(projection.monthlyMarginChange) : 'Цена совпадает с ценой меню.'}</output>
  </form>;
}

function FoodCostAnalysis({ range, drivers }: { range: FoodCostRange; drivers: ReturnType<typeof foodCostInsights>['drivers'] }) {
  const { available, analysis } = useFoodCostAnalysis(range);
  const [expanded, setExpanded] = useState(false);
  return <section aria-labelledby="food-cost-review" className="food-cost-panel food-cost-review">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id="food-cost-review">Что изменилось</h3>
      {available && <button type="button" className="btn-secondary btn-md" disabled={analysis.isPending}
        onClick={() => analysis.mutate()}>{analysis.isPending ? 'Готовим сводку…' : 'Объяснить с ИИ'}</button>}
    </div>
    {drivers.length ? <ul className="food-cost-drivers">
      {(expanded ? drivers : drivers.slice(0, 1)).map((driver) => <li key={driver.kind}><strong>{driver.title}</strong><p>{driver.text}</p></li>)}
    </ul> : <p className="text-sm text-text-muted">
      Пока недостаточно сопоставимых продаж и поставок, чтобы определить причины изменений.
    </p>}
    {drivers.length > 1 && <button type="button" className="mt-3 text-sm text-primary" aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)}>{expanded ? 'Свернуть' : 'Показать больше'}</button>}
    {analysis.data && <div className="mt-4 border-t border-border pt-3" role="status">
      <h4 className="font-semibold">Сводка ИИ</h4>
      <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">{analysis.data.text}</p>
    </div>}
    {analysis.isError && <p className="mt-2 text-sm text-danger" role="alert">{apiError(analysis.error)}</p>}
  </section>;
}

function FoodCostSummary({ report }: { report: FoodCostReport }) {
  return <section aria-label="Итоги фудкоста" className="food-cost-metrics">
    {measures.map(({ key, label, prefersLower }) => {
      const current = report.current.totals[key];
      const previous = report.previous.totals[key];
      const percentPoints = key === 'foodCostPercent';
      const change = percentPoints && current != null && previous != null
        ? current - previous : percentPoints ? null : percentChange(current, previous);
      return <article className="food-cost-panel food-cost-metric" key={key}>
        <div className="food-cost-metric-title">{label}</div>
        <div className="food-cost-metric-value">{percentPoints ? formatFoodCost(current) : financeMoney(current)}</div>
        <div className="food-cost-metric-comparison" data-tone={change == null || change === 0 ? 'neutral'
          : (change > 0) === prefersLower ? 'negative' : 'positive'}>
          {change == null ? 'Нет базы для сравнения' : `${formatPercent(change, percentPoints)} к предыдущему периоду`}
        </div>
        <DailyTrend days={report.current.days} measure={key} label={label} />
      </article>;
    })}
    {report.current.totals.cost == null && <p className="food-cost-data-note" role="status">
      В части продаж отсутствует подтверждённая себестоимость. Фудкост и маржа показаны там, где известна стоимость всего расхода.
    </p>}
  </section>;
}

function DailyTrend({ days, measure, label }: { days: FoodCostReport['current']['days']; measure: Measure; label: string }) {
  const values = days.map((day: FoodCostMetric) => day[measure]);
  const known = values.filter((value): value is number => value != null);
  if (known.length < 2) return null;
  const min = Math.min(...known), max = Math.max(...known);
  const points = values.map((value, i) => value == null ? null : {
    x: 3 + i * 66 / (days.length - 1), y: min === max ? 15 : 27 - (value - min) * 24 / (max - min),
  });
  const path = points.map((point, i) => point ? (points[i - 1] ? 'L' : 'M') + point.x + ' ' + point.y : '').join(' ');
  const last = points[values.lastIndexOf(known[known.length - 1])];
  const delta = known[known.length - 1] - known[0];
  const positive = measure === 'margin' || measure === 'revenue' ? delta > 0 : delta < 0;
  return <svg className="food-cost-trend" viewBox="0 0 72 30" role="img" data-tone={delta === 0 ? 'neutral' : positive ? 'positive' : 'negative'}
    aria-label={'Динамика по дням. ' + label}>
    <title>{days.map((day) => formatDay(day.date) + ' · ' + (measure === 'foodCostPercent' ? formatFoodCost(day[measure]) : financeMoney(day[measure]))).join('\n')}</title>
    <path d={path} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none" />
    {last && <circle cx={last.x} cy={last.y} r="2.5" fill="currentColor" />}
  </svg>;
}
