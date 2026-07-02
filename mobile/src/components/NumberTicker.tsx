import React from 'react';
import { Animated, Easing, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { money } from '@/utils/format';

export function NumberTicker({
  value,
  format = money,
  style,
  digitHeight = 20,
}: {
  value: number;
  format?: (value: number) => string;
  style?: TextStyle;
  digitHeight?: number;
}) {
  const text = format(value);
  return (
    <View style={styles.wrap}>
      {text.split('').map((ch, index) =>
        /\d/.test(ch) ? (
          <Digit key={`digit-${index}`} digit={Number(ch)} height={digitHeight} textStyle={style} />
        ) : (
          <Text key={`char-${index}`} style={style}>
            {ch}
          </Text>
        ),
      )}
    </View>
  );
}

function Digit({ digit, height, textStyle }: { digit: number; height: number; textStyle?: TextStyle }) {
  const offset = React.useRef(new Animated.Value(digit)).current;

  React.useEffect(() => {
    Animated.timing(offset, {
      toValue: digit,
      duration: 600,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [digit, offset]);

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
