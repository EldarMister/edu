import { Fragment, useState } from 'react';
import { financeMoney, parseMoney } from './finance/finance-format';
import { normalizeUnitLabel, unitLabel } from './warehouse/units';
import type { FoodCostIngredient, FoodCostPosition, FoodCostReport, FoodCostTab } from './food-cost-api';
import { aggregateFoodCostMetrics, MAX_MENU_PRICE, percentChange, projectFoodCostPrice } from './food-cost-model';

const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const compactDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const formatFoodCost = (value: number | null) => value == null ? '—' : decimal.format(value) + ' %';
export const formatPercent = (value: number, points = false) => (value > 0 ? '+' : '') + decimal.format(value) + (points ? ' п.п.' : ' %');

export function priceCaption(row: FoodCostPosition) {
  return row.priceUnit === 'pcs' ? '' : ' / ' + decimal.format(row.priceBasis) + ' ' + unitLabel(row.priceUnit);
}

function sold(row: FoodCostPosition) {
  return decimal.format(row.current.quantity * row.priceBasis) + ' ' + unitLabel(row.priceUnit);
}

function unitCost(row: FoodCostPosition) {
  return row.current.cost != null && row.current.quantity > 0 ? row.current.cost / row.current.quantity : null;
}

function compare(current: number | null, previous: number | null, goodWhenLower: boolean, points = false) {
  const delta = points ? (current != null && previous != null ? current - previous : null) : percentChange(current, previous);
  if (delta == null || Math.abs(delta) < .005) return null;
  return <span className="food-cost-change" data-tone={(delta < 0) === goodWhenLower ? 'positive' : 'negative'}>
    {formatPercent(delta, points)}
  </span>;
}

function ReportEmpty({ searched, noun }: { searched: boolean; noun: string }) {
  return <div className="food-cost-panel food-cost-empty">
    <strong>{searched ? 'Поиск ничего не нашёл' : noun}</strong>
    {searched && <p>Измените поисковый запрос.</p>}
  </div>;
}

