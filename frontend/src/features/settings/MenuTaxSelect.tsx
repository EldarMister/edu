import { Select } from '@/components/Select';
import { taxRateLabel } from '@/lib/format';
import { useMenuTaxOptions } from './taxes-api';

export function effectiveMenuTaxId(item: { taxId?: string | null; taxExempt?: boolean; category: { taxId?: string | null } }) {
  return item.taxExempt ? null : item.taxId ?? item.category.taxId ?? null;
}

export function dishTaxValue(dish?: { taxId?: string | null; taxExempt?: boolean }) {
  return dish?.taxExempt ? 'exempt' : dish?.taxId ?? '';
}

export function dishTaxInput(value: string) {
  return { taxId: value && value !== 'exempt' ? value : null, taxExempt: value === 'exempt' };
}

export function MenuTaxSelect({ value, onChange, inherit = false, parentCategory = false, categoryTaxId, disabled, ariaLabel = 'Налог' }: {
  value: string;
  onChange: (value: string) => void;
  inherit?: boolean;
  parentCategory?: boolean;
  categoryTaxId?: string | null;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const taxes = useMenuTaxOptions();
  const options = (taxes.data ?? []).map((tax) => ({ value: tax.id, label: `${tax.name} · ${taxRateLabel(tax.rate)}` }));
  const parent = options.find((tax) => tax.value === categoryTaxId);
  const inheritLabel = parentCategory ? `Налог родительской категории (${parent?.label ?? 'Налог не указан'})`
    : parent ? `По категории · ${parent.label}` : 'По категории';
  return <>
    <Select ariaLabel={ariaLabel} value={value} onChange={onChange} className="w-full"
      disabled={disabled || taxes.isPending || taxes.isError}
      options={[
        { value: '', label: inherit ? inheritLabel : 'Без налога' },
        ...(inherit ? [{ value: 'exempt', label: 'Без налога' }] : []),
        ...options,
      ]} />
    {taxes.isError && <button type="button" className="mt-1 text-xs text-primary" onClick={() => void taxes.refetch()}>
      Загрузить ставки повторно
    </button>}
  </>;
}
