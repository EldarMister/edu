import React from 'react';
import { Pressable, type View } from 'react-native';
import { useT } from '@/lib/i18n';
import { useHandTarget, type HandPressableProps } from '@/features/hand-control/targets';
import { PanelCloseContext } from './bottom-panel/context';

/**
 * Pressable without Android ripple/touch delay. Use for all app chrome,
 * popup rows, list actions and controls where the PWA has immediate taps.
 */
export const FastPressable = React.forwardRef<View, HandPressableProps>(function FastPressable(
  { android_ripple, unstable_pressDelay, accessibilityLabel, accessibilityHint, handTargetKey, handExclude, ...props },
  ref,
) {
  const t = useT();
  const panel = React.useContext(PanelCloseContext);
  const closeAction = props.onPress && panel?.closeActions?.includes(props.onPress as () => void);
  const onPress = panel && (props.onPress === panel.onClose || closeAction) ? panel.close : props.onPress;
  const targetRef = useHandTarget({ ...props, onPress, accessibilityLabel, handTargetKey, handExclude }, ref);
  return (
    <Pressable
      ref={targetRef}
      android_ripple={android_ripple ?? { color: 'transparent' }}
      unstable_pressDelay={unstable_pressDelay ?? 0}
      {...props}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ? t(accessibilityLabel) : undefined}
      accessibilityHint={accessibilityHint ? t(accessibilityHint) : undefined}
    />
  );
});
