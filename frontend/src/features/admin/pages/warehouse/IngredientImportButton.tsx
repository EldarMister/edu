import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { api, apiError } from '@/lib/api';
import { exportCsv } from '@/lib/report-output';
import { useNotifications } from '@/store/notifications';
import { IconImport } from '../../components/icons';

type Sheet = { headings: string[]; rows: string[][] };
type Check = { count: number; rows: { status: string; message: string }[] };
const fields = { name: 'Название', category: 'Категория', unit: 'Ед. измерения' };
type Field = keyof typeof fields;
const keys = Object.keys(fields) as Field[];

export function IngredientImportButton() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="workspace-tool" title="Импорт" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <IconImport /><span className="catalogue-action-label">Импорт</span></button>
    {open && <ImportDialog close={() => setOpen(false)} />}
  </>;
}

function ImportDialog({ close }: { close: () => void }) {
  const client = useQueryClient();
  const notify = useNotifications((state) => state.push);
  const [sheet, setSheet] = useState<Sheet>();
  const [mapping, setMapping] = useState({ name: -1, category: -1, unit: -1 });
  const [check, setCheck] = useState<Check>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mapped = sheet?.rows.map((row) => ({ name: row[mapping.name] ?? '', category: row[mapping.category] ?? '', unit: row[mapping.unit] ?? '' })) ?? [];
  const validMapping = mapping.name >= 0 && mapping.unit >= 0 && new Set(Object.values(mapping).filter((index) => index >= 0)).size === (mapping.category >= 0 ? 3 : 2);
  async function read(file: File) {
    setBusy(true); setError(''); setCheck(undefined); setSheet(undefined);
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await api.post<Sheet>('/admin/warehouse/ingredients/import/read', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSheet(data);
      setMapping({ name: data.headings.findIndex((text) => /назван|наименован/i.test(text)),
        category: data.headings.findIndex((text) => /категор/i.test(text)), unit: data.headings.findIndex((text) => /ед.*изм|единиц/i.test(text)) });
    } catch (failure) { setError(apiError(failure)); } finally { setBusy(false); }
  }
  async function verify(apply: boolean) {
    setBusy(true); setError('');
    try {
      const { data } = await api.post<Check>('/admin/warehouse/ingredients/import', { rows: mapped, apply });
      if (apply) {
        await client.invalidateQueries({ queryKey: ['admin', 'warehouse'] });
        notify({ message: `Добавлено ингредиентов: ${data.count}`, at: new Date().toISOString() });
        close();
      } else setCheck(data);
    } catch (failure) { setCheck(undefined); setError(apiError(failure)); } finally { setBusy(false); }
  }
  return <Modal open manageFocus title="Импорт ингредиентов" onClose={() => { if (!busy) close(); }}
    footer={<div className="flex justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" disabled={busy} onClick={close}>Отмена</button>
      {sheet && <button type="button" className="btn-primary btn-md" disabled={busy || !validMapping || !!check && (!check.count || check.rows.some((row) => row.status === 'error'))}
        onClick={() => void verify(!!check)}>{busy ? 'Обработка…' : check ? 'Провести импорт' : 'Проверить данные'}</button>}
    </div>}>
    <div className="space-y-4">
      <label className="block text-sm">Таблица CSV, XLS или XLSX
        <input className="mt-2 block w-full" type="file" accept=".csv,.xls,.xlsx" disabled={busy}
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void read(file); event.target.value = ''; }} />
      </label>
      <button type="button" className="text-sm text-primary" onClick={() => exportCsv('Шаблон ингредиентов', Object.values(fields), [['Мука', 'Бакалея', 'кг']])}>Скачать шаблон</button>
      {sheet && <fieldset disabled={busy} className="grid gap-2 sm:grid-cols-3">
        <legend className="mb-2 font-medium">Сопоставление столбцов</legend>
        {keys.map((key) => <label key={key} className="text-sm">{fields[key]}
          <select className="input mt-1 w-full" value={mapping[key]} onChange={(event) => {
            setMapping({ ...mapping, [key]: Number(event.target.value) }); setCheck(undefined); setError('');
          }}>
            <option value={-1}>{key === 'category' ? 'Без категории' : 'Выберите столбец'}</option>
            {sheet.headings.map((heading, index) => <option key={index} value={index}>{heading || `Столбец ${index + 1}`}</option>)}
          </select>
        </label>)}
      </fieldset>}
      {check && <div className="max-h-72 overflow-auto">
        <p className="mb-2 text-sm">К добавлению {check.count} из {mapped.length}</p>
        <table className="poster-table w-full text-sm"><thead><tr><th>Название</th><th>Категория</th><th>Ед.</th><th>Проверка</th></tr></thead>
          <tbody>{mapped.map((row, index) => <tr key={index}>
            <td>{row.name}</td><td>{row.category}</td><td>{row.unit}</td>
            <td className={check.rows[index]?.status === 'error' ? 'text-danger' : ''}>{check.rows[index]?.message}</td>
          </tr>)}</tbody></table>
      </div>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  </Modal>;
}
