import { useEffect, useRef, useState } from 'react';
import { api, apiError } from '@/lib/api';
import type { InvoicePreview } from './invoice-import-values';

export function PurchaseInvoiceImport({ initialOpen, disabled, onBusy, onRead }: {
  initialOpen: boolean;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onRead: (preview: InvoicePreview, filename: string) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController>();
  useEffect(() => () => request.current?.abort(), []);

  async function read(files: File[]) {
    if (!files.length || request.current || disabled) return;
    setError('');
    if (files.length > 2 || (files.length > 1 && files.some(file => !/\.(jpe?g|png)$/i.test(file.name)))) {
      setError('Выберите одну таблицу, один PDF или до двух фотографий одной накладной.');
      return;
    }
    if (files.some(file => file.size > 12 * 1024 * 1024)) {
      setError('Размер каждого файла должен быть до 12 МБ.');
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setReading(true);
    onBusy(true);
    try {
      const body = new FormData();
      files.forEach(file => body.append('files', file));
      const result = await api.post<InvoicePreview>('/admin/warehouse/purchases/import/preview', body, { signal: controller.signal });
      if (!controller.signal.aborted) {
        onRead(result.data, files.map(file => file.name).join(', '));
        setOpen(false);
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(apiError(err));
    } finally {
      request.current = undefined;
      setReading(false);
      onBusy(false);
    }
  }
  return <section aria-label="Импорт накладной">
    <button type="button" className="text-sm font-medium text-primary" aria-expanded={open} disabled={reading}
      onClick={() => setOpen(!open)}>{initialOpen ? 'Распознать накладную' : 'Импорт поставки'} {open ? '▴' : '▾'}</button>
    {open && <div className="mt-2 rounded-lg border border-dashed border-border p-4"
      onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void read(Array.from(event.dataTransfer.files)); }}>
      <p className="text-sm">Перетащите фото, PDF или таблицу накладной. Распознанные позиции появятся в поставке для проверки.</p>
      <p className="mb-3 mt-1 text-xs text-text-muted">До двух фото JPEG или PNG, либо один PDF, CSV, XLS или XLSX. До 12 МБ на файл.</p>
      <input ref={input} type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.xls,.xlsx,.csv" aria-label="Файл накладной" className="sr-only" tabIndex={-1}
        onChange={e => { const files = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ''; void read(files); }} />
      <button type="button" disabled={disabled || reading} className="btn-secondary btn-sm" onClick={() => input.current?.click()}>
        {reading ? 'Распознаём накладную…' : 'Выбрать файл'}</button>
      {reading && <button type="button" className="ml-3 text-sm text-primary" onClick={() => request.current?.abort()}>Отменить распознавание</button>}
      {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
    </div>}
  </section>;
}
