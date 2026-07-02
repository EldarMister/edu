import { Easing } from 'react-native-reanimated';

export const sheetTiming = {
  enterMs: 240,
  exitMs: 220,
  easing: Easing.bezier(0.4, 0, 0.2, 1),
} as const;

export const popTiming = {
  enterMs: 160,
  exitMs: 120,
  easing: Easing.bezier(0.16, 1, 0.3, 1),
} as const;

export const cardPopTiming = {
  enterMs: 280,
  checkMs: 450,
  easing: Easing.bezier(0.16, 1, 0.3, 1),
} as const;
