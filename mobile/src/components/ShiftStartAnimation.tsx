import React from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { colors } from '@/theme';

export type ShiftAnimState = 'idle' | 'loading' | 'success';

const GLOW = 280; // размер зоны анимации, как в PWA ShiftRequiredScreen.
const LOGO_CIRCLE = 172;
const LOGO_W = 86;
const LOGO_H = 54;
const RING = 188; // диаметр кругового индикатора загрузки
const STROKE = 4;
const R = (RING - STROKE) / 2;
const C = 2 * Math.PI * R;
const SUCCESS = 96; // диаметр синего круга успеха

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Фирменный знак EP (E тёмно-синий, P ярко-синий) — assets/ep-mark.png.
const EP_MARK = require('../../assets/ep-mark.png');

/**
 * Центральная анимация старта смены (строго по референсу designe/Смена не начата):
 * idle — логотип EP на мягком голубом свечении с тонкими полупрозрачными кольцами;
 * loading — круговой индикатор заполняется по часовой стрелке;
 * success — белая галочка в синем круге.
 */
export function ShiftStartAnimation({ state }: { state: ShiftAnimState }) {
  const enter = React.useRef(new Animated.Value(0)).current;
  const breathe = React.useRef(new Animated.Value(0)).current;
  const waveOne = React.useRef(new Animated.Value(0)).current;
  const waveTwo = React.useRef(new Animated.Value(0)).current;
  const progress = React.useRef(new Animated.Value(0)).current;
  const ringOpacity = React.useRef(new Animated.Value(0)).current;
  const logoOpacity = React.useRef(new Animated.Value(1)).current;
  const success = React.useRef(new Animated.Value(0)).current;

  // Появление логотипа + мягкое «дыхание» свечения.
  React.useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    const startWave = (value: Animated.Value) => {
      value.setValue(0);
      const loop = Animated.loop(
        Animated.timing(value, {
          toValue: 1,
          duration: 3200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      );
      loop.start();
      return loop;
    };
    glowLoop.start();
    const firstWave = startWave(waveOne);
    let secondWave: Animated.CompositeAnimation | undefined;
    const secondTimer = setTimeout(() => {
      secondWave = startWave(waveTwo);
    }, 1600);
    return () => {
      clearTimeout(secondTimer);
      glowLoop.stop();
      firstWave.stop();
      secondWave?.stop();
    };
  }, [enter, breathe, waveOne, waveTwo]);

  React.useEffect(() => {
    if (state === 'loading') {
      progress.setValue(0);
      logoOpacity.setValue(1);
      success.setValue(0);
      Animated.timing(ringOpacity, { toValue: 1, duration: 240, useNativeDriver: true }).start();
      Animated.timing(progress, {
        toValue: 1,
        duration: 980,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    } else if (state === 'success') {
      Animated.parallel([
        Animated.timing(ringOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(logoOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.spring(success, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true }),
      ]).start();
    } else {
      progress.setValue(0);
      ringOpacity.setValue(0);
      logoOpacity.setValue(1);
      success.setValue(0);
    }
  }, [state, ringOpacity, progress, logoOpacity, success]);

  const enterScale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  const glowScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.08] });
  const glowOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] });
  const waveScale = (value: Animated.Value) => value.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.18] });
  const waveOpacity = (value: Animated.Value) =>
    value.interpolate({ inputRange: [0, 0.22, 0.7, 1], outputRange: [0, 0.55, 0.18, 0] });
  const dashOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [C, 0] });
  const successScale = success.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  return (
    <View style={styles.wrap}>
      {/* Мягкое голубое свечение + тонкие полупрозрачные кольца (скрыто при успехе) */}
      {state !== 'success' ? (
        <>
          {[waveOne, waveTwo].map((wave, index) => (
            <Animated.View
              key={index}
              pointerEvents="none"
              style={[styles.wave, { opacity: waveOpacity(wave), transform: [{ scale: waveScale(wave) }] }]}
            >
              <Svg width={GLOW} height={GLOW}>
                <Defs>
                  <RadialGradient id={`shiftWave${index}`} cx="50%" cy="50%" r="50%">
                    <Stop offset="0.62" stopColor="#005BFF" stopOpacity={0} />
                    <Stop offset="0.8" stopColor="#005BFF" stopOpacity={0.14} />
                    <Stop offset="0.93" stopColor="#005BFF" stopOpacity={0.05} />
                    <Stop offset="1" stopColor="#005BFF" stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle cx={GLOW / 2} cy={GLOW / 2} r={GLOW / 2} fill={`url(#shiftWave${index})`} />
              </Svg>
            </Animated.View>
          ))}
          <Animated.View
            style={[styles.glow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]}
            pointerEvents="none"
          >
            <Svg width={GLOW} height={GLOW}>
            <Defs>
              <RadialGradient id="shiftGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#005BFF" stopOpacity={0.18} />
                <Stop offset="0.58" stopColor="#005BFF" stopOpacity={0.08} />
                <Stop offset="1" stopColor="#005BFF" stopOpacity={0} />
              </RadialGradient>
            </Defs>
              <Circle cx={GLOW / 2} cy={GLOW / 2} r={GLOW * 0.36} fill="url(#shiftGlow)" />
            </Svg>
          </Animated.View>
        </>
      ) : null}

      {/* Круговой индикатор загрузки (старт сверху, по часовой стрелке) */}
      <Animated.View style={[styles.ring, { opacity: ringOpacity }]}>
        <Svg width={RING} height={RING}>
          <Circle cx={RING / 2} cy={RING / 2} r={R} stroke={colors.primarySoft} strokeWidth={STROKE} fill="none" />
          <AnimatedCircle
            cx={RING / 2}
            cy={RING / 2}
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

      {/* Полупрозрачный круг с логотипом EP — как в PWA. */}
      <Animated.View style={[styles.logo, { opacity: logoOpacity, transform: [{ scale: enterScale }] }]}>
        <Image source={EP_MARK} style={styles.mark} resizeMode="contain" />
      </Animated.View>

      {/* Успех: белая галочка в синем круге */}
      <Animated.View
        style={[styles.success, { opacity: success, transform: [{ scale: successScale }] }]}
        pointerEvents="none"
      >
        <Svg width={34} height={34} viewBox="0 0 24 24" fill="none">
          <Path
            d="M6 12.5 L10 16.5 L18 8"
            stroke={colors.white}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: GLOW, height: GLOW, alignItems: 'center', justifyContent: 'center' },
  wave: { position: 'absolute', width: GLOW, height: GLOW },
  glow: { position: 'absolute', width: GLOW, height: GLOW },
  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
    // -90°, чтобы заполнение начиналось сверху и шло по часовой стрелке.
    transform: [{ rotate: '-90deg' }],
  },
  logo: {
    width: LOGO_CIRCLE,
    height: LOGO_CIRCLE,
    borderRadius: LOGO_CIRCLE / 2,
    backgroundColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: { width: LOGO_W, height: LOGO_H },
  success: {
    position: 'absolute',
    width: SUCCESS,
    height: SUCCESS,
    borderRadius: SUCCESS / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
