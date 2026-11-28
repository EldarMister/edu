import { FilterVisibility, type VisibilityFilter } from '../../components/FilterVisibility';

type FilterPatch = Record<string, string>;

export function WarehouseFilters({ view, filters, onClear }: {
  view: string;
  filters: VisibilityFilter<FilterPatch>[];
  onClear: (patch: FilterPatch) => void;
}) {
  return <FilterVisibility view={'warehouse-' + view} filters={filters}
    onClear={(patches) => onClear(Object.assign({}, ...patches))} />;
}
