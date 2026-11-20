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

export function MenuTaxSelect({ value, onChange, inherit = false, categoryTaxId, disabled }: {
  value: string;
  onChange: (value: string) => void;
  inherit?: boolean;
  categoryTaxId?: string | null;
  disabled?: boolean;
}) {
  const taxes = useMenuTaxOptions();
  const options = (taxes.data ?? []).map((tax) => ({ value: tax.id, label: `${tax.name} · ${taxRateLabel(tax.rate)}` }));
  const parent = options.find((tax) => tax.value === categoryTaxId);
  return <>
    <Select ariaLabel="Налог" value={value} onChange={onChange} className="w-full"
      disabled={disabled || taxes.isPending || taxes.isError}
      options={[
        { value: '', label: inherit ? (parent ? `По категории · ${parent.label}` : 'По категории') : 'Без налога' },
        ...(inherit ? [{ value: 'exempt', label: 'Без налога' }] : []),
        ...options,
      ]} />
    {taxes.isError && <button type="button" className="mt-1 text-xs text-primary" onClick={() => void taxes.refetch()}>
      Загрузить ставки повторно
    </button>}
  </>;
}
