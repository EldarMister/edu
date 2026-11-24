import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { api, apiError } from '@/lib/api';
import { exportCsv } from '@/lib/report-output';
import { useNotifications } from '@/store/notifications';
import { IconImport } from '../components/icons';

type Kind = 'goods' | 'recipe';
type Preview = {
  count: number;
  rows: { row: number; name: string; category: string; price: number; components: number; exists: boolean }[];
  errors: { row: number; message: string }[];
};
const templates = {
  goods: { title: 'Импорт товаров', headings: ['Название', 'Категория', 'Цена', 'Ед. измерения'], rows: [['Вода 500 мл', '', '40', 'шт']] },
  recipe: { title: 'Импорт техкарт', headings: ['Название', 'Категория', 'Цена', 'Компонент', 'Брутто', 'Ед. измерения'],
    rows: [['Лепёшка', '', '70', 'Мука', '90', 'г'], ['Лепёшка', '', '70', 'Вода', '40', 'мл']] },
};

export function MenuImportButton({ kind }: { kind: Kind }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="supply-header-action" title="Импорт" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <IconImport aria-hidden="true" /><span className="catalogue-action-label">Импорт</span>
    </button>
    {open && <MenuImportDialog kind={kind} close={() => setOpen(false)} />}
  </>;
}

function MenuImportDialog({ kind, close }: { kind: Kind; close: () => void }) {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const notify = useNotifications((state) => state.push);
  const query = useQueryClient();
  const { title, headings, rows } = templates[kind];
  async function submit(apply: boolean) {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      const { data } = await api.post<Preview>(`/admin/menu/import/${kind}?apply=${apply}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (!apply) {
        setPreview(data);
        return;
      }
      await query.invalidateQueries({ queryKey: ['admin'] });
      notify({ message: `Добавлено ${kind === 'goods' ? 'товаров' : 'техкарт'}: ${data.count}`, at: new Date().toISOString() });
      close();
    } catch (failure) {
      setError(apiError(failure));
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  }
  return <Modal open manageFocus title={title} panelClassName="max-w-2xl" onClose={() => { if (!busy) close(); }}
    footer={<div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" disabled={busy} onClick={close}>Отмена</button>
      <button type="button" className="btn-primary btn-md"
        disabled={!file || busy || !!preview && (!preview.count || !!preview.errors.length)}
        onClick={() => void submit(!!preview)}>{busy ? 'Обработка…' : preview ? 'Провести импорт' : 'Проверить данные'}</button>
    </div>}>
    <div className="space-y-4 text-sm">
      <label className="block">Таблица CSV, XLS или XLSX
        <input className="mt-2 block w-full" type="file" accept=".csv,.xls,.xlsx" disabled={busy}
          onChange={(event) => { setFile(event.target.files?.[0]); setPreview(undefined); setError(''); }} />
      </label>
      <button type="button" className="text-primary hover:underline" onClick={() => exportCsv(title, headings, rows)}>Скачать шаблон</button>
      <p className="text-text-secondary">Укажите название существующей категории или оставьте ячейку пустой для главного экрана. Существующие позиции пропускаются.</p>
      {kind === 'recipe' && <p className="text-text-secondary">Шаблон предназначен для обычных техкарт. Каждый компонент укажите отдельной строкой, повторяя название и категорию техкарты. Используйте названия из списка ингредиентов и полуфабрикатов.</p>}
      {preview && <>
        <p role="status">К добавлению {preview.count} из {preview.rows.length}</p>
        {preview.errors.length > 0 && <ul role="alert" className="max-h-32 space-y-1 overflow-auto text-danger">
          {preview.errors.map(({ row, message }) => <li key={row}>Строка {row}. {message}</li>)}
        </ul>}
        <div className="relative max-h-64 overflow-auto">
          <table className="poster-table w-full min-w-[420px]">
            <thead><tr><th>Название</th><th>Категория</th><th>Цена</th>{kind === 'recipe' && <th>Компонентов</th>}<th>Статус</th></tr></thead>
            <tbody>{preview.rows.map((row) => <tr key={row.row}>
              <td>{row.name}</td><td>{row.category}</td><td>{row.price}</td>{kind === 'recipe' && <td>{row.components}</td>}
              <td>{row.exists ? 'Уже есть' : 'Новая позиция'}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </>}
      {error && <p role="alert" className="text-danger">{error}</p>}
    </div>
  </Modal>;
}
