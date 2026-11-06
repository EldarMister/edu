import React from 'react';
import { BottomPanel, type BottomPanelProps } from './BottomPanel';
import type { SheetAnimationPreset } from './motion';
export { PanelScrollView as SheetScrollView, PanelFlatList as SheetFlatList } from './BottomPanel';
/** All existing sheets share the same lifecycle and motion engine. */
export function BottomSheet({ animationPreset: _preset, ...props }: BottomPanelProps & { animationPreset?: SheetAnimationPreset }) {
  return <BottomPanel {...props} />;
}
