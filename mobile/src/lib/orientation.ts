import { Dimensions } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
export function restoreAppOrientation() {
  const { width, height } = Dimensions.get('screen');
  return Math.min(width, height) >= 600
    ? ScreenOrientation.unlockAsync()
    : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
}
