import { BadRequestException } from '@nestjs/common';

// Warehouse date filters are calendar days in the restaurant's business timezone.
// Use an explicit offset so deployments do not depend on the host timezone.
export function warehouseDateRange(from?: string, to?: string) {
  const parse = (value: string, end: boolean) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Дата должна быть в формате ГГГГ-ММ-ДД');
    const utc = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('Указана некорректная дата');
    }
    return new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}+06:00`);
  };
  const gte = from ? parse(from, false) : undefined;
  const lte = to ? parse(to, true) : undefined;
  if (gte && lte && gte > lte) throw new BadRequestException('Начало периода должно быть раньше окончания');
  return gte || lte ? { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } : undefined;
}

export function warehouseDay(date: Date) {
  return new Date(date.getTime() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
