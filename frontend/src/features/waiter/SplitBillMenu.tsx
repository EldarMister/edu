import { ColumnPopover } from '@/features/admin/components/ColumnPopover';
import { useT } from '@/lib/i18n';
import { SPLIT_OPTIONS, type SplitMode } from './splitBillModel';

export function SplitBillMenu({ anchor, modes, availableModes, onClose, onSelect }: {
  anchor: HTMLButtonElement;
  modes?: readonly SplitMode[];
  availableModes: readonly SplitMode[];
  onClose: () => void;
  onSelect: (mode: SplitMode) => void;
}) {
  const t = useT();
  const options = modes ? modes.flatMap((mode) => SPLIT_OPTIONS.filter(({ value }) => value === mode)) : SPLIT_OPTIONS;
  return <ColumnPopover anchor={anchor} title={t('Разделить счёт')} onClose={onClose}>
    {options.map(({ value, label }) => <button type="button" key={value}
      className="block w-full rounded-md px-2 py-2 text-left text-sm hover:bg-primary/10 disabled:opacity-50"
      disabled={!availableModes.includes(value)} onClick={() => { onClose(); onSelect(value); }}>
      {t(label)}
    </button>)}
  </ColumnPopover>;
}
