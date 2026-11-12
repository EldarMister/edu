import React from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontSize, spacing } from '@/theme';
import { Text } from './typography';
import { FastPressable } from './FastPressable';
import { PwaIcon } from './PwaIcon';
import { SheetPortal, useSheetPortalViewportHeight } from './SheetPortal';
import { HandPointer } from '@/features/hand-control/HandPointer';
import { HandTargetModal } from '@/features/hand-control/targets';
import { PanelCloseContext, type PanelController } from './bottom-panel/context';
import { PanelMotionContext, PanelScrollView, PanelFlatList } from './bottom-panel/scroll';
import { panelEasing, useBottomPanel, useBottomPanelPan } from './bottom-panel/useBottomPanel';
import { remainingKeyboardOverlap, STEP_DURATION } from './bottom-panel/geometry';

export { PanelScrollView, PanelFlatList } from './bottom-panel/scroll';
export { useBottomPanelClose, useBottomPanelHistory, useBottomPanelController, PanelScreenBoundary } from './bottom-panel/context';
export { useBottomPanel } from './bottom-panel/useBottomPanel';

export type BottomPanelProps = {
  visible: boolean; onClose: () => void; onDismiss?: () => void;
  controller?: PanelController;
  closeActions?: readonly (() => void)[];
  children: React.ReactNode; title?: string; headerContent?: React.ReactNode; footer?: React.ReactNode;
  expanded?: boolean; persistent?: boolean; containerHeight?: number;
  handlePlacement?: 'outside' | 'inside'; hideHeader?: boolean; hideHandle?: boolean; draggable?: boolean; bodyDraggable?: boolean;
  inline?: boolean; contentKey?: string; presentation?: 'bottom' | 'center';
  ownerKey?: string;
  bodyStyle?: ViewStyle; panelStyle?: ViewStyle; footerStyle?: ViewStyle;
  maxHeight?: ViewStyle['maxHeight']; bottomInset?: number; paddingBottomInset?: number;
  /** Compatibility flags; expanded is preferred for new panels. */
  fillBody?: boolean; sheet?: boolean; backdropColor?: string;
};

function containsScroller(node: React.ReactNode): boolean {
  return React.Children.toArray(node).some(child => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return false;
    const type = child.type as { displayName?: string; name?: string };
    return child.type === ScrollView || child.type === PanelScrollView || child.type === PanelFlatList || /ScrollView|FlatList|SectionList|VirtualizedList/.test(type.displayName ?? type.name ?? '') || containsScroller(child.props.children);
  });
}

/** Each completed dismissal releases native modal/gesture state for the next visit. */
export function BottomPanel(props: BottomPanelProps) {
  const [presence, setPresence] = React.useState({ retained: props.visible, generation: 0 });
  React.useLayoutEffect(() => {
    if (props.visible) setPresence(old => old.retained ? old : { ...old, retained: true });
  }, [props.visible]);
  const onDismiss = React.useCallback(() => {
    setPresence(old => ({ retained: false, generation: old.generation + 1 }));
    props.onDismiss?.();
  }, [props.onDismiss]);
  return props.visible || presence.retained
    ? <BottomPanelSession key={presence.generation} {...props} onDismiss={onDismiss} /> : null;
}

