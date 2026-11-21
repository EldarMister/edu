import { ReportPeriodFilter, REPORT_PERIODS, type PeriodPreset } from './ReportPeriodFilter';
import { usePageFilters } from './workspace-route';
import { calendarDate, warehouseDay, warehousePeriodRange } from './warehouse-period';

export function useListPeriod(name: string, defaultPeriod: PeriodPreset = 'all') {
  const periodKey = `${name}Period`;
  const fromKey = `${name}From`;
  const toKey = `${name}To`;
  const pageKey = `${name}Page`;
  const expandedKey = `${name}Expanded`;
  const [values, update] = usePageFilters({ [periodKey]: defaultPeriod, [fromKey]: '', [toKey]: '', [pageKey]: '1', [expandedKey]: '' });
  const selection = values[periodKey];
  const preset = selection === 'custom' ? selection : REPORT_PERIODS.find(({ value }) => value === selection)?.value ?? defaultPeriod;
  const today = warehouseDay();
  const range = warehousePeriodRange(preset, today, values[fromKey] || calendarDate(today, -29), values[toKey] || calendarDate(today));
  return {
    active: preset !== 'all',
    range,
    includes(value: string) {
      if (preset === 'all') return true;
      const parsed = new Date(value);
      if (!Number.isFinite(+parsed)) return false;
      const day = calendarDate(warehouseDay(parsed));
      return (!range.dateFrom || day >= range.dateFrom) && (!range.dateTo || day <= range.dateTo);
    },
    filter: <ReportPeriodFilter preset={preset} today={today} range={range} label="Период" allCaption="За всё время"
      onPreset={(value) => update({ [periodKey]: value, [fromKey]: '', [toKey]: '', [pageKey]: '1', [expandedKey]: '' })}
      onRange={(from, to) => update({ [periodKey]: 'custom', [fromKey]: from, [toKey]: to, [pageKey]: '1', [expandedKey]: '' })} />,
  };
}
