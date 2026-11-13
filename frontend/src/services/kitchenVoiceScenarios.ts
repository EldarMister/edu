import data from './kitchenVoiceScenarios.json';

export interface KitchenVoiceScenario {
  id: string;
  text: string;
}

/** Фиксированные тестовые сценарии кухни — единый источник для фронта и генератора
 *  предзаписанных озвучек (`kitchenVoiceScenarios.json`). */
export const KITCHEN_VOICE_TEST_SCENARIOS: KitchenVoiceScenario[] = data.scenarios;

export const WAITER_VOICE_TEST_SCENARIOS = [
  { id: 'waiter-ready', text: 'Стол шесть, терраса. Заказ номер двадцать четыре готов. Заберите на кухне два лагмана и салат из свежих овощей.' },
  { id: 'waiter-partial', text: 'Стол три, основной зал. Для заказа номер двенадцать готов шашлык с картофелем. Остальные блюда ещё готовятся.' },
  { id: 'waiter-bar', text: 'Стол восемь, терраса. Бар приготовил чайник зелёного чая, два лимонада и один капучино. Заберите напитки.' },
  { id: 'waiter-rejected', text: 'Стол пять, основной зал. Кухня не сможет приготовить куриный суп для заказа номер семнадцать. Уточните у гостей, чем заменить блюдо.' },
  { id: 'waiter-cancelled', text: 'Стол два, кабина. В заказе номер тридцать один отменены два чизкейка и порция мороженого. Остальные позиции остаются в заказе.' },
  { id: 'waiter-receipt', text: 'Стол четыре, терраса. Счёт по заказу номер двадцать распечатан. Заберите его у администратора и отнесите гостям.' },
];

/** Базовый путь к статическим предзаписанным озвучкам (в `frontend/public`). */
export const KITCHEN_SAMPLES_BASE = '/kitchen-voice';

export interface KitchenSamplesManifest {
  format: string; // 'mp3'
  speakers: string[]; // голоса, для которых есть предзапись
  scenarioIds: string[];
  generatedAt?: string;
}
