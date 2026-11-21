import { BadRequestException } from '@nestjs/common';
import { isISO8601 } from 'class-validator';

export function parseStockEffectiveAt(value: string | null | undefined, now = new Date()) {
  if (value == null) return value;
  if (typeof value !== 'string' || !isISO8601(value, { strict: true, strictSeparator: true })
    || !/T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new BadRequestException('Укажите дату и время складской операции с часовым поясом');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date > now) {
    throw new BadRequestException('Дата складской операции не может быть в будущем');
  }
  return date;
}
