import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, type View as NativeView } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { View } from '@/components/themed';
import { colors } from '@/theme';
import { useThemeColor } from '@/theme/runtime';

type Bounds = { x: number; y: number; width: number; height: number };
type Fragment = { x: number; y: number; size: number; dx: number; dy: number; turn: number; color: string };
type Burst = { id: number; fragments: Fragment[] };

export function useDeletionParticles() {
  const reduceMotion = useReducedMotion();
  const layer = useRef<NativeView>(null);
  const targets = useRef(new Map<string, NativeView>());
  const sequence = useRef(0);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const themeColor = useThemeColor();

  const register = useCallback((id: string, view: NativeView | null) => {
    if (view) targets.current.set(id, view);
    else targets.current.delete(id);
  }, []);

  const complete = useCallback((id: number) => setBursts((current) => current.filter((burst) => burst.id !== id)), []);
  function capture(id: string) {
    const target = targets.current.get(id);
    const origin = layer.current;
    if (reduceMotion || !target || !origin) return undefined;
    let bounds: Bounds | undefined;
    origin.measureInWindow((left, top, width, height) => {
      target.measureInWindow((x, y, targetWidth, targetHeight) => {
        const clippedX = Math.max(0, x - left);
        const clippedY = Math.max(0, y - top);
        const clippedWidth = Math.min(width, x - left + targetWidth) - clippedX;
        const clippedHeight = Math.min(height, y - top + targetHeight) - clippedY;
        if (clippedWidth > 0 && clippedHeight > 0) {
          bounds = { x: clippedX, y: clippedY, width: clippedWidth, height: clippedHeight };
        }
      });
    });
    return () => {
      if (!bounds || layer.current !== origin) return;
      const { x, y, width, height } = bounds;
      const palette = [colors.textLight, colors.textMuted, colors.border, colors.textSecondary].map((color) => themeColor(color));
      const count = Math.min(34, Math.max(14, Math.round(width / 10)));
      const fragments = Array.from({ length: count }, (_, index) => ({
        x: x + width * (index + Math.random()) / count,
        y: y + height * (0.2 + Math.random() * 0.6),
        size: 2 + Math.random() * 4,
        dx: 16 + Math.random() * 44,
        dy: -12 - Math.random() * 30,
        turn: Math.random() * 270 - 135,
        color: palette[index % palette.length],
      }));
      const burst = { id: sequence.current++, fragments };
      setBursts((current) => [...current.slice(-2), burst]);
    };
  }

  const overlay = <View ref={layer} collapsable={false} pointerEvents="none" style={styles.layer} accessible={false}
    importantForAccessibility="no-hide-descendants">
    {bursts.map((burst) => <ParticleBurst key={burst.id} burst={burst} onComplete={complete} />)}
  </View>;
  return { register, capture, overlay };
}

function ParticleBurst({ burst, onComplete }: { burst: Burst; onComplete: (id: number) => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(progress, { toValue: 1, duration: 490,
      easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false });
    animation.start(({ finished }) => { if (finished) onComplete(burst.id); });
    return () => animation.stop();
  }, [burst.id, onComplete, progress]);

  const opacity = progress.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0.25, 0.9, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.15] });
  return <>{burst.fragments.map((fragment, index) => <Animated.View key={index} style={{
    position: 'absolute', left: fragment.x, top: fragment.y, width: fragment.size, height: fragment.size,
    borderRadius: 1.2, backgroundColor: fragment.color, opacity,
    transform: [
      { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, fragment.dx] }) },
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, fragment.dy] }) },
      { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', fragment.turn + 'deg'] }) },
      { scale },
    ],
  }} />)}</>;
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, overflow: 'hidden', zIndex: 20 },
});
