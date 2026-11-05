import React from 'react';
import type { TargetHit } from './targets';
import type { Point } from './gesture';
export type HandStatus = 'off' | 'loading' | 'searching' | 'found' | 'paused' | 'error';
export const HandControlContext = React.createContext<{
  enabled: boolean; status: HandStatus; error: string; toggle: () => void;
  cursor: (Point & { locked: boolean }) | null; highlight: TargetHit | null;
} | null>(null);
