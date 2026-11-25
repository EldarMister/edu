import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatePicker } from '@/components/DatePicker';
import { Modal } from '@/components/Modal';
import { api, apiError } from '@/lib/api';
import { financeKey } from './finance/api';
import { financeDay, parseMoney } from './finance/finance-format';
import type { PositionSalary } from './positions-api';
import { DocumentField, QueryState } from './warehouse/WarehouseUi';

interface Rate {
  effectiveDay: string;
  usePosition: boolean;
  salary: PositionSalary;
}
interface SalarySettings {
  current: Rate | null;
  scheduled: Rate[];
  positionSalary: PositionSalary;
}

const fields: { key: keyof PositionSalary; label: string; maximum: number }[] = [
  { key: 'hourly', label: 'За час, с', maximum: 9_999_999_999.99 },
  { key: 'perShift', label: 'За смену, с', maximum: 9_999_999_999.99 },
  { key: 'monthly', label: 'За месяц, с', maximum: 9_999_999_999.99 },
  { key: 'personalPercent', label: 'Процент от личных продаж', maximum: 100 },
  { key: 'shiftPercent', label: 'Процент от продаж за смену', maximum: 100 },
];
function rateInputs(salary: PositionSalary) {
  return Object.fromEntries(fields.map(({ key }) => [key, String(salary[key])])) as Record<keyof PositionSalary, string>;
}

export function EmployeeSalaryEditor({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const url = `/admin/staff/${encodeURIComponent(id)}/salary`;
  const title = `Ставки зарплаты · ${name}`;
  const query = useQuery({ queryKey: ['admin', 'staff', 'salary', id], queryFn: async () => (await api.get<SalarySettings>(url)).data });
  if (!query.data) return <Modal open title={title} onClose={onClose}><QueryState pending={query.isPending} error={query.error} /></Modal>;
  return <SalaryForm title={title} url={url} settings={query.data} onClose={onClose} />;
}

function SalaryForm({ title, url, settings, onClose }: {
  title: string; url: string; settings: SalarySettings; onClose: () => void;
}) {
  const formId = useId();
  const cache = useQueryClient();
  const tomorrow = financeDay(new Date(Date.now() + 86_400_000));
  const scheduled = settings.scheduled.at(-1);
  const shown = scheduled ?? settings.current;
  const [usePosition, setUsePosition] = useState(shown?.usePosition ?? true);
  const [effectiveDay, setEffectiveDay] = useState(scheduled?.effectiveDay ?? tomorrow);
  const [dayValid, setDayValid] = useState(true);
  const [input, setInput] = useState(() => rateInputs(shown && !shown.usePosition ? shown.salary : settings.positionSalary));
  const save = useMutation({
    mutationFn: (body: Rate) => api.patch(url, body),
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['admin', 'staff', 'salary'] }),
        cache.invalidateQueries({ queryKey: financeKey }),
      ]);
      onClose();
    },
  });
  const rates = Object.fromEntries(fields.map(({ key }) => [key, input[key].trim() ? parseMoney(input[key]) : 0])) as Record<keyof PositionSalary, number | null>;
  const valid = dayValid && effectiveDay >= tomorrow && (usePosition || fields.every(({ key, maximum }) =>
    rates[key] !== null && rates[key]! >= 0 && rates[key]! <= maximum));
  const close = () => { if (!save.isPending) onClose(); };
  return <Modal open manageFocus title={title} panelClassName="max-w-2xl" onClose={close}
    footer={<div className="flex justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" onClick={close} disabled={save.isPending}>Отмена</button>
      <button type="submit" form={formId} className="btn-primary btn-md" disabled={!valid || save.isPending}>Сохранить</button>
    </div>}>
    <form id={formId} className="space-y-4" onSubmit={(event) => {
      event.preventDefault();
      if (valid && !save.isPending) save.mutate({ usePosition, effectiveDay, salary: usePosition ? settings.positionSalary : rates as PositionSalary });
    }}>
      <p className="text-sm text-text-secondary">Сейчас действуют {settings.current?.usePosition === false ? 'личные ставки' : 'ставки должности'}.</p>
      {settings.scheduled.length > 0 && <div className="flex flex-wrap gap-2 text-sm">
        <span className="self-center text-text-muted">Запланировано</span>
        {settings.scheduled.map((rate) => <button key={rate.effectiveDay} type="button" className="btn-secondary btn-sm"
          onClick={() => {
            setEffectiveDay(rate.effectiveDay);
            setUsePosition(rate.usePosition);
            setInput(rateInputs(rate.usePosition ? settings.positionSalary : rate.salary));
          }}>{rate.effectiveDay.split('-').reverse().join('.')} · {rate.usePosition ? 'должность' : 'личные'}</button>)}
      </div>}
      <fieldset disabled={save.isPending} className="space-y-3">
        <label className="flex items-center gap-2"><input type="checkbox" checked={!usePosition}
          onChange={(event) => setUsePosition(!event.target.checked)} /> Использовать личные ставки</label>
        {!usePosition && <>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map(({ key, label }) => <label key={key} className="grid gap-1 text-sm">{label}
              <input className="input w-full" inputMode="decimal" value={input[key]}
                onChange={(event) => setInput({ ...input, [key]: event.target.value })} />
            </label>)}
          </div>
          <p className="text-xs text-text-muted">Личные ставки заменяют ставки должности. Пустая ставка считается нулевой.</p>
        </>}
        <DocumentField label="Начало действия">
          <DatePicker aria-label="Начало действия" value={effectiveDay} min={tomorrow} onValidityChange={setDayValid}
            onChange={setEffectiveDay} className="input w-full" />
        </DocumentField>
        {!valid && <p role="alert" className="text-sm text-danger">Проверьте дату, суммы и проценты от 0 до 100.</p>}
      </fieldset>
      {save.isError && <p role="alert" className="text-sm text-danger">{apiError(save.error)}</p>}
    </form>
  </Modal>;
}
