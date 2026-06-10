import { KitchenApp } from '@/features/kitchen/KitchenApp';

/**
 * Экран «Бар» — та же логика и интерфейс, что у кухни, но показывает только
 * барные позиции заказов (`station='bar'`). См. KitchenApp.
 */
export function BarApp() {
  return <KitchenApp station="bar" title="Бар" />;
}