export function FoodCostPositions({ report, rows, search, canApply, draft, onPlan, onOpen }: {
  report: FoodCostReport; rows: FoodCostPosition[]; search: boolean; canApply: boolean; draft: Record<string, number>;
  onPlan: (row: FoodCostPosition, price: number) => void; onOpen: (row: FoodCostPosition) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const metricsByCategory = new Map<string, FoodCostPosition['current'][]>();
  for (const row of report.positions) {
    const category = metricsByCategory.get(row.categoryId) ?? [];
    category.push(row.current);
    metricsByCategory.set(row.categoryId, category);
  }
  const groups = new Map<string, { name: string; positions: FoodCostPosition[] }>();
  for (const row of rows) {
    const group = groups.get(row.categoryId) ?? { name: row.category, positions: [] };
    group.positions.push(row);
    groups.set(row.categoryId, group);
  }
  if (!rows.length) return <ReportEmpty searched={search} noun="За выбранный период нет продаж по позициям" />;
  return <div className="space-y-2">
    {[...groups].map(([id, group], index) => {
      const { margin, foodCostPercent } = aggregateFoodCostMetrics(metricsByCategory.get(id) ?? []);
      return <details className="food-cost-panel food-cost-group" key={id} open={index === 0}>
        <summary>
          <strong>{group.name || 'Без категории'}</strong>
          <span>{group.positions.length} поз.</span>
          <span className="ml-auto">Фудкост <strong>{formatFoodCost(foodCostPercent)}</strong></span>
          <span>Маржа <strong>{financeMoney(margin)}</strong></span>
        </summary>
        <div className="food-cost-table-scroll food-cost-position-table" role="region" tabIndex={0} aria-label={group.name || 'Без категории'}>
          <table className="food-cost-table">
            <thead><tr>{['Позиция', 'Себестоимость ед.', 'Фудкост', 'Продано', 'Маржа', 'Цена меню']
              .map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
            <tbody>
              {group.positions.map((row) => <Fragment key={row.id}>
                <tr>
                  <th scope="row"><button type="button" className="food-cost-expand"
                    aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                    <span aria-hidden="true">{expanded === row.id ? '▾' : '▸'}</span> {row.name}
                  </button></th>
                  <td>{financeMoney(unitCost(row))} {compare(unitCost(row), row.previous.cost == null || row.previous.quantity <= 0
                    ? null : row.previous.cost / row.previous.quantity, true)}</td>
                  <td>{formatFoodCost(row.current.foodCostPercent)} {compare(row.current.foodCostPercent, row.previous.foodCostPercent, true, true)}</td>
                  <td>{sold(row)} {compare(row.current.quantity, row.previous.quantity, false)}</td>
                  <td>{financeMoney(row.current.margin)} {compare(row.current.margin, row.previous.margin, false)}</td>
                  <td>{financeMoney(row.price)}{row.price != null && priceCaption(row)}</td>
                </tr>
                {expanded === row.id && <tr className="food-cost-detail-row"><td colSpan={6}>
                  <PositionDetails key={row.id + ':' + (draft[row.id] ?? row.price)} report={report} row={row}
                    canApply={canApply} price={draft[row.id] ?? row.price} onPlan={onPlan} onOpen={onOpen} />
                </td></tr>}
              </Fragment>)}
            </tbody>
          </table>
        </div>
        <ul className="food-cost-position-cards">
          {group.positions.map((row) => <li key={row.id}>
            <button type="button" className="food-cost-expand font-semibold" aria-expanded={expanded === row.id}
              onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
              <span aria-hidden="true">{expanded === row.id ? '▾' : '▸'}</span> {row.name}
            </button>
            <dl className="food-cost-project-metrics">
              <Projection label="Себестоимость ед." value={financeMoney(unitCost(row))} />
              <Projection label="Фудкост" value={formatFoodCost(row.current.foodCostPercent)} />
              <Projection label="Продано" value={sold(row)} />
              <Projection label="Маржа" value={financeMoney(row.current.margin)} />
            </dl>
            {expanded === row.id && <PositionDetails key={row.id + ':' + (draft[row.id] ?? row.price)} report={report} row={row}
              canApply={canApply} price={draft[row.id] ?? row.price} onPlan={onPlan} onOpen={onOpen} />}
          </li>)}
        </ul>
      </details>;
    })}
  </div>;
}

function PositionDetails({ report, row, price, canApply, onPlan, onOpen }: {
  report: FoodCostReport; row: FoodCostPosition; price: number | null; canApply: boolean;
  onPlan: (position: FoodCostPosition, price: number) => void; onOpen: (position: FoodCostPosition) => void;
}) {
  const [input, setInput] = useState(price == null ? '' : String(price));
  const newPrice = parseMoney(input);
  const validPrice = newPrice != null && newPrice >= 0 && newPrice <= MAX_MENU_PRICE;
  const projected = validPrice && row.price !== newPrice ? projectFoodCostPrice(report, row.id, newPrice) : null;
  const category = projected ? aggregateFoodCostMetrics(report.positions.filter((position) => position.categoryId === row.categoryId)
    .map((position) => position.current)) : null;
  const canModel = row.active && row.price != null && row.current.quantity > 0;
  const caption = priceCaption(row);
  const actualPrice = row.current.quantity > 0 ? row.current.revenue / row.current.quantity : null;
  const previousActualPrice = row.previous.quantity > 0 ? row.previous.revenue / row.previous.quantity : null;
  return <div className="food-cost-position-details">
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4>Вклад ингредиентов в себестоимость единицы</h4>
        {row.dishId && <button type="button" className="text-sm text-primary hover:underline" onClick={() => onOpen(row)}>Открыть позицию</button>}
      </div>
      {row.ingredients.length ? <div className="overflow-x-auto">
        <table className="food-cost-table food-cost-components">
          <thead><tr>{['Ингредиент', 'Пред. период', 'Текущий период', 'Изменение']
            .map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
          <tbody>{row.ingredients.map((item) => {
            const previous = item.previousUnitCost ?? (row.previous.quantity > 0 && item.previousCost != null ? item.previousCost / row.previous.quantity : null);
            const current = item.currentUnitCost ?? (row.current.quantity > 0 && item.currentCost != null ? item.currentCost / row.current.quantity : null);
            return <tr key={item.id}>
              <th scope="row">{item.name}</th><td>{financeMoney(previous)}</td><td>{financeMoney(current)}</td>
              <td>{compare(current, previous, true) ?? '—'}</td>
            </tr>;
          })}</tbody>
        </table>
      </div> : <p className="text-sm text-text-muted">По этой позиции нет складского расхода, привязанного к продажам периода.</p>}
    </section>
    <section className="food-cost-model">
      <h4>Моделирование цены</h4>
      {canModel ? <>
        <div className="food-cost-model-inputs">
          <div><span className="text-text-muted">Цена меню</span><strong>{financeMoney(row.price)}{caption}</strong></div>
          <label><span className="text-text-muted">Новая цена{caption}</span>
            <input className="input" inputMode="decimal" value={input} aria-label={`Новая цена — ${row.name}`}
              onChange={(event) => setInput(event.target.value)} />
          </label>
        </div>
        {actualPrice != null && <p className="mb-2 text-xs text-text-muted">
          Средняя цена продажи после скидок {financeMoney(actualPrice)}{caption}
          {previousActualPrice != null && ` · ранее ${financeMoney(previousActualPrice)}`}
        </p>}
        {projected ? <>
          <dl className="food-cost-project-metrics">
            <Projection label="Фудкост позиции" before={formatFoodCost(row.current.foodCostPercent)}
              value={formatFoodCost(projected.position.foodCostPercent)} />
            <Projection label="Изменение маржи за 30 дней" value={financeMoney(projected.position.monthlyMarginChange)} />
            <Projection label="Фудкост категории" before={formatFoodCost(category?.foodCostPercent ?? null)}
              value={formatFoodCost(projected.category.foodCostPercent)} />
            <Projection label="Фудкост заведения" before={formatFoodCost(report.current.totals.foodCostPercent)}
              value={formatFoodCost(projected.business.foodCostPercent)} />
          </dl>
          <p className="text-xs text-text-muted">Сценарий использует объём продаж, себестоимость и долю скидок за выбранный период. Изменение маржи показано за 30 дней.</p>
          {canApply && newPrice != null && row.price !== newPrice && <button type="button" className="btn-primary btn-md mt-3"
            disabled={price === newPrice} onClick={() => onPlan(row, newPrice)}>{price === newPrice ? 'В плане цен' : 'Запланировать изменение'}</button>}
        </> : <p className="text-sm text-text-muted">{!validPrice
          ? 'Укажите цену от 0 с с точностью до двух знаков.' : 'Введите другую цену, чтобы увидеть её влияние на фудкост.'}</p>}
      </> : <p className="text-sm text-text-muted">Моделирование доступно для действующей позиции с продажами за период.</p>}
    </section>
  </div>;
}

function Projection({ label, value, before }: { label: string; value: string; before?: string }) {
  return <div><dt>{label}</dt><dd>{before && before !== value && <span className="font-normal text-text-muted">{before} → </span>}{value}</dd></div>;
}

export function FoodCostIngredients({ rows, search }: { rows: FoodCostIngredient[]; search: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!rows.length) return <ReportEmpty searched={search} noun="За выбранный период нет данных о закупках и расходе ингредиентов" />;
  return <div className="food-cost-panel food-cost-table-scroll" role="region" tabIndex={0} aria-label="Динамика цен ингредиентов">
    <table className="food-cost-table">
      <thead><tr>{['Ингредиент', 'Расход в продажах', 'Сумма расхода', 'Цена пред. периода', 'Цена текущего периода', 'Изменение цены']
        .map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
      <tbody>{rows.map((item) => <Fragment key={item.id}>
        <tr>
          <th scope="row">{item.prices.length > 0 ? <button type="button" className="food-cost-expand" aria-expanded={expanded === item.id}
            onClick={() => setExpanded(expanded === item.id ? null : item.id)}>{expanded === item.id ? '▾' : '▸'} {item.name}</button> : item.name}</th>
          <td>{decimal.format(item.current.quantity)} {normalizeUnitLabel(item.unit)} {compare(item.current.quantity, item.previous.quantity, false)}</td>
          <td>{financeMoney(item.current.cost)} {compare(item.current.cost, item.previous.cost, true)}</td>
          <td>{financeMoney(item.previous.purchasePrice)}</td>
          <td>{financeMoney(item.current.purchasePrice)}{item.current.purchasePrice != null && ` / ${normalizeUnitLabel(item.unit)}`}</td>
          <td>{compare(item.current.purchasePrice, item.previous.purchasePrice, true) ?? '—'}</td>
        </tr>
        {expanded === item.id && <tr className="food-cost-detail-row"><td colSpan={6}>
          <div className="food-cost-price-history">
            <strong>Закупочные цены по дням за оба периода</strong>
            <ol>{item.prices.map(({ date, price }) => <li key={date}>
              <time dateTime={date}>{compactDate.format(new Date(date + 'T00:00:00Z'))}</time>
              <span>{financeMoney(price)} / {normalizeUnitLabel(item.unit)}</span>
            </li>)}</ol>
          </div>
        </td></tr>}
      </Fragment>)}</tbody>
    </table>
  </div>;
}

export function foodCostExportRows(tab: FoodCostTab, positions: FoodCostPosition[], ingredients: FoodCostIngredient[]) {
  return tab === 'positions' ? {
    title: 'Фудкост — позиции',
    headings: ['Позиция', 'Категория', 'Ед. цены', 'Цена меню', 'Продано, ед. цены', 'Выручка', 'Себестоимость',
      'Себестоимость ед.', 'Маржа', 'Фудкост', 'Фудкост прошл. периода'],
    rows: positions.map((row) => [row.name, row.category, row.priceBasis + ' ' + unitLabel(row.priceUnit), financeMoney(row.price),
      decimal.format(row.current.quantity), financeMoney(row.current.revenue), financeMoney(row.current.cost),
      financeMoney(unitCost(row)), financeMoney(row.current.margin), formatFoodCost(row.current.foodCostPercent), formatFoodCost(row.previous.foodCostPercent)]),
  } : {
    title: 'Фудкост — ингредиенты',
    headings: ['Ингредиент', 'Ед. изм.', 'Израсходовано в продажах', 'Стоимость расхода', 'Динамика стоимости расхода',
      'Закупочная цена прошл. периода', 'Закупочная цена тек. периода', 'Изменение закупочной цены'],
    rows: ingredients.map((item) => {
      const change = percentChange(item.current.purchasePrice, item.previous.purchasePrice);
      const costChange = percentChange(item.current.cost, item.previous.cost);
      return [item.name, normalizeUnitLabel(item.unit), decimal.format(item.current.quantity), financeMoney(item.current.cost),
        costChange == null ? '—' : formatPercent(costChange), financeMoney(item.previous.purchasePrice),
        financeMoney(item.current.purchasePrice), change == null ? '—' : formatPercent(change)];
    }),
  };
}
