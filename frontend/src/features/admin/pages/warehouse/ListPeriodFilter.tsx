import { DatePicker } from '@/components/DatePicker';
import { Select } from '@/components/Select';
import { usePageFilters } from './workspace-route';

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function useListPeriod(name: string, defaultPeriod = 'all') {
  const today = new Date();
  const monthAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
  const [values, update] = usePageFilters({
    [`${name}Period`]: defaultPeriod,
    [`${name}From`]: '',
    [`${name}To`]: '',
  });
  const period = values[`${name}Period`];
  const from = values[`${name}From`] || localDay(monthAgo);
  const to = values[`${name}To`] || localDay(today);
  const start = period === 'custom' ? from : localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (period === 'month' ? 29 : period === 'week' ? 6 : 0)));
  const end = period === 'custom' ? to : localDay(today);
  return {
    active: period !== 'all',
    includes(value: string) {
      if (period === 'all') return true;
      const day = localDay(new Date(value));
      return (!start || day >= start) && (!end || day <= end);
    },
    filter: <div className="poster-period-filter flex flex-wrap items-center gap-2">
      <Select ariaLabel="Период" value={period} onChange={(value) => update({ [`${name}Period`]: value,
        ...(value === 'custom' ? { [`${name}From`]: from, [`${name}To`]: to } : {}) })}
        options={[
          { value: 'all', label: 'За всё время' },
          { value: 'today', label: 'Сегодня' },
          { value: 'week', label: 'Последние 7 дней' },
          { value: 'month', label: 'Последние 30 дней' },
          { value: 'custom', label: 'Выбрать период' },
        ]} />
      {period === 'custom' && <>
        <DatePicker aria-label="Начало периода" className="input w-36" value={from} max={to || undefined} onChange={(value) => update({ [`${name}From`]: value })} />
        <span className="text-text-muted">—</span>
        <DatePicker aria-label="Конец периода" className="input w-36" value={to} min={from || undefined} onChange={(value) => update({ [`${name}To`]: value })} />
      </>}
    </div>,
  };
}
