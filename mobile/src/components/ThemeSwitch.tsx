/*
 * Adapted from https://uiverse.io/JustCode14/red-dingo-61
 * MIT License, Copyright (c) 2026 JustCode14
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import React, { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Text } from './typography';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/store/theme';
import { colors } from '@/theme';

const stars = [
  { left: 42.5, top: 8.5 },
  { left: 37.4, top: 20.4 },
  { left: 51, top: 15.3 },
];

export function ThemeSwitch() {
  const title = useT()('Тема');
  const dark = useTheme((state) => state.theme) === 'dark';
  const setTheme = useTheme((state) => state.setTheme);
  const reduceMotion = useReducedMotion();
  const [light] = useState(() => new Animated.Value(dark ? 0 : 1));

  useEffect(() => {
    if (reduceMotion) {
      light.setValue(dark ? 0 : 1);
      return;
    }
    const animation = Animated.timing(light, {
      toValue: dark ? 0 : 1, duration: 400, easing: Easing.ease, useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [dark, light, reduceMotion]);

  const night = light.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const translateX = light.interpolate({
    inputRange: [0, 1], outputRange: [0, 30.6], easing: Easing.bezier(0.81, -0.04, 0.38, 1.5),
  });
  const skyColor = light.interpolate({ inputRange: [0, 1], outputRange: ['#2a2a2a', '#00a6ff'] });

  return <View style={styles.row}>
    <Text style={styles.title}>{title}</Text>
    <Pressable accessibilityRole="switch" accessibilityLabel={title} accessibilityState={{ checked: dark }}
      onPress={() => setTheme(dark ? 'light' : 'dark')} style={styles.control}>
      <Animated.View pointerEvents="none" style={[styles.sky, { backgroundColor: skyColor }]}>
        {stars.map((star) => <Animated.View key={star.left} style={[styles.star, star, { opacity: night }]} />)}
        <Animated.View style={[styles.orb, { transform: [{ translateX }] }]}>
          <Animated.View style={{ opacity: night }}>
            <Svg width={20.4} height={20.4} viewBox="0 0 20.4 20.4">
              <Path fill="#fff" d="M10.1 0 A10.2 10.2 0 1 0 18.3 16.4 A10.2 10.2 0 0 1 10.1 0 Z" />
            </Svg>
          </Animated.View>
          <Animated.View style={[styles.sun, { opacity: light }]} />
        </Animated.View>
        <Animated.View style={[styles.cloud, { opacity: light }]}>
          <Svg width={59.5} height={59.5} viewBox="0 0 16 16">
            <Path transform="matrix(.77976 0 0 .78395 -299.99 -418.63)" fill="#fff"
              d="m391.84 540.91c-.421-.329-.949-.524-1.523-.524-1.351 0-2.451 1.084-2.485 2.435-1.395.526-2.388 1.88-2.388 3.466 0 1.874 1.385 3.423 3.182 3.667v.034h12.73v-.006c1.775-.104 3.182-1.584 3.182-3.395 0-1.747-1.309-3.186-2.994-3.379.007-.106.011-.214.011-.322 0-2.707-2.271-4.901-5.072-4.901-2.073 0-3.856 1.202-4.643 2.925" />
          </Svg>
        </Animated.View>
      </Animated.View>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '500' },
  control: { width: 52, height: 44, alignItems: 'center', justifyContent: 'center' },
  sky: { width: 68, height: 37.4, borderRadius: 30, overflow: 'hidden', transform: [{ scale: 0.75 }] },
  star: { position: 'absolute', width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#fff' },
  orb: { position: 'absolute', left: 8.5, bottom: 8.5, width: 20.4, height: 20.4 },
  sun: { ...StyleSheet.absoluteFillObject, borderRadius: 10.2, backgroundColor: '#ffcf48' },
  cloud: { position: 'absolute', left: -18.7, bottom: -23.8 },
});
