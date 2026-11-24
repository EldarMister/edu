import { Fragment, useEffect, useId, useState } from 'react';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { Select } from '@/components/Select';
import { DocumentProductPicker } from './DocumentProductPicker';
import { focusDocumentInput } from './document-focus';
import './document-workspace.css';
import { balanceMoney } from './balance-format';
import { documentQuantityError } from './stock-document-form';
import type { StockDocumentDetails } from './stock-documents-api';
import { unitLabel, unitTypeOf, unitsForType, type UnitCode } from './units';
import { useWriteoffOptions, useWriteoffPackages, useWriteoffPreview, type WriteoffSourceInput, type WriteoffSourceLine } from './writeoff-api';
import { changeWriteoffPackage, changeWriteoffUnit, emptyWriteoffLine, sameWriteoffSource, writeoffDraftLines, writeoffFormKey, writeoffLineInput, writeoffPreviewPlan, type DraftWriteoffLine } from './writeoff-form-values';

type Choice = { id: string; name: string; group: string; detail?: string; unit: string; unitCode: UnitCode; kind: 'ingredient' | 'dish'; sourceId: string; variantId?: string };
const choiceId = (row: Pick<DraftWriteoffLine, 'kind' | 'sourceId' | 'variantId'>) => `${row.kind}:${row.sourceId}:${row.variantId ?? ''}`;

