import React from 'react';
import { AccessibilityInfo, Animated, Easing, type ViewStyle, type StyleProp } from 'react-native';

/** Native-driver transitions; respect the system's reduced-motion preference. */
export function ScreenTransition({ children, style, transitionKey }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  transitionKey?: string;
}) {
  const progress = React.useRef(new Animated.Value(1)).current;
  const reducedMotion = React.useRef(false);
  React.useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) reducedMotion.current = value; });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { reducedMotion.current = value; });
    return () => { mounted = false; subscription.remove(); };
  }, []);
  React.useEffect(() => {
    progress.setValue(reducedMotion.current ? 1 : 0);
    const animation = Animated.timing(progress, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [progress, transitionKey]);
  return <Animated.View style={[style, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>{children}</Animated.View>;
}
