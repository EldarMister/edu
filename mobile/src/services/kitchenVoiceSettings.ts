import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Настройки озвучки кухни — как в PWA (localStorage → AsyncStorage). */
export type KitchenSpeaker = 'baya' | 'kseniya' | 'xenia' | 'eugene' | 'aidar';
export type KitchenSpeechRate = 0.8 | 0.9 | 1 | 1.1 | 1.2 | 1.5;

export interface KitchenVoiceSettings {
  speaker: KitchenSpeaker;
  notificationsEnabled: boolean;
  voiceEnabled: boolean;
  speechRate: KitchenSpeechRate;
  preferredModel: 'v5_2_ru';
  fallbackModel: 'v4_ru';
}

export const KITCHEN_SPEAKERS: { value: KitchenSpeaker; label: string }[] = [
  { value: 'baya', label: 'Baya' },
  { value: 'kseniya', label: 'Ksenia' },
  { value: 'xenia', label: 'Xenia' },
  { value: 'eugene', label: 'Eugene' },
  { value: 'aidar', label: 'Aidar' },
];

export const KITCHEN_SPEECH_RATES: KitchenSpeechRate[] = [0.8, 0.9, 1, 1.1, 1.2, 1.5];

const DEFAULT_SETTINGS: KitchenVoiceSettings = {
  speaker: 'baya',
  notificationsEnabled: true,
  voiceEnabled: true,
  speechRate: 1,
  preferredModel: 'v5_2_ru',
  fallbackModel: 'v4_ru',
};

interface KitchenVoiceSettingsState extends KitchenVoiceSettings {
  patch: (next: Partial<KitchenVoiceSettings>) => void;
}

export const useKitchenVoiceSettings = create<KitchenVoiceSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      patch: (next) => set(next),
    }),
    {
      name: 'edu-pos-kitchen-voice-settings-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ speaker, notificationsEnabled, voiceEnabled, speechRate }) => ({
        speaker,
        notificationsEnabled,
        voiceEnabled,
        speechRate,
      }),
    },
  ),
);

export function getKitchenVoiceSettings(): KitchenVoiceSettings {
  const { speaker, notificationsEnabled, voiceEnabled, speechRate, preferredModel, fallbackModel } =
    useKitchenVoiceSettings.getState();
  return { speaker, notificationsEnabled, voiceEnabled, speechRate, preferredModel, fallbackModel };
}

export interface KitchenVoiceScenario {
  id: string;
  text: string;
}

/** Тестовые сценарии озвучки — как в PWA kitchenVoiceScenarios.json (в мобильном без предзаписей, всегда TTS). */
export const KITCHEN_VOICE_TEST_SCENARIOS: KitchenVoiceScenario[] = [
  { id: 's1', text: 'Тест озвучки кухни. Новый заказ номер четыре. Стол шесть, терраса. Один вок с курицей и удоном.' },
  { id: 's2', text: 'Новый заказ номер двенадцать. Стол три. Два лагмана. Один салат греческий. Комментарий: без лука.' },
  { id: 's3', text: 'Новый заказ номер двадцать восемь. Стол девять, зал. Один шашлык, пол килограмма. Один картофель фри. Два соуса.' },
  { id: 's4', text: 'Добавление к заказу номер семь. Стол два. Добавили: один чай зелёный, один чизкейк, один литр морса.' },
  { id: 's5', text: 'Новый заказ номер сорок один. Стол пять, терраса. Три бургера. Первый без помидора. Второй острый. Третий с собой.' },
];