export function useWriteoffLines(enabled: boolean, warehouseId: string, document?: StockDocumentDetails, effectiveAt?: string | null) {
  const options = useWriteoffOptions(enabled, effectiveAt);
  const packages = useWriteoffPackages(enabled);
  const [rows, setRows] = useState(() => writeoffDraftLines(enabled ? document?.sourceLines : undefined, enabled ? document?.items : undefined));
  const [snapshots, setSnapshots] = useState(enabled ? document?.sourceLines ?? [] : []);
  const [savedKey, setSavedKey] = useState(() => writeoffFormKey(rows));
  const [refreshVersion, setRefreshVersion] = useState(0);
  const snapshotById = new Map(snapshots.map((line) => [line.sourceLineId, line]));
  const entered = rows.filter((row) => row.sourceId || row.quantity);
  const issues = new Map(rows.map((row) => [row.sourceLineId, {
    product: !row.sourceId && !!row.quantity ? 'Выберите продукт.' : undefined,
    quantity: row.sourceId || row.quantity ? documentQuantityError(row.quantity, false) || (Number(row.quantity) < 0.000001 ? 'Минимальное количество — 0,000001.' : undefined) : undefined,
  }]));
  const firstError = [...issues.values()].flatMap((issue) => [issue.product, issue.quantity]).find(Boolean);
  const forcePreview = refreshVersion > 0 || (effectiveAt ?? null) !== (document?.effectiveAt ?? null);
  const plan = writeoffPreviewPlan(rows, snapshots, forcePreview);
  const needsPreview = plan.needed;
  const serialized = JSON.stringify(plan.inputs);
  const [settled, setSettled] = useState(serialized);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(serialized), 250);
    return () => window.clearTimeout(timer);
  }, [serialized]);
  const previewInputs: WriteoffSourceInput[] = JSON.parse(settled);
  const preview = useWriteoffPreview(warehouseId, previewInputs, enabled && !!warehouseId && !firstError && needsPreview && settled === serialized, refreshVersion, document?.id, effectiveAt);
  const previewById = new Map((settled === serialized && !preview.isError ? preview.data?.sourceLines ?? [] : []).map((line) => [line.sourceLineId, line]));
  const lines = entered.flatMap((row) => {
    const snapshot = snapshotById.get(row.sourceLineId);
    const latest = document?.sourceLines?.find((line) => line.sourceLineId === row.sourceLineId && line.recipeSignature === snapshot?.recipeSignature && sameWriteoffSource(row, line));
    const line = needsPreview && previewById.has(row.sourceLineId) ? previewById.get(row.sourceLineId)
      : !forcePreview && snapshot?.recipeSignature && sameWriteoffSource(row, snapshot) ? latest ?? snapshot : undefined;
    return line ? [line] : [];
  });
  const calculating = enabled && !firstError && needsPreview && (settled !== serialized || preview.isFetching || preview.isPending);
  const ready = !firstError && options.isSuccess && !calculating && (!needsPreview || preview.isSuccess) && lines.length === entered.length;
  const total = !entered.length ? 0 : needsPreview
    ? settled === serialized && preview.isSuccess && !preview.isFetching ? preview.data.total : null
    : document?.sourceTotal ?? (lines.some((line) => line.total == null) ? null : lines.reduce((sum, line) => sum + (line.total ?? 0), 0));
  const choices: Choice[] = [
    ...(options.data?.ingredients ?? []).map((item): Choice => ({ id: choiceId({ kind: 'ingredient', sourceId: item.id }), kind: 'ingredient', sourceId: item.id,
      name: item.name, detail: item.category ?? undefined, unit: item.unit, unitCode: item.unitCode,
      group: item.kind === 'goods' || item.kind === 'beverage' ? 'Товары' : item.kind === 'preparation' || item.kind === 'prepared_dish' ? 'Полуфабрикаты' : 'Ингредиенты' })),
    ...(options.data?.dishes ?? []).flatMap((dish): Choice[] => (dish.variants.length ? dish.variants : [undefined]).map((variant) => ({
      id: choiceId({ kind: 'dish', sourceId: dish.id, variantId: variant?.id }), kind: 'dish', sourceId: dish.id, variantId: variant?.id,
      name: variant ? `${dish.name} · ${variant.name}` : dish.name, detail: dish.category ?? undefined, unit: dish.unitCode === 'pcs' ? 'порц.' : unitLabel(dish.unitCode), unitCode: dish.unitCode, group: 'Блюда',
    }))),
  ].sort((a, b) => ['Товары', 'Блюда', 'Полуфабрикаты', 'Ингредиенты'].indexOf(a.group) - ['Товары', 'Блюда', 'Полуфабрикаты', 'Ингредиенты'].indexOf(b.group) || (a.detail ?? '').localeCompare(b.detail ?? '', 'ru') || a.name.localeCompare(b.name, 'ru'));
  function adopt(saved?: StockDocumentDetails) {
    const next = writeoffDraftLines(saved?.sourceLines, saved?.items);
    setRows(next);
    setSnapshots(saved?.sourceLines ?? []);
    setSavedKey(writeoffFormKey(next));
    setRefreshVersion(0);
  }
  function choose(sourceLineId: string, id: string) {
    const option = choices.find((choice) => choice.id === id);
    if (!option) return;
    setRows((current) => current.map((row) => row.sourceLineId === sourceLineId && choiceId(row) !== id
      ? { sourceLineId, kind: option.kind, sourceId: option.sourceId, variantId: option.variantId, quantity: '1', unit: option.unitCode, name: option.name } : row));
  }
  return { rows, setRows, options, packages, choices, issues, firstError, enteredCount: entered.length, ready, calculating, total, lines, preview, snapshots, choose, adopt,
    dirty: writeoffFormKey(rows) !== savedKey || lines.some((line) => snapshotById.has(line.sourceLineId) && snapshotById.get(line.sourceLineId)?.recipeSignature !== line.recipeSignature),
    refresh: () => setRefreshVersion((value) => value + 1),
    input: () => entered.map((row) => ({ ...writeoffLineInput(row), recipeSignature: lines.find((line) => line.sourceLineId === row.sourceLineId)?.recipeSignature })),
  };
}

type WriteoffEditor = ReturnType<typeof useWriteoffLines>;

