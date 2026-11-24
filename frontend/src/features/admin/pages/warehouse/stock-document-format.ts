import { money } from '@/lib/format';
import type { StockDocument, StockDocumentStatus, WriteoffReason } from './stock-documents-api';

export const WRITEOFF_REASONS: { value: WriteoffReason; label: string }[] = [
  { value: 'spoilage', label: 'Порча' },
  { value: 'expired', label: 'Просрочка' },
  { value: 'damage', label: 'Брак' },
  { value: 'staff_meal', label: 'Питание персонала' },
  { value: 'tasting', label: 'Дегустация' },
  { value: 'household', label: 'Хозяйственные нужды' },
  { value: 'other', label: 'Другое' },
];

export type StockDocumentDisplayStatus = StockDocumentStatus | 'reopened';

const STATUS_LABEL: Record<StockDocumentDisplayStatus, string> = {
  draft: 'Черновик',
  submitted: 'На утверждении',
  posted: 'Проведён',
  reopened: 'Открыта для редактирования',
  reversed: 'Сторнирован',
};

const DOCUMENT_DATE = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bishkek' });

export function documentDisplayStatus(document: StockDocument): StockDocumentDisplayStatus {
  return document.status === 'draft' && document.reopenedAt ? 'reopened' : document.status;
}

export function documentStatus(status: StockDocumentDisplayStatus) {
  return STATUS_LABEL[status];
}

export function documentLabel(document: StockDocument) {
  if (document.kind === 'transfer') return 'Перемещение';
  if (document.kind === 'supplier_return') return 'Возврат поставщику';
  if (document.kind === 'inventory')
    return document.mode === 'full' ? 'Полная инвентаризация' : 'Частичная инвентаризация';
  return 'Списание';
}

export function formatDocumentDate(value: string) {
  return DOCUMENT_DATE.format(new Date(value));
}

export function formatVariance(value: number | null) {
  if (value === null) return '—';
  const rounded = Math.round(Math.abs(value) * 100) / 100;
  const sign = rounded === 0 ? '' : value < 0 ? '−' : '+';
  return `${sign}${money(rounded)}`;
}
