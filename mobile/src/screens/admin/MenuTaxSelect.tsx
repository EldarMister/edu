import React from 'react';
import { AnchoredSelectScope, Select } from '@/components/Select';
import { Button } from '@/components/ui';
import { useMenuTaxOptions } from '@/services/api/taxes';
import type { MenuTax } from '@/types';

export function menuTaxLabel(tax: MenuTax) {
  return `${tax.name} · ${String(tax.rate).replace('.', ',')} %`;
}

export function dishTaxValue(dish?: { taxId?: string | null; taxExempt?: boolean } | null) {
  return dish?.taxExempt ? 'exempt' : dish?.taxId ?? '';
}

export function dishTaxInput(value: string) {
  return { taxId: value && value !== 'exempt' ? value : null, taxExempt: value === 'exempt' };
}

export function effectiveMenuTaxId(item: { taxId?: string | null; taxExempt?: boolean; category: { taxId?: string | null } }) {
  return item.taxExempt ? null : item.taxId ?? item.category.taxId ?? null;
}

export function MenuTaxSelect({ value, onChange, inherit = false, categoryTaxId, disabled }: {
  value: string; onChange: (value: string) => void; inherit?: boolean; categoryTaxId?: string | null; disabled?: boolean;
}) {
  const taxes = useMenuTaxOptions();
  const options = (taxes.data ?? []).map((tax) => ({ value: tax.id, label: menuTaxLabel(tax), translate: false }));
  const parent = options.find((tax) => tax.value === categoryTaxId);
  return <>
    <AnchoredSelectScope>
      <Select title="Налог" value={value} onChange={onChange} disabled={disabled || taxes.isPending || taxes.isError}
        options={[
          { value: '', label: inherit ? (parent ? `По категории · ${parent.label}` : 'По категории') : 'Без налога' },
          ...(inherit ? [{ value: 'exempt', label: 'Без налога' }] : []),
          ...options,
        ]} />
    </AnchoredSelectScope>
    {taxes.isError ? <Button title="Загрузить ставки повторно" variant="secondary" size="md" onPress={() => void taxes.refetch()} /> : null}
  </>;
}
