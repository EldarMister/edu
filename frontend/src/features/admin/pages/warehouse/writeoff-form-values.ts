import { ALL_UNITS, type UnitCode } from './units';
import type { StockDocumentItem } from './stock-documents-api';
import type { WriteoffSourceInput, WriteoffSourceLine } from './writeoff-api';

export interface DraftWriteoffLine {
  sourceLineId: string;
  kind: 'ingredient' | 'dish';
  sourceId: string;
  variantId?: string;
  quantity: string;
  unit: UnitCode;
  name?: string;
}

export const emptyWriteoffLine = (): DraftWriteoffLine => ({ sourceLineId: crypto.randomUUID(), kind: 'ingredient', sourceId: '', quantity: '', unit: 'pcs' });

export function writeoffLineInput(row: DraftWriteoffLine): WriteoffSourceInput {
  return { sourceLineId: row.sourceLineId, kind: row.kind, sourceId: row.sourceId, variantId: row.variantId || undefined, quantity: Number(row.quantity), unit: row.unit };
}

export function sameWriteoffSource(row: DraftWriteoffLine, snapshot: WriteoffSourceLine): boolean {
  return row.sourceLineId === snapshot.sourceLineId && row.kind === snapshot.kind && row.sourceId === snapshot.sourceId &&
    (row.variantId || '') === (snapshot.variantId || '') && row.quantity.trim() !== '' &&
    Number(row.quantity) === snapshot.quantity && row.unit === snapshot.unitCode;
}

export function writeoffFormKey(rows: DraftWriteoffLine[]): string {
  return JSON.stringify(rows.filter((row) => row.sourceId || row.quantity).map((row) => ({
    ...writeoffLineInput(row), quantity: row.quantity.trim() && Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : row.quantity,
  })));
}

export function writeoffPreviewPlan(rows: DraftWriteoffLine[], snapshots: WriteoffSourceLine[], refreshAll = false) {
  const entered = rows.filter((row) => row.sourceId || row.quantity);
  const saved = new Map(snapshots.map((line) => [line.sourceLineId, line]));
  const inputs = entered.map((row) => {
    const snapshot = saved.get(row.sourceLineId);
    return { ...writeoffLineInput(row), recipeSignature: !refreshAll && snapshot?.recipeSignature && sameWriteoffSource(row, snapshot) ? snapshot.recipeSignature : undefined };
  });
  return { inputs, needed: entered.length > 0 && (refreshAll || entered.length !== snapshots.length || inputs.some((input) => !input.recipeSignature)) };
}

export function writeoffDraftLines(sourceLines: WriteoffSourceLine[] = [], items: StockDocumentItem[] = []): DraftWriteoffLine[] {
  if (sourceLines.length) return sourceLines.map((line) => ({ sourceLineId: line.sourceLineId, kind: line.kind, sourceId: line.sourceId,
    variantId: line.variantId, quantity: String(line.quantity), unit: line.unitCode, name: line.name }));
  if (items.length) return items.map((item) => ({ sourceLineId: crypto.randomUUID(), kind: 'ingredient', sourceId: item.ingredientId,
    quantity: item.quantity == null ? '' : String(item.quantity), unit: ALL_UNITS.find((unit) => unit.label === item.unit || unit.code === item.unit)?.code ?? 'pcs', name: item.name }));
  return [emptyWriteoffLine()];
}
