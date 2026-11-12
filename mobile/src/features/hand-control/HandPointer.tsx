import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useStore, type StoreApi } from 'zustand';
import { colors } from '@/theme';
import { HandPointerContext, type HandPointerState } from './context';

/** Also mounted inside native Modal windows, where the board overlay cannot draw. */
export function HandPointer() {
  const store = React.useContext(HandPointerContext);
  return store ? <HandPointerOverlay store={store} /> : null;
}

function HandPointerOverlay({ store }: { store: StoreApi<HandPointerState> }) {
  const root = React.useRef<View>(null);
  const [origin, setOrigin] = React.useState({ x: 0, y: 0 });
  const { cursor, highlight } = useStore(store);
  return <View ref={root} pointerEvents="none" collapsable={false} style={styles.overlay} onLayout={() => {
    root.current?.measureInWindow((x, y) => setOrigin({ x, y }));
  }}>
    {highlight && <View style={[styles.highlight, { left: highlight.bounds.x - origin.x, top: highlight.bounds.y - origin.y, width: highlight.bounds.width, height: highlight.bounds.height }]} />}
    {cursor && <View style={[styles.cursor, cursor.locked && styles.pinching, { transform: [
      { translateX: cursor.x - origin.x - 15 },
      { translateY: cursor.y - origin.y - 15 },
      { scale: cursor.locked ? 0.8 : 1 },
    ] }]} />}
  </View>;
}
const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 10000 },
  cursor: { position: 'absolute', left: 0, top: 0, width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.primary, backgroundColor: 'rgba(0,91,255,0.15)' },
  pinching: { backgroundColor: 'rgba(0,91,255,0.55)' },
  highlight: { position: 'absolute', borderRadius: 8, borderWidth: 2, borderColor: colors.primary },
});
