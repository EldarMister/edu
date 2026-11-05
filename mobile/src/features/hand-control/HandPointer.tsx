import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme';
import { HandControlContext } from './context';

/** Also mounted inside native Modal windows, where the board overlay cannot draw. */
export function HandPointer() {
  const control = React.useContext(HandControlContext);
  const root = React.useRef<View>(null);
  const [origin, setOrigin] = React.useState({ x: 0, y: 0 });
  if (!control) return null;
  const { cursor, highlight } = control;
  return <View ref={root} pointerEvents="none" collapsable={false} style={styles.overlay} onLayout={() => {
    root.current?.measureInWindow((x, y) => setOrigin({ x, y }));
  }}>
    {highlight && <View style={[styles.highlight, { left: highlight.bounds.x - origin.x, top: highlight.bounds.y - origin.y, width: highlight.bounds.width, height: highlight.bounds.height }]} />}
    {cursor && <View style={[styles.cursor, { left: cursor.x - origin.x - 15, top: cursor.y - origin.y - 15 }, cursor.locked && styles.pinching]} />}
  </View>;
}
const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 10000 },
  cursor: { position: 'absolute', width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.primary, backgroundColor: 'rgba(0,91,255,0.15)' },
  pinching: { backgroundColor: 'rgba(0,91,255,0.55)', transform: [{ scale: 0.8 }] },
  highlight: { position: 'absolute', borderRadius: 8, borderWidth: 2, borderColor: colors.primary },
});
