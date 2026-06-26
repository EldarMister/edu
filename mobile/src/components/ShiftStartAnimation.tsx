import React from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '@/theme';

export type ShiftAnimState = 'idle' | 'loading' | 'success';

const SIZE = 132; // общий диаметр зоны анимации
const TILE = 84; // плитка с логотипом / круг успеха
const STROKE = 4; // толщина кольца прогресса
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Фирменный знак EP (из frontend/public/edupos.png, фон убран в прозрачность).
const EP_MARK = require('../../assets/ep-mark.png');

/**
 * Центральная анимация старта смены (строго по референсу /designe):
 * idle — логотип EP + мягкая пульсация кольца;
 * loading — круговой индикатор заполняется по часовой стрелке;
 * success — белая галочка в синем круге.
 */
export function ShiftStartAnimation({ state }: { state: ShiftAnimState }) {
  const enter = React.useRef(new Animated.Value(0)).current;
  const pulse = React.useRef(new Animated.Value(0)).current;
  const progress = React.useRef(new Animated.Value(0)).current;
  const ringOpacity = React.useRef(new Animated.Value(0)).current;
  const logoOpacity = React.useRef(new Animated.Value(1)).current;
  const success = React.useRef(new Animated.Value(0)).current;

  // Появление логотипа с лёгким масштабированием + мягкая пульсация кольца.
  React.useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1800,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [enter, pulse]);

  React.useEffect(() => {
    if (state === 'loading') {
      Animated.timing(ringOpacity, {
        toValue: 1,
        duration: 240,
        useNativeDriver: true,
      }).start();
      // Прогресс заполняется по часовой стрелке.
      Animated.timing(progress, {
        toValue: 0.92,
        duration: 1100,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    } else if (state === 'success') {
      Animated.parallel([
        Animated.timing(ringOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(logoOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.spring(success, {
          toValue: 1,
          friction: 6,
          tension: 120,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [state, ringOpacity, progress, logoOpacity, success]);

  const enterScale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.16] });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 0.15, 1],
    outputRange: [0, 0.45, 0],
  });
  const dashOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [C, 0] });
  const successScale = success.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  return (
    <View style={styles.wrap}>
      {/* Мягкое статичное свечение */}
      <View style={styles.halo} />

      {/* Аккуратная пульсация кольца (скрыта в состоянии успеха) */}
      {state !== 'success' ? (
        <Animated.View
          style={[styles.pulseRing, { opacity: pulseOpacity, transform: [{ scale: pulseScale }] }]}
        />
      ) : null}

      <Animated.View style={[styles.stack, { transform: [{ scale: enterScale }] }]}>
        {/* Круговой индикатор загрузки */}
        <Animated.View style={[styles.ring, { opacity: ringOpacity }]}>
          <Svg width={SIZE} height={SIZE}>
            <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={colors.primarySoft} strokeWidth={STROKE} fill="none" />
            <AnimatedCircle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              stroke={colors.primary}
              strokeWidth={STROKE}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={C}
              strokeDashoffset={dashOffset}
            />
          </Svg>
        </Animated.View>

        {/* Плитка с логотипом EP */}
        <Animated.View style={[styles.tile, { opacity: logoOpacity }]}>
          <Image source={EP_MARK} style={styles.mark} resizeMode="contain" />
        </Animated.View>

        {/* Успех: галочка в синем круге */}
        <Animated.View
          style={[styles.success, { opacity: success, transform: [{ scale: successScale }] }]}
          pointerEvents="none"
        >
          <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
            <Path
              d="M6 12.5 L10 16.5 L18 8"
              stroke={colors.white}
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  stack: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: colors.primaryFaint,
  },
  pulseRing: {
    position: 'absolute',
    width: SIZE * 0.92,
    height: SIZE * 0.92,
    borderRadius: SIZE,
    borderWidth: 2,
    borderColor: colors.primarySoft,
  },
  // Поворот на -90°, чтобы заполнение начиналось сверху и шло по часовой стрелке.
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SIZE,
    height: SIZE,
    transform: [{ rotate: '-90deg' }],
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 22,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  mark: { width: 54, height: 35 },
  success: {
    position: 'absolute',
    top: (SIZE - TILE) / 2,
    left: (SIZE - TILE) / 2,
    width: TILE,
    height: TILE,
    borderRadius: TILE / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
