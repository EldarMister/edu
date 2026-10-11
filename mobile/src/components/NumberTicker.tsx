import React from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type TextStyle } from 'react-native';
import { Text } from '@/components/typography';
import { useReducedMotion } from 'react-native-reanimated';
import { money } from '@/utils/format';

export function NumberTicker({
  value,
  format = money,
  style,
  digitHeight,
}: {
  value: number;
  format?: (value: number) => string;
  style?: TextStyle;
  digitHeight?: number;
}) {
  const text = format(value);
  // The PWA's mask and every slot are exactly 1em high.
  const size = style?.fontSize ?? 15;
  const height = style?.fontSize ?? digitHeight ?? size;
  const textStyle: TextStyle = { ...style, fontSize: size, lineHeight: height, fontVariant: ['tabular-nums'] };
  return (
    <View
      style={styles.wrap}
      // Android order cards include labels from non-focusable children in their own announcement.
      accessible={Platform.OS !== 'android'}
      accessibilityRole="text"
      accessibilityLabel={text}
      importantForAccessibility="yes"
    >
      <View style={styles.wrap} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {text.split('').map((ch, index) =>
          /\d/.test(ch) ? (
            <Digit key={`digit-${index}`} digit={Number(ch)} height={height} textStyle={textStyle} />
          ) : (
            <Text key={`char-${index}`} style={textStyle}>
              {ch}
            </Text>
          ),
        )}
      </View>
    </View>
  );
}

function Digit({ digit, height, textStyle }: { digit: number; height: number; textStyle?: TextStyle }) {
  const reduceMotion = useReducedMotion();
  const offset = React.useRef(new Animated.Value(digit)).current;

  React.useEffect(() => {
    const animation = Animated.timing(offset, {
      toValue: digit,
      duration: reduceMotion ? 0 : 600,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [digit, offset, reduceMotion]);

  const translateY = offset.interpolate({
    inputRange: Array.from({ length: 10 }, (_, n) => n),
    outputRange: Array.from({ length: 10 }, (_, n) => -n * height),
  });

  return (
    <View style={[styles.digitMask, { height }]}>
      <Animated.View style={{ transform: [{ translateY }] }}>
        {Array.from({ length: 10 }, (_, n) => (
          <Text key={n} style={[textStyle, { height, lineHeight: height, textAlign: 'center' }]}>
            {n}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  digitMask: {
    overflow: 'hidden',
  },
});
