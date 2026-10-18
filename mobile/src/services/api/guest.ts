import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';

let guestKey: Promise<string> | undefined;
/** One identity across visits, restarts and shared-table sessions. */
export function getGuestKey(): Promise<string> {
  return guestKey ??= (async () => {
    const saved = await AsyncStorage.getItem('edu_qr_guest_key').catch(() => null);
    if (saved) return saved;
    const key = Crypto.randomUUID();
    await AsyncStorage.setItem('edu_qr_guest_key', key).catch(() => undefined);
    return key;
  })();
}

export async function getGuestPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const cached = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 100 });
    const position = cached ?? await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 10_000)),
    ]);
    if (!position) return null;
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return null;
  }
}
