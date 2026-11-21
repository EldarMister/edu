import { money } from '@/lib/format';
export function costLabel(value: number | null | undefined): string {
  return value == null ? 'Неизвестно' : money(value);
}
