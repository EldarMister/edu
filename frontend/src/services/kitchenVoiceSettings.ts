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

const STORAGE_KEY = 'edu-pos-kitchen-voice-settings-v1';

const DEFAULT_SETTINGS: KitchenVoiceSettings = {
  speaker: 'baya',
  notificationsEnabled: true,
  voiceEnabled: true,
  speechRate: 1,
  preferredModel: 'v5_2_ru',
  fallbackModel: 'v4_ru',
};

const listeners = new Set<(settings: KitchenVoiceSettings) => void>();

function isSpeaker(value: unknown): value is KitchenSpeaker {
  return KITCHEN_SPEAKERS.some((speaker) => speaker.value === value);
}

function isSpeechRate(value: unknown): value is KitchenSpeechRate {
  return KITCHEN_SPEECH_RATES.includes(Number(value) as KitchenSpeechRate);
}

function readStored(): Partial<KitchenVoiceSettings> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<KitchenVoiceSettings>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalize(value: Partial<KitchenVoiceSettings>): KitchenVoiceSettings {
  return {
    speaker: isSpeaker(value.speaker) ? value.speaker : DEFAULT_SETTINGS.speaker,
    notificationsEnabled:
      typeof value.notificationsEnabled === 'boolean'
        ? value.notificationsEnabled
        : DEFAULT_SETTINGS.notificationsEnabled,
    voiceEnabled:
      typeof value.voiceEnabled === 'boolean' ? value.voiceEnabled : DEFAULT_SETTINGS.voiceEnabled,
    speechRate: isSpeechRate(value.speechRate) ? (Number(value.speechRate) as KitchenSpeechRate) : 1,
    preferredModel: 'v5_2_ru',
    fallbackModel: 'v4_ru',
  };
}

export function getKitchenVoiceSettings(): KitchenVoiceSettings {
  return normalize(readStored());
}

export function saveKitchenVoiceSettings(patch: Partial<KitchenVoiceSettings>) {
  const next = normalize({ ...getKitchenVoiceSettings(), ...patch });
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  listeners.forEach((listener) => listener(next));
  return next;
}

export function subscribeKitchenVoiceSettings(listener: (settings: KitchenVoiceSettings) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
