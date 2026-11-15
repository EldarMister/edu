import { createPortal } from 'react-dom';
import { inventoryTimeDisplay } from './inventory-time';
import type { StockDocumentDetails } from './stock-documents-api';
import './inventory-workspace.css';

/** Print every selected product, independently of the on-screen search and count filter. */
export function InventoryCountSheet({ document, warehouseName, rows }: {
  document: StockDocumentDetails;
  warehouseName: string;
  rows: { ingredientId: string; name: string; unit: string; quantity: number | null }[];
}) {
  return createPortal(<section className="poster-inventory-print" aria-hidden="true">
    <h1>Инвентаризационный лист</h1>
    <p>{warehouseName} · {document.mode === 'full' ? 'Полная' : 'Частичная'} инвентаризация</p>
    <p>Начало: {inventoryTimeDisplay(document.createdAt)}{document.postedAt ? ` · Проведена: ${inventoryTimeDisplay(document.postedAt)}` : ''} · Бишкек</p>
    <p>Проверка остатков: {document.countedAt ? `${inventoryTimeDisplay(document.countedAt)} · Бишкек` : 'на момент проведения'}</p>
    <table><thead><tr><th>№</th><th>Наименование</th><th>Ед. изм.</th><th>Фактический остаток</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.ingredientId}><td>{index + 1}</td><td>{row.name}</td><td>{row.unit}</td><td>{row.quantity === null ? '' : row.quantity.toLocaleString('ru-RU', { maximumFractionDigits: 6 })}</td></tr>)}</tbody>
    </table>
    <p>Продуктов: {rows.length}. Пустые поля ещё не посчитаны. Для отсутствующего продукта укажите 0.</p>
    <p className="poster-inventory-print-signature">Проверил(а): __________________________ Дата и время подсчёта: __________________________</p>
  </section>, globalThis.document.body);
}
