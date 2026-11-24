import { usePermissions } from '@/hooks/usePermissions';
import { printReport } from '@/lib/report-output';
import { useNotifications } from '@/store/notifications';
import { IconPrinter } from '../../components/icons';
import type { PreparationRecipe } from './api';
import { costLabel } from './cost-format';
import { recipeQuantity } from './recipe-draft-values';
import { recipeProcessingLabel } from './RecipeProcessingFields';
import { unitLabel } from './units';

export function PreparationPrintButton({ recipe }: { recipe: PreparationRecipe }) {
  const costs = usePermissions().can('actions.warehouseCosts');
  const push = useNotifications((state) => state.push);
  function print() {
    const caption = [
      'Выход ' + recipeQuantity(recipe.outputQuantity, unitLabel(recipe.outputUnit)),
      costs ? 'Себестоимость: ' + costLabel(recipe.totalCost) : null,
    ].filter(Boolean).join(' · ');
    const headings = ['Продукты', 'Обработка', 'Брутто', 'Нетто', ...(costs ? ['Себестоимость'] : [])];
    const rows = recipe.items.map((item) => {
      const unit = unitLabel(item.unit);
      const net = item.netWeightGrams == null
        ? recipeQuantity(item.netAmount ?? item.quantity * (1 - (item.lossPercent ?? 0) / 100), unit)
        : recipeQuantity(item.netWeightGrams, 'г');
      return [item.name, recipeProcessingLabel(item) || '—', recipeQuantity(item.quantity, unit), net,
        ...(costs ? [costLabel(item.lineCost)] : [])];
    });
    if (!printReport(recipe.name, caption, headings, rows, { title: 'Технология приготовления', text: recipe.instructions ?? '' })) {
      push({ message: 'Разрешите открытие окна печати в браузере.', at: new Date().toISOString() });
    }
  }
  return <button type="button" className="btn-secondary btn-md inline-flex items-center gap-2"
    title="Печать сохранённой рецептуры" disabled={!recipe.items.length} onClick={print}>
    <IconPrinter className="h-4 w-4" aria-hidden="true" /> Распечатать
  </button>;
}
