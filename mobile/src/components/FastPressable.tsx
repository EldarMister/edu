import React from 'react';
import { Pressable, type PressableProps, type View } from 'react-native';
import { useT } from '@/lib/i18n';

/**
 * Pressable without Android ripple/touch delay. Use for all app chrome,
 * popup rows, list actions and controls where the PWA has immediate taps.
 */
export const FastPressable = React.forwardRef<View, PressableProps>(function FastPressable(
  { android_ripple, unstable_pressDelay, accessibilityLabel, accessibilityHint, ...props },
  ref,
) {
  const t = useT();
  return (
    <Pressable
      ref={ref}
      android_ripple={android_ripple ?? { color: 'transparent' }}
      unstable_pressDelay={unstable_pressDelay ?? 0}
      {...props}
      accessibilityLabel={accessibilityLabel ? t(accessibilityLabel) : undefined}
      accessibilityHint={accessibilityHint ? t(accessibilityHint) : undefined}
    />
  );
});
