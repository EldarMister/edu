import React from 'react';
import { Pressable, type PressableProps } from 'react-native';

/**
 * Pressable without Android ripple/touch delay. Use for all app chrome,
 * popup rows, list actions and controls where the PWA has immediate taps.
 */
export function FastPressable({ android_ripple, unstable_pressDelay, ...props }: PressableProps) {
  return (
    <Pressable
      android_ripple={android_ripple ?? { color: 'transparent' }}
      unstable_pressDelay={unstable_pressDelay ?? 0}
      {...props}
    />
  );
}
