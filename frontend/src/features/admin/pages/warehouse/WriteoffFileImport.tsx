import { useEffect, useRef, useState } from 'react';
import { api, apiError } from '@/lib/api';
import { exportCsv } from '@/lib/report-output';
import type { WriteoffFileLine } from './writeoff-api';
import type { DraftWriteoffLine } from './writeoff-form-values';
import { unitLabel } from './units';

export function exportWriteoffLines(rows: DraftWriteoffLine[]) {
  exportCsv('Позиции списания', ['Наименование', 'Количество', 'Единица', 'Детали'], rows
    .filter((row) => row.sourceId)
    .map((row) => [row.name ?? '', row.quantity, row.packageName ?? unitLabel(row.unit), row.details ?? '']));
}

export function WriteoffFileImport({ disabled, onBusy, onRead }: {
  disabled: boolean; onBusy: (busy: boolean) => void; onRead: (lines: WriteoffFileLine[]) => boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ count: number; warnings: string[] }>();
  useEffect(() => () => active.current?.abort(), []);
  async function read(files: File[]) {
    if (!files.length || disabled || active.current) return;
    setResult(undefined);
    setError('');
    if (files.length > 2 || (files.length > 1 && files.some((file) => !/\.(jpe?g|png)$/iu.test(file.name)))) {
      setError('Выберите один PDF, одну таблицу или до двух фото одного документа.');
      return;
    }
    if (files.some((file) => !file.size || file.size > 12 * 1024 * 1024)) {
      setError('Размер файла должен быть больше нуля и до 12 МБ.');
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setReading(true);
    onBusy(true);
    try {
      const body = new FormData();
      files.forEach((file) => body.append('files', file));
      const { data } = await api.post<{ lines: WriteoffFileLine[]; warnings: string[] }>('/admin/warehouse/documents/writeoff-import/preview',
        body, { signal: controller.signal, timeout: 125_000 });
      if (controller.signal.aborted) return;
      if (!onRead(data.lines)) {
        setError('В одном списании может быть до 200 позиций.');
        return;
      }
      setResult({ count: data.lines.length, warnings: data.warnings });
    } catch (failure) {
      if (!controller.signal.aborted) setError(apiError(failure));
    } finally {
      active.current = undefined;
      setReading(false);
      onBusy(false);
    }
  }
  return <section aria-label="Заполнение из файла" className="rounded-lg border border-dashed border-border bg-background p-4"
    onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void read(Array.from(event.dataTransfer.files)); }}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-medium">Заполнить из файла</h2>
        <p className="text-xs text-text-muted">Перетащите фото, PDF или таблицу с наименованиями и количеством.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={input} type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.xls,.xlsx,.csv" className="sr-only" tabIndex={-1}
          aria-label="Файл списания" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void read(files); }} />
        <button type="button" className="btn-secondary btn-sm" disabled={disabled || reading} onClick={() => input.current?.click()}>
          {reading ? 'Распознавание…' : 'Выбрать файл'}
        </button>
        {reading && <button type="button" className="text-sm text-primary" onClick={() => active.current?.abort()}>Отменить</button>}
      </div>
    </div>
    {result && <p role="status" className="mt-2 text-sm">Добавлено строк: {result.count}. Сверьте позиции и количества с документом.</p>}
    {!!result?.warnings.length && <ul className="mt-2 list-disc pl-5 text-xs text-text-muted">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
  </section>;
}
