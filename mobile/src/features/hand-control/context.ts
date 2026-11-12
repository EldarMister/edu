import React from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { TargetHit } from './targets';
import type { Point } from './gesture';
export type HandStatus = 'off' | 'loading' | 'searching' | 'found' | 'paused' | 'error';
export const HandControlContext = React.createContext<{
  enabled: boolean; status: HandStatus; error: string; toggle: () => void;
} | null>(null);

export type HandPointerState = {
  cursor: (Point & { locked: boolean }) | null;
  highlight: TargetHit | null;
};
export const HandPointerContext = React.createContext<StoreApi<HandPointerState> | null>(null);
