import { ALL_UNITS, type UnitCode } from './units';
import type { StockDocumentItem } from './stock-documents-api';
import type { WriteoffSourceInput, WriteoffSourceLine } from './writeoff-api';
import type { PackageUnit } from './extended-api';

export interface DraftWriteoffLine {
  sourceLineId: string;
  kind: 'ingredient' | 'dish';
  sourceId: string;
  variantId?: string;
  packageId?: string;
  packageSnapshotLineId?: string;
  packageName?: string;
  packageQuantity?: number;
  packageUnit?: UnitCode;
  packageFactor?: number;
  quantity: string;
  unit: UnitCode;
  name?: string;
  details?: string;
  imported?: string;
}

export const emptyWriteoffLine = (): DraftWriteoffLine => ({ sourceLineId: crypto.randomUUID(), kind: 'ingredient', sourceId: '', quantity: '', unit: 'pcs' });

export function writeoffLineInput(row: DraftWriteoffLine): WriteoffSourceInput {
  return { sourceLineId: row.sourceLineId, kind: row.kind, sourceId: row.sourceId, variantId: row.variantId || undefined, quantity: Number(row.quantity), unit: row.unit,
    ...(row.details === undefined ? {} : { details: row.details.trim() }),
    ...(row.packageId ? { packageId: row.packageId, ...(row.packageSnapshotLineId ? { packageSnapshotLineId: row.packageSnapshotLineId } : {}) } : {}) };
}

/** Switching the display unit preserves the physical amount; the server recalculates its recipe. */
export function changeWriteoffUnit(row: DraftWriteoffLine, unit: UnitCode): DraftWriteoffLine {
  const from = ALL_UNITS.find((entry) => entry.code === row.unit);
  const to = ALL_UNITS.find((entry) => entry.code === unit);
  if (!from || !to || from.type !== to.type || (row.unit === unit && !row.packageId)) return row;
  const quantity = Number(row.quantity);
  const factor = row.packageId ? row.packageFactor ?? from.factor : from.factor;
  return { ...row, unit, packageId: undefined, packageSnapshotLineId: undefined, packageName: undefined, packageQuantity: undefined, packageUnit: undefined, packageFactor: undefined,
    quantity: row.quantity.trim() && Number.isFinite(quantity) ? String(Number((quantity * factor / to.factor).toPrecision(15))) : row.quantity };
}

export function changeWriteoffPackage(row: DraftWriteoffLine, pack: PackageUnit): DraftWriteoffLine {
  const sourceUnit = ALL_UNITS.find((unit) => unit.code === row.unit);
  const packageUnit = ALL_UNITS.find((unit) => unit.code === pack.unit);
  if (!sourceUnit || !packageUnit || sourceUnit.type !== packageUnit.type || !pack.isActive || !(pack.quantity > 0)) return row;
  return { ...row, unit: pack.unit, packageId: pack.id, packageSnapshotLineId: undefined,
    packageName: pack.name, packageQuantity: pack.quantity, packageUnit: pack.unit, packageFactor: pack.quantity * packageUnit.factor };
}

export function sameWriteoffSource(row: DraftWriteoffLine, snapshot: WriteoffSourceLine): boolean {
  return row.sourceLineId === snapshot.sourceLineId && row.kind === snapshot.kind && row.sourceId === snapshot.sourceId &&
    (row.variantId || '') === (snapshot.variantId || '') && row.quantity.trim() !== '' &&
    Number(row.quantity) === snapshot.quantity && row.unit === snapshot.unitCode && (row.packageId ?? '') === (snapshot.packageId ?? '') &&
    (!row.packageId || row.packageSnapshotLineId === snapshot.sourceLineId);
}

export function writeoffFormKey(rows: DraftWriteoffLine[]): string {
  return JSON.stringify(rows.filter((row) => row.sourceId || row.quantity || row.imported).map((row) => ({
    ...writeoffLineInput(row), imported: row.imported,
    quantity: row.quantity.trim() && Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : row.quantity,
  })));
}

export function writeoffPreviewPlan(rows: DraftWriteoffLine[], snapshots: WriteoffSourceLine[], refreshAll = false) {
  const entered = rows.filter((row) => row.sourceId || row.quantity);
  const saved = new Map(snapshots.map((line) => [line.sourceLineId, line]));
  const inputs = entered.map((row) => {
    const snapshot = saved.get(row.sourceLineId);
    const { details: _details, ...input } = writeoffLineInput(row);
    return { ...input,
      recipeSignature: !refreshAll && snapshot?.recipeSignature && sameWriteoffSource(row, snapshot) ? snapshot.recipeSignature : undefined };
  });
  return { inputs, needed: entered.length > 0 && (refreshAll || entered.length !== snapshots.length || inputs.some((input) => !input.recipeSignature)) };
}

export function writeoffDraftLines(sourceLines: WriteoffSourceLine[] = [], items: StockDocumentItem[] = []): DraftWriteoffLine[] {
  if (sourceLines.length) return sourceLines.map((line) => ({ sourceLineId: line.sourceLineId, kind: line.kind, sourceId: line.sourceId,
    variantId: line.variantId, quantity: String(line.quantity), unit: line.unitCode, name: line.name, details: line.details,
    ...(line.packageId ? { packageId: line.packageId, packageSnapshotLineId: line.sourceLineId, packageName: line.packageName,
      packageQuantity: line.packageQuantity, packageUnit: line.packageUnit, packageFactor: line.packageFactor } : {}) }));
  if (items.length) return items.map((item) => ({ sourceLineId: crypto.randomUUID(), kind: 'ingredient', sourceId: item.ingredientId,
    quantity: item.quantity == null ? '' : String(item.quantity), unit: ALL_UNITS.find((unit) => unit.label === item.unit || unit.code === item.unit)?.code ?? 'pcs', name: item.name }));
  return [emptyWriteoffLine()];
}
