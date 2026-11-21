import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { View } from '@/components/themed';
import { colors, radius, spacing } from '@/theme';

export function AdminLoadingSkeleton({ layout = 'list' }: { layout?: 'list' | 'form' }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.48, duration: 650, useNativeDriver: true, isInteraction: false }),
      Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true, isInteraction: false }),
    ]));
    animation.start();
    return () => { animation.stop(); opacity.setValue(1); };
  }, [opacity, reduceMotion]);

  return <View accessible accessibilityRole="progressbar" accessibilityLabel="Загрузка" accessibilityState={{ busy: true }}>
    <Animated.View style={{ opacity }} aria-hidden>
      {layout === 'form' ? <View style={styles.form}>
        {[0, 1, 2, 3, 4].map((index) => <View key={index} style={styles.field}>
          <View style={[styles.placeholder, styles.fieldLabel, { width: index % 2 ? 96 : 122 }]} />
          <View style={[styles.placeholder, styles.fieldInput]} />
        </View>)}
      </View> : <View style={styles.list}>
        <View style={styles.toolbar}>
          <View style={[styles.placeholder, styles.search]} />
          <View style={[styles.placeholder, styles.action]} />
        </View>
        {[0, 1, 2, 3, 4].map((index) => <View key={index} style={styles.row}>
          <View style={[styles.placeholder, styles.firstCell, { width: index % 2 ? '42%' : '50%' }]} />
          <View style={[styles.placeholder, styles.secondCell]} />
        </View>)}
      </View>}
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: colors.border, borderRadius: radius.sm },
  form: { padding: spacing.lg, gap: spacing.lg },
  field: { gap: spacing.sm },
  fieldLabel: { height: 12 },
  fieldInput: { height: 42 },
  list: { paddingHorizontal: spacing.md },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.md },
  search: { height: 38, width: '52%', maxWidth: 250 },
  action: { height: 38, width: '30%', maxWidth: 135 },
  row: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  firstCell: { height: 13, maxWidth: 265 },
  secondCell: { height: 13, width: '24%', maxWidth: 150 },
});
