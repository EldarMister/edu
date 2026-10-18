import { Easing } from 'react-native-reanimated';

export const sheetTiming = {
  enterMs: 240,
  exitMs: 220,
  easing: Easing.bezier(0.4, 0, 0.2, 1),
} as const;

/** Custom waiter weight picker transition from the PWA. */
export const weightSheetTiming = {
  enterMs: 420,
  exitMs: 420,
  easing: Easing.bezier(0.22, 1, 0.36, 1),
} as const;

/** Each custom PWA sheet has its own duration; translate by the panel height. */
export const sheetPresets = {
  default: { enterMs: 0, exitMs: 0, easing: sheetTiming.easing },
  weight: weightSheetTiming,
  cart: { enterMs: 440, exitMs: 440, easing: sheetTiming.easing },
  variant: { enterMs: 520, exitMs: 520, easing: sheetTiming.easing },
  set: { enterMs: 440, exitMs: 440, easing: sheetTiming.easing },
  receipt: { enterMs: 380, exitMs: 380, easing: Easing.bezier(0.16, 1, 0.3, 1) },
  split: { enterMs: 300, exitMs: 300, easing: sheetTiming.easing },
} as const;

export type SheetAnimationPreset = keyof typeof sheetPresets;

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