function BottomPanelSession({ visible, onClose, onDismiss, inline = false, persistent = false, expanded,
  fillBody = false, draggable = true, handlePlacement = 'inside', containerHeight, controller, ...current }: BottomPanelProps) {
  const id = React.useId();
  const parent = React.useContext(PanelCloseContext);
  const insets = useSafeAreaInsets();
  const dimensions = useWindowDimensions();
  const portalHeight = useSheetPortalViewportHeight();
  const rootRef = React.useRef<View>(null), handPanelRef = React.useRef<View>(null);
  const [container, setContainer] = React.useState({ y: 0, height: dimensions.height });
  const [keyboardY, setKeyboardY] = React.useState<number | null>(null);
  const snapshot = React.useRef(current);
  if (visible) snapshot.current = current;
  const content = visible ? current : snapshot.current;
  const full = expanded ?? fillBody;
  const local = inline || persistent;
  const { rendered, active, interactive, measure, motion } = useBottomPanel({ id, parent: parent?.id, visible,
    persistent, inline: local, draggable: draggable && content.presentation !== 'center', onClose, onDismiss, ownerKey: current.ownerKey });
  const headerPan = useBottomPanelPan(motion);
  const handlePan = useBottomPanelPan(motion);
  const close = React.useCallback(() => motion.close(), [motion.close]);
  React.useLayoutEffect(() => {
    if (!controller) return;
    controller.request.current = close;
    return () => { controller.request.current = null; };
  }, [close, controller?.request]);
  const closeContext = React.useMemo(() => ({ id, onClose, close, closeActions: content.closeActions }), [close, content.closeActions, id, onClose]);
  const measureContainer = React.useCallback(() => {
    const view = rootRef.current;
    view?.measureInWindow((_x, y, _width, height) => {
      if (rootRef.current !== view) return;
      if (height > 0) setContainer(old => old.y === y && old.height === height ? old : { y, height });
    });
  }, []);
  React.useEffect(() => {
    if (!rendered) return;
    setKeyboardY(Keyboard.metrics()?.screenY ?? null);
    const show = Keyboard.addListener('keyboardDidShow', event => { setKeyboardY(event.endCoordinates.screenY); measureContainer(); });
    const hide = Keyboard.addListener('keyboardDidHide', () => { setKeyboardY(null); measureContainer(); });
    return () => { show.remove(); hide.remove(); };
  }, [measureContainer, rendered]);

  const overlap = Platform.OS === 'android' && keyboardY !== null ? remainingKeyboardOverlap(container.y, container.height, keyboardY) : 0;
  const actualHeight = containerHeight ?? (inline && portalHeight > 0 ? portalHeight : container.height);
  const topGap = Math.max(24, insets.top + 24 - container.y);
  const outsideHandle = !content.hideHandle && handlePlacement === 'outside';
  const available = Math.max(1, actualHeight - topGap - (content.bottomInset ?? 0) - overlap);
  const requestedHeight = typeof content.maxHeight === 'number' ? content.maxHeight
    : typeof content.maxHeight === 'string' && content.maxHeight.endsWith('%') ? actualHeight * parseFloat(content.maxHeight) / 100 : available;
  // The map's persistent compact card alone has a 52% cap.
  const maximum = Math.min(available, persistent ? actualHeight * 0.52 : requestedHeight);
  const bottomPadding = Math.max(content.paddingBottomInset ?? insets.bottom, 10);
  const centered = content.presentation === 'center';
  const animation = useAnimatedStyle(() => ({
    opacity: motion.measured.value ? 1 : 0,
    transform: [{ translateY: motion.offset.value }],
  }));
  const backdrop = useAnimatedStyle(() => ({
    opacity: persistent ? 0 : 0.28 * (1 - Math.min(1, Math.max(0, motion.offset.value / motion.travel.value))),
  }));

  const step = useSharedValue(0);
  const lastStep = React.useRef(content.contentKey ?? content.title);
  React.useEffect(() => {
    const key = content.contentKey ?? content.title;
    if (lastStep.current !== key) {
      lastStep.current = key; cancelAnimation(step);
      step.value = motion.reduceMotion ? 0 : 32;
      if (!motion.reduceMotion) step.value = withTiming(0, { duration: STEP_DURATION, easing: panelEasing });
    }
  }, [content.contentKey, content.title, motion.reduceMotion, step]);
  const stepStyle = useAnimatedStyle(() => ({ transform: [{ translateY: step.value }] }));
  if (!rendered) return null;

  const handle = content.hideHandle ? null : (
    <GestureDetector gesture={handlePan}>
      <View collapsable={false} style={styles.handleBand}>
        <FastPressable testID="bottom-panel-handle" onPress={close} accessibilityRole="button" accessibilityLabel="Закрыть панель" style={styles.handleTouch}>
          <View style={styles.handle} />
        </FastPressable>
      </View>
    </GestureDetector>
  );
  const header = content.headerContent ?? (content.title ? <View style={styles.header}>
    <Text style={styles.title} translate>{content.title}</Text>
    <FastPressable onPress={close} accessibilityLabel="Закрыть" hitSlop={12} style={styles.close}>
      <PwaIcon name="close" size={22} color={colors.textLight} />
    </FastPressable>
  </View> : null);
  const body = containsScroller(content.children) ? content.children : <PanelScrollView style={styles.scroll}
    keyboardShouldPersistTaps="handled">{content.children}</PanelScrollView>;
  const bodyMotion = content.bodyDraggable === false ? { ...motion, draggable: false } : motion;
  const { width: panelWidth, maxWidth, alignSelf, height: _height, maxHeight: _maxHeight, ...surfaceStyle } = content.panelStyle ?? {};

  const panel = <HandTargetModal><PanelCloseContext.Provider value={closeContext}><PanelMotionContext.Provider value={bodyMotion}>
    <GestureHandlerRootView style={styles.root} pointerEvents={interactive ? 'box-none' : 'none'}
      accessibilityElementsHidden={!interactive} importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}>
      <View ref={rootRef} collapsable={false} style={styles.root} pointerEvents="box-none" onLayout={measureContainer}>
        {!persistent ? <Animated.View pointerEvents={active ? 'auto' : 'none'} style={[styles.backdrop, backdrop]}>
          <FastPressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Закрыть панель" handExclude={handPanelRef} />
        </Animated.View> : null}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={container.y}
          pointerEvents="box-none" style={[styles.viewport,
            { bottom: (content.bottomInset ?? 0) + overlap, paddingTop: topGap }]}>
          <Animated.View ref={handPanelRef} collapsable={false} accessibilityViewIsModal={!persistent && active}
            accessibilityElementsHidden={!active} importantForAccessibility={active ? 'yes' : 'no-hide-descendants'}
            pointerEvents={active ? 'auto' : 'none'} onLayout={event => measure(event.nativeEvent.layout.height)}
            style={[styles.panel, { maxHeight: maximum, width: panelWidth ?? (dimensions.width >= 600 ? Math.min(dimensions.width - 48, 720) : '100%'), maxWidth, alignSelf: alignSelf ?? 'center' },
              full && { height: maximum }, centered && { maxWidth: 300 }, animation]}>
            {outsideHandle ? handle : null}
            <View style={[styles.surface, surfaceStyle, { flexShrink: 1, minHeight: 0 }, full && styles.fill,
              { borderTopLeftRadius: 26, borderTopRightRadius: 26 }]}>
              {handlePlacement === 'inside' ? handle : null}
              {!content.hideHeader ? <GestureDetector gesture={headerPan}><View collapsable={false}>
                {header}
              </View></GestureDetector> : null}
              <Animated.View style={[styles.body, full && styles.fill, content.bodyStyle, stepStyle]}>{body}</Animated.View>
              {content.footer ? <View style={[styles.footer, content.footerStyle]}>{content.footer}</View> : null}
              <View style={{ height: bottomPadding, flexShrink: 0 }} />
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
      <HandPointer />
    </GestureHandlerRootView>
  </PanelMotionContext.Provider></PanelCloseContext.Provider></HandTargetModal>;
  if (persistent) return <View style={StyleSheet.absoluteFill} pointerEvents="box-none">{panel}</View>;
  if (inline) return <SheetPortal>{panel}</SheetPortal>;
  return <Modal visible transparent animationType="none" statusBarTranslucent hardwareAccelerated
    supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
    onRequestClose={close}>{panel}</Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  viewport: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', alignItems: 'center' },
  centered: { justifyContent: 'center' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  panel: { alignSelf: 'center', flexShrink: 1 },
  surface: { backgroundColor: colors.card, overflow: 'hidden' },
  fill: { flex: 1, minHeight: 0 },
  handleBand: { height: 28, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  handleTouch: { width: 88, height: '100%', alignItems: 'center', justifyContent: 'center' },
  handle: { width: 34, height: 4, borderRadius: 2, backgroundColor: colors.slate300 },
  header: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
  close: { minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  body: { flexShrink: 1, minHeight: 0, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  scroll: { flexShrink: 1, minHeight: 0 },
  footer: { backgroundColor: colors.card, zIndex: 1, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
});