export function WriteoffLines({ editor, sourceLines = [], total, disabled = false, showErrors = false, requireRows = false, showCost = true }: {
  editor?: WriteoffEditor;
  sourceLines?: WriteoffSourceLine[];
  total?: number | null;
  disabled?: boolean;
  showErrors?: boolean;
  showCost?: boolean;
  requireRows?: boolean;
}) {
  const { can } = usePermissions();
  const costs = showCost && can('actions.warehouseCosts');
  const id = useId();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const readonlyPackages = useWriteoffPackages(!editor);
  const rows = editor?.rows ?? writeoffDraftLines(sourceLines);
  const showPackages = rows.some((row) => row.packageId) || !!(editor?.packages.data ?? readonlyPackages.data)?.some((pack) => pack.isActive);
  const lines = new Map((editor?.lines ?? sourceLines).map((line) => [line.sourceLineId, line]));
  const oldLines = new Map(editor?.snapshots.map((line) => [line.sourceLineId, line]));
  const updatedRecipe = editor?.lines.some((line) => (line.kind === 'dish' || line.parts.some((part) => part.ingredientId !== line.sourceId)) && oldLines.has(line.sourceLineId) && oldLines.get(line.sourceLineId)?.recipeSignature !== line.recipeSignature);
  const savedTotal = total === undefined ? sourceLines.some((line) => line.total == null) ? null : sourceLines.reduce((sum, line) => sum + (line.total ?? 0), 0) : total;
  return <section className="poster-document-panel poster-document-products poster-writeoff-lines">
    {editor?.options.isPending && <p role="status" className="mb-3 px-4 text-sm text-text-muted">Загрузка продуктов и блюд…</p>}
    {editor?.options.isError && <p role="alert" className="mb-3 px-4 text-sm text-danger">Не удалось загрузить продукты и блюда. <button type="button" className="text-primary" onClick={() => void editor.options.refetch()}>Повторить загрузку</button></p>}
    {editor?.packages.isPending && !editor.options.isPending && <p role="status" className="mb-3 px-4 text-sm text-text-muted">Загрузка фасовок…</p>}
    {editor?.packages.isError && <p role="alert" className="mb-3 px-4 text-sm text-danger">Не удалось загрузить фасовки. <button type="button" className="text-primary" onClick={() => void editor.packages.refetch()}>Повторить загрузку</button></p>}
    {editor?.calculating && <p role="status" className="mb-3 px-4 text-sm text-text-muted">Расчёт состава…</p>}
    {editor?.preview.isError && <p role="alert" className="mb-3 px-4 text-sm text-danger">{apiError(editor.preview.error)} <button type="button" className="text-primary" onClick={editor.refresh}>Обновить расчёт</button></p>}
    {updatedRecipe && <p role="status" className="mb-3 px-4 text-sm text-text-secondary">Состав пересчитан по текущему рецепту. Проверьте продукты ниже перед сохранением.</p>}
    <div className="overflow-x-auto"><table className={`poster-table poster-document-table poster-document-table--compact poster-writeoff-table w-full table-fixed text-sm ${showPackages ? 'min-w-[840px]' : 'min-w-[720px]'}`}>
      <colgroup><col /><col style={{ width: showPackages ? 130 : 210 }} />{showPackages && <col style={{ width: 200 }} />}<col style={{ width: 130 }} /><col style={{ width: 155 }} /><col style={{ width: 40 }} /></colgroup>
      <thead><tr><th className="text-left">Наименование</th><th className="text-right">Количество</th>{showPackages && <th className="text-left">Фасовки</th>}<th className="text-right">{costs ? 'Сумма' : ''}</th><th className="text-left">Детали</th><th /></tr></thead>
      <tbody>{rows.map((row, index) => {
        const line = lines.get(row.sourceLineId);
        const oldLine = oldLines.get(row.sourceLineId);
        const unit = row.kind === 'dish' && row.unit === 'pcs' ? 'порц.' : unitLabel(row.unit);
        const issue = showErrors ? editor?.issues.get(row.sourceLineId) : undefined;
        const productError = issue?.product ?? (showErrors && requireRows && !editor?.enteredCount && index === 0 ? 'Добавьте хотя бы один продукт.' : undefined);
        const quantityErrorId = `${id}-${row.sourceLineId}-quantity`;
        const hasRecipe = !!line && (line.kind === 'dish' || line.parts.some((part) => part.ingredientId !== line.sourceId));
        const expanded = !collapsed.has(row.sourceLineId);
        const selectedId = choiceId(row);
        const packageValue = row.packageId ? `${row.packageSnapshotLineId ? 'saved-package' : 'package'}:${row.packageId}` : row.unit;
        const displayPackage = line && line.packageId === row.packageId && row.packageId ? line : row;
        const packageLabel = (pack: { packageName?: string; packageQuantity?: number; packageUnit?: UnitCode }) => `${pack.packageName ?? 'Фасовка'} (${pack.packageQuantity?.toLocaleString('ru-RU', { maximumFractionDigits: 6 }) ?? '—'} ${pack.packageUnit === 'pcs' && row.kind === 'dish' ? 'порц.' : unitLabel(pack.packageUnit ?? row.unit)})`;
        const packageOptions = unitsForType(unitTypeOf(row.unit)).map((entry) => ({ value: entry.value as string, label: entry.value === 'pcs' && row.kind === 'dish' ? 'порц.' : entry.label }));
        for (const pack of editor?.packages.data ?? []) {
          if (!pack.isActive || unitTypeOf(pack.unit) !== unitTypeOf(row.unit)) continue;
          const sameSaved = row.packageSnapshotLineId && row.packageId === pack.id && row.packageName === pack.name && row.packageUnit === pack.unit && row.packageQuantity === pack.quantity;
          if (sameSaved) continue;
          const label = pack.id === row.packageId && !row.packageSnapshotLineId ? packageLabel(displayPackage)
            : packageLabel({ packageName: pack.name, packageQuantity: pack.quantity, packageUnit: pack.unit });
          packageOptions.push({ value: `package:${pack.id}`, label: `${label}${row.packageSnapshotLineId && row.packageId === pack.id ? ' · текущая' : ''}` });
        }
        if (row.packageId && !packageOptions.some((option) => option.value === packageValue)) packageOptions.push({ value: packageValue, label: packageLabel(displayPackage) });
        const unitControl = editor && row.sourceId ? <Select ariaLabel={`${showPackages ? 'Фасовка' : 'Единица'} ${line?.name ?? row.name ?? 'продукта'}`}
          className={`poster-inline-select h-9 ${showPackages ? 'w-full' : 'w-20 shrink-0'}`} value={packageValue} options={packageOptions}
          disabled={disabled || (showPackages && editor.packages.isPending)}
          onChange={(value) => editor.setRows((current) => current.map((entry) => {
            if (entry.sourceLineId !== row.sourceLineId || value === packageValue) return entry;
            if (value.startsWith('package:')) {
              const pack = editor.packages.data?.find((option) => option.id === value.slice(8));
              return pack ? changeWriteoffPackage(entry, pack) : entry;
            }
            return changeWriteoffUnit({ ...entry, packageFactor: displayPackage.packageFactor ?? entry.packageFactor }, value as UnitCode);
          }))} /> : <span className="text-text-muted">{row.packageId ? packageLabel(displayPackage) : row.sourceId ? unit : '—'}</span>;
        const choices = editor?.choices.map((choice) => choice.id === selectedId && oldLine && sameWriteoffSource(row, oldLine) ? { ...choice, name: oldLine.name } : choice) ?? [];
        if (editor && row.sourceId && !choices.some((choice) => choice.id === selectedId) && (oldLine || row.name)) choices.push({ id: selectedId, name: oldLine?.name ?? row.name!, group: row.kind === 'dish' ? 'Блюда' : 'Ингредиенты', unit, unitCode: row.unit, kind: row.kind, sourceId: row.sourceId, variantId: row.variantId });
        return <Fragment key={row.sourceLineId}>
          <tr className="border-b border-border">
            <td className="poster-product-cell py-2">
              {editor ? <div className="poster-inline-product"><DocumentProductPicker id={`${quantityErrorId}-product-input`} value={row.sourceId ? selectedId : ''} options={choices} label={`Продукт или блюдо · строка ${index + 1}`}
                disabled={disabled} loading={editor.options.isPending} loadError={editor.options.isError ? 'Не удалось загрузить продукты.' : undefined} onRetry={() => void editor.options.refetch()}
                fallbackName={oldLine?.name ?? row.name} error={productError} onSelected={() => focusDocumentInput(`${quantityErrorId}-input`)} onChange={(value) => { editor.choose(row.sourceLineId, value); setCollapsed((current) => { const next = new Set(current); next.delete(row.sourceLineId); return next; }); }} /></div>
                : <span className="block">{line?.name ?? oldLine?.name ?? row.name ?? 'Продукт'}</span>}
            </td>
            <td className="py-2 text-right">{editor ? <>
              <div className="flex items-center gap-2"><label className="poster-number-unit poster-inline-number flex min-w-0 flex-1 items-center gap-2"><input id={`${quantityErrorId}-input`} className="input poster-document-number h-9 min-w-0 w-full text-right" type="number" min="0.000001" step="any" inputMode="decimal"
                aria-label={`${row.packageId ? 'Количество фасовок' : 'Количество'} ${line?.name ?? oldLine?.name ?? row.name ?? 'продукта'}`} aria-invalid={!!issue?.quantity || undefined} aria-describedby={issue?.quantity ? quantityErrorId : undefined}
                disabled={disabled || !row.sourceId} value={row.quantity} onChange={(event) => editor.setRows((current) => current.map((entry) => entry.sourceLineId === row.sourceLineId ? { ...entry, quantity: event.target.value } : entry))} /></label>{!showPackages && unitControl}</div>
              {issue?.quantity && <p id={quantityErrorId} className="mt-1 text-left text-xs text-danger">{issue.quantity}</p>}
            </> : <span>{Number(row.quantity).toLocaleString('ru-RU', { maximumFractionDigits: 6 })}{!showPackages && <> {unitControl}</>}</span>}</td>
            {showPackages && <td>{unitControl}
              {row.packageId && line?.physicalQuantity != null && <span className="mt-1 block text-xs text-text-muted">= {line.physicalQuantity.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} {unit}</span>}
            </td>}
            <td className="whitespace-nowrap text-right tabular-nums">{costs ? line?.total == null ? '—' : balanceMoney(line.total) : ''}</td>
            <td>{hasRecipe && <button type="button" className="poster-recipe-toggle text-sm text-primary" aria-expanded={expanded} aria-controls={`${quantityErrorId}-composition`} onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(row.sourceLineId)) next.delete(row.sourceLineId); else next.add(row.sourceLineId); return next; })}>{expanded ? 'Скрыть состав' : 'Состав'} <span className="text-text-muted">· {line.parts.length}</span></button>}</td>
            <td>{editor && <button type="button" className="poster-remove" disabled={disabled} aria-label={`Убрать ${line?.name ?? oldLine?.name ?? row.name ?? 'строку'}`} onClick={() => editor.setRows((current) => current.length > 1 ? current.filter((entry) => entry.sourceLineId !== row.sourceLineId) : [emptyWriteoffLine()])}>×</button>}</td>
          </tr>
          {hasRecipe && expanded && <tr id={`${quantityErrorId}-composition`} className="poster-recipe-row"><td colSpan={showPackages ? 6 : 5} className="!bg-background !p-4">
            <p className="mb-2 text-xs text-text-secondary">{editor ? 'Будет списано со склада' : 'Состав списания'}</p>
            <table className="w-full bg-white text-sm"><thead><tr><th className="text-left">Ингредиент</th><th className="text-right">Количество</th>{costs && <th className="text-right">Сумма</th>}</tr></thead><tbody>{line.parts.map((part, partIndex) => <tr key={`${part.ingredientId}:${partIndex}`}><td>{part.name}</td><td className="text-right">{part.quantity.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} {part.unit}</td>{costs && <td className="text-right">{part.total == null ? '—' : balanceMoney(part.total)}</td>}</tr>)}</tbody></table>
          </td></tr>}
        </Fragment>;
      })}</tbody>
      {!editor && costs && <tfoot><tr className="border-t border-border"><td colSpan={showPackages ? 3 : 2}>Итого</td><td className="text-right tabular-nums">{savedTotal == null ? '—' : balanceMoney(savedTotal)}</td><td colSpan={2} /></tr></tfoot>}
    </table></div>
    {editor && <div className="poster-document-add flex flex-wrap items-center gap-4 px-4 pt-3">
      <button type="button" className="text-sm text-primary" disabled={disabled} onClick={() => { const row = emptyWriteoffLine(); editor.setRows((current) => [...current, row]); focusDocumentInput(`${id}-${row.sourceLineId}-quantity-product-input`); }}>+ Добавить</button>
      {editor.enteredCount > 0 && <button type="button" className="text-xs text-text-muted" disabled={disabled || editor.calculating || !!editor.firstError} onClick={editor.refresh}>Обновить расчёт</button>}
    </div>}
  </section>;
}
