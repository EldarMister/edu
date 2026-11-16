import { ReportPeriodFilter, REPORT_PERIODS, type PeriodPreset } from '../warehouse/ReportPeriodFilter';
import { calendarDate, warehouseDay, warehousePeriodRange } from '../warehouse/warehouse-period';

export function FinancePeriod({ from, to, allFrom, onApply }: {
  from: string; to: string; allFrom?: string; onApply: (period: { from: string; to: string }) => void;
}) {
  const today = warehouseDay();
  const allRange = allFrom ? { dateFrom: allFrom, dateTo: calendarDate(today) } : undefined;
  const getRange = (preset: PeriodPreset) => preset === 'all' && allRange ? allRange : warehousePeriodRange(preset, today, from, to);
  const preset = REPORT_PERIODS.find(({ value }) => {
    const range = getRange(value);
    return range.dateFrom === from && range.dateTo === to;
  })?.value ?? 'custom';
  return <ReportPeriodFilter preset={preset} label="Период" today={today} range={getRange('custom')}
    confirmSelection includeAll={!!allRange} allRange={allRange} allCaption="За всё время" onRange={(start, end) => onApply({ from: start, to: end })}
    onPreset={(selection) => {
      const { dateFrom, dateTo } = getRange(selection);
      if (dateFrom && dateTo) onApply({ from: dateFrom, to: dateTo });
    }} />;
}
