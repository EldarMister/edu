import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { KitchenVoiceSettings } from './kitchenVoiceSettings';
import { useAuth } from '@/store/auth';

type VoicePreference = Pick<KitchenVoiceSettings, 'speaker' | 'speechRate' | 'notificationsEnabled' | 'voiceEnabled'>;

export const defaultWaiterVoice: VoicePreference = {
  speaker: 'baya', speechRate: 1, notificationsEnabled: true, voiceEnabled: true,
};

export const useWaiterVoiceSettings = create<{
  byUser: Record<string, Partial<VoicePreference>>;
  patch: (userId: string, next: Partial<VoicePreference>) => void;
}>()(
  persist(
    (set) => ({
      byUser: {},
      patch: (userId, next) => set(({ byUser }) => ({
        byUser: { ...byUser, [userId]: { ...byUser[userId], ...next } },
      })),
    }),
    {
      name: 'edu-pos-waiter-voice-settings-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ byUser }) => ({ byUser }),
    },
  ),
);

export function waiterNotificationSoundEnabled() {
  const user = useAuth.getState().user;
  return user?.role !== 'WAITER' || useWaiterVoiceSettings.getState().byUser[user.id]?.notificationsEnabled !== false;
}
