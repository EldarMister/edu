import React from 'react';
import { Pressable, type PressableProps, type View } from 'react-native';

/**
 * Pressable without Android ripple/touch delay. Use for all app chrome,
 * popup rows, list actions and controls where the PWA has immediate taps.
 */
export const FastPressable = React.forwardRef<View, PressableProps>(function FastPressable(
  { android_ripple, unstable_pressDelay, ...props },
  ref,
) {
  return (
    <Pressable
      ref={ref}
      android_ripple={android_ripple ?? { color: 'transparent' }}
      unstable_pressDelay={unstable_pressDelay ?? 0}
      {...props}
    />
  );
});
