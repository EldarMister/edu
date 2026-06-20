import data from './kitchenVoiceScenarios.json';

export interface KitchenVoiceScenario {
  id: string;
  text: string;
}

/** Фиксированные тестовые сценарии кухни — единый источник для фронта и генератора
 *  предзаписанных озвучек (`kitchenVoiceScenarios.json`). */
export const KITCHEN_VOICE_TEST_SCENARIOS: KitchenVoiceScenario[] = data.scenarios;

/** Базовый путь к статическим предзаписанным озвучкам (в `frontend/public`). */
export const KITCHEN_SAMPLES_BASE = '/kitchen-voice';

export interface KitchenSamplesManifest {
  format: string; // 'mp3'
  speakers: string[]; // голоса, для которых есть предзапись
  scenarioIds: string[];
  generatedAt?: string;
}
