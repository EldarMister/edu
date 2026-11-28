import { Fragment, useState, type ReactNode } from 'react';
import { useFilterPreference } from '@/hooks/useColumnPreference';
import { useT } from '@/lib/i18n';
import { ColumnCheckbox, ColumnPopover } from './ColumnPopover';
import { IconSliders } from './icons';
import './filter-visibility.css';

export type VisibilityFilter<T> = {
  key: string;
  label: string;
  control: ReactNode;
  defaultVisible?: boolean;
  clear?: T;
};

export function FilterVisibility<T>({ view, filters, onClear }: {
  view: string;
  filters: VisibilityFilter<T>[];
  onClear: (changes: T[]) => void;
}) {
  const t = useT();
  const title = t('Отображать фильтры');
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const defaults = filters.filter(({ defaultVisible }) => defaultVisible).map(({ key }) => key).join(',');
  const [saved, save] = useFilterPreference(view, defaults);
  const preferred = saved.split(',');
  const visible = filters.filter(({ key, clear }) => clear !== undefined || preferred.includes(key));

  function toggle(filter: VisibilityFilter<T>, checked: boolean) {
    const keys = filters.filter(({ key }) => key === filter.key ? checked : preferred.includes(key));
    save(keys.map(({ key }) => key).join(','));
    if (!checked && filter.clear !== undefined) onClear([filter.clear]);
  }

  function reset() {
    save(defaults);
    const hidden = filters.flatMap(({ defaultVisible, clear }) => !defaultVisible && clear !== undefined ? [clear] : []);
    if (hidden.length) onClear(hidden);
  }

  return <>
    <button type="button" className="filter-visibility-trigger" title={title} aria-label={title}
      aria-haspopup="dialog" aria-expanded={anchor !== null}
      onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}>
      <IconSliders aria-hidden="true" />
    </button>
    {visible.map(({ key, control }) => <Fragment key={key}>{control}</Fragment>)}
    {anchor && <ColumnPopover anchor={anchor} title={title} align="start" onClose={() => setAnchor(null)} onReset={reset}>
      {filters.map((filter) => <ColumnCheckbox key={filter.key} checked={visible.includes(filter)}
        onChange={(checked) => toggle(filter, checked)}>{t(filter.label)}</ColumnCheckbox>)}
    </ColumnPopover>}
  </>;
}
