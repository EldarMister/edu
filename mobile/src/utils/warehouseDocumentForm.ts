export interface DocumentQuantityRow { ingredientId: string; value: string }

/** Empty is an uncounted selected position; zero is a real count. */
export function documentQuantity(value: string): number | null {
  return value.trim() === '' ? null : Number(value.trim().replace(',', '.'));
}

export function documentQuantities(rows: DocumentQuantityRow[], inventory: boolean) {
  const items = rows.map(({ ingredientId, value }) => ({ ingredientId, quantity: documentQuantity(value) }));
  const counted = items.filter((item) => item.quantity !== null).length;
  const valid = rows.every((row) => row.value.trim() === '' || (
    /^\d+(?:[.,]\d+)?$/.test(row.value.trim()) && Number.isFinite(documentQuantity(row.value)) &&
    (inventory ? documentQuantity(row.value)! >= 0 : documentQuantity(row.value)! > 0)
  ));
  return { items, counted, valid, canSubmit: valid && counted > 0 && counted === rows.length };
}

export function documentOperationDate(document: { countedAt?: string | null; effectiveAt?: string | null; postedAt?: string | null; createdAt: string }) {
  return document.countedAt ?? document.effectiveAt ?? document.postedAt ?? document.createdAt;
}
