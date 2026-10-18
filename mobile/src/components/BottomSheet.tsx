import React from 'react';
import { BackHandler, Keyboard, Modal as RNModal, ScrollView, StyleSheet, useWindowDimensions, View, type ScrollViewProps, type ViewStyle } from 'react-native';
import { Text, TextInput } from '@/components/typography';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontSize, spacing, waiterLayout } from '@/theme';
import { PwaIcon } from './PwaIcon';
import { FastPressable } from './FastPressable';
import { sheetPresets, type SheetAnimationPreset } from './motion';
import { SheetPortal, useSheetPortalViewportHeight } from './SheetPortal';

function dismissKeyboard() {
  const focused = TextInput.State.currentlyFocusedInput?.();
  focused?.blur?.();
  Keyboard.dismiss();
}

type SheetContent = {
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerContent?: React.ReactNode;
  sheet?: boolean;
  bodyStyle?: ViewStyle;
  panelStyle?: ViewStyle;
  footerStyle?: ViewStyle;
  maxHeight?: ViewStyle['maxHeight'];
  bottomInset?: number;
  paddingBottomInset?: number;
  backdropColor?: string;
  fillBody?: boolean;
  presentation?: 'bottom' | 'center';
  hideHeader?: boolean;
};
type DragContext = {
  drag: SharedValue<number>;
  height: SharedValue<number>;
  enabled: SharedValue<boolean>;
  dismissing: SharedValue<boolean>;
  close: () => void;
  duration: number;
  easing: typeof sheetPresets.default.easing;
};
const SheetDragContext = React.createContext<DragContext | null>(null);

function useSheetPan(context: DragContext, scrollOffset?: SharedValue<number>) {
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  return React.useMemo(() => {
    const { drag, height, enabled, dismissing, close, duration, easing } = context;
    const pan = Gesture.Pan()
      .maxPointers(1)
      .activeOffsetY([-8, 8])
      .failOffsetX([-16, 16])
      .onStart(() => { cancelAnimation(drag); })
      .onUpdate(event => {
        if (enabled.value) drag.value = Math.max(0, event.translationY);
      })
      .onEnd(event => {
        if (!enabled.value) return;
        if (drag.value > Math.min(110, height.value * 0.28) || (drag.value > 12 && event.velocityY > 900)) {
          dismissing.value = true;
          runOnJS(close)();
        }
      })
      .onFinalize(() => {
        if (!dismissing.value) drag.value = withTiming(0, { duration, easing });
      });
    if (scrollOffset) {
      pan.manualActivation(true)
        .onTouchesDown(event => {
          const touch = event.allTouches[0];
          if (touch) { startX.value = touch.absoluteX; startY.value = touch.absoluteY; }
        })
        .onTouchesMove((event, manager) => {
          const touch = event.allTouches[0];
          if (!touch || !enabled.value) { manager.fail(); return; }
          const dy = touch.absoluteY - startY.value;
          const dx = touch.absoluteX - startX.value;
          if (Math.abs(dx) > 16 || dy < -8 || scrollOffset.value > 0.5) manager.fail();
          else if (dy > 8) manager.activate();
        });
    }
    return pan;
  }, [context, scrollOffset, startX, startY]);
}

/** Scroll normally; a downward pull at the top follows the sheet on the UI thread. */
export const SheetScrollView = React.forwardRef<ScrollView, ScrollViewProps>(function SheetScrollView(props, ref) {
  const context = React.useContext(SheetDragContext);
  return context ? <DraggableScrollView {...props} ref={ref} context={context} /> : <ScrollView {...props} ref={ref} />;
});

const DraggableScrollView = React.forwardRef<ScrollView, ScrollViewProps & { context: DragContext }>(function DraggableScrollView(
  { context, onScroll, scrollEventThrottle, ...props }, ref,
) {
  const offset = useSharedValue(0);
  const pan = useSheetPan(context, offset);
  const native = React.useMemo(() => Gesture.Native(), []);
  const gesture = React.useMemo(() => Gesture.Simultaneous(pan, native), [pan, native]);
  return (
    <GestureDetector gesture={gesture}>
        <ScrollView {...props} ref={ref} bounces={false} overScrollMode="never" scrollEventThrottle={scrollEventThrottle ?? 16}
          onScroll={event => { offset.value = event.nativeEvent.contentOffset.y; onScroll?.(event); }} />
    </GestureDetector>
  );
});

/** PWA panel geometry and transitions, with native drag and scroll coordination. */
export function BottomSheet({ visible, onClose, onDismiss, animationPreset = 'default', inline = false, ...currentContent }: SheetContent & {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  animationPreset?: SheetAnimationPreset;
  /** Render below the navigator's tab bar instead of creating a native Modal window. */
  inline?: boolean;
}) {
  const timing = sheetPresets[animationPreset];
  const reduceMotion = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();
  const portalViewportHeight = useSheetPortalViewportHeight();
  const [render, setRender] = React.useState(visible);
  const snapshot = React.useRef(currentContent);
  if (visible) snapshot.current = currentContent;
  const content = visible ? currentContent : snapshot.current;
  const progress = useSharedValue(0);
  const panelHeight = useSharedValue(windowHeight || 900);
  const drag = useSharedValue(0);
  const enabled = useSharedValue(visible);
  const dismissing = useSharedValue(false);
  const ready = React.useRef(false);
  const renderRef = React.useRef(render);
  const visibleRef = React.useRef(visible);
  const onCloseRef = React.useRef(onClose);
  const onDismissRef = React.useRef(onDismiss);
  const sequence = React.useRef(0);
  visibleRef.current = visible;
  renderRef.current = render;
  onCloseRef.current = onClose;
  onDismissRef.current = onDismiss;

  const close = React.useCallback(() => {
    if (!visibleRef.current) return;
    dismissKeyboard();
    onCloseRef.current();
  }, []);
  React.useEffect(() => {
    if (!inline || !visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => subscription.remove();
  }, [close, inline, visible]);
  const finishClose = React.useCallback((seq: number) => {
    if (sequence.current !== seq || visibleRef.current) return;
    ready.current = false;
    setRender(false);
    onDismissRef.current?.();
  }, []);
  const enter = React.useCallback(() => {
    if (!visibleRef.current) return;
    progress.value = withTiming(1, { duration: reduceMotion ? 0 : timing.enterMs, easing: timing.easing });
  }, [progress, reduceMotion, timing]);

  React.useEffect(() => {
    const seq = ++sequence.current;
    cancelAnimation(progress);
    cancelAnimation(drag);
    enabled.value = visible && currentContent.presentation !== 'center';
    if (visible) {
      dismissing.value = false;
      drag.value = 0;
      setRender(true);
      if (ready.current) enter();
    } else {
      if (!renderRef.current) return;
      dismissKeyboard();
      // Keep the released drag position: closing must continue without a jump.
      progress.value = Math.max(0, progress.value - drag.value / panelHeight.value);
      drag.value = 0;
      const exitMs = timing.exitMs || (dismissing.value ? 220 : 0);
      progress.value = withTiming(0, { duration: reduceMotion ? 0 : exitMs, easing: timing.easing }, finished => {
        if (finished) runOnJS(finishClose)(seq);
      });
    }
  }, [visible, enter, finishClose, progress, drag, panelHeight, enabled, dismissing, reduceMotion, timing, currentContent.presentation]);

  const context = React.useMemo<DragContext>(() => ({
    drag, height: panelHeight, enabled, dismissing, close,
    duration: reduceMotion ? 0 : timing.exitMs || 220, easing: timing.easing,
  }), [drag, panelHeight, enabled, dismissing, close, reduceMotion, timing]);
  const pan = useSheetPan(context);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value * Math.max(0, 1 - drag.value / panelHeight.value) }));
  const centered = content.presentation === 'center';
  const sheetStyle = useAnimatedStyle(() => centered ? {
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 8 }, { scale: 0.94 + progress.value * 0.06 }],
  } : { transform: [{ translateY: (1 - progress.value) * panelHeight.value + drag.value }] });
  if (!render) return null;

  const header = content.headerContent ?? (content.sheet ? (
    <View style={styles.handleWrap}>
      <View style={styles.handle} />
      {content.title ? <Text style={styles.sheetTitle} translate>{content.title}</Text> : null}
    </View>
  ) : content.title ? (
    <View style={styles.header}>
      <View style={[styles.handle, styles.headerHandle]} />
      <View style={styles.headerRow}>
      <Text style={styles.title} translate>{content.title}</Text>
      <FastPressable onPress={close} hitSlop={12} accessibilityLabel="Закрыть">
        <PwaIcon name="close" size={20} color={colors.textLight} />
      </FastPressable>
      </View>
    </View>
  ) : <View style={styles.handleWrap}><View style={styles.handle} /></View>);

  const inlineMaxHeight = inline && typeof content.maxHeight === 'string' && content.maxHeight.endsWith('%')
    ? Math.min(windowHeight * parseFloat(content.maxHeight) / 100, portalViewportHeight || windowHeight)
    : content.maxHeight;
  const sheet = (
      <GestureHandlerRootView style={[styles.root, inline && styles.inlineRoot]} pointerEvents="box-none">
        <Animated.View style={[styles.backdrop, content.bottomInset != null && { bottom: content.bottomInset }, content.backdropColor && { backgroundColor: content.backdropColor }, backdropStyle]}>
          <FastPressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Закрыть" />
        </Animated.View>
        <View pointerEvents="box-none" style={[styles.viewport, centered && styles.centerViewport, content.bottomInset != null && { bottom: content.bottomInset }]}>
          <Animated.View onLayout={event => {
            panelHeight.value = Math.max(1, event.nativeEvent.layout.height);
            if (inline && !ready.current) { ready.current = true; enter(); }
          }} style={[
            styles.sheet, inlineMaxHeight != null && { maxHeight: inlineMaxHeight },
            content.fillBody && { height: inlineMaxHeight ?? '92%' }, centered && styles.centerPanel, content.panelStyle, sheetStyle,
          ]}>
            <SafeAreaView edges={centered || inline ? [] : ['bottom']} style={[styles.safe, centered && styles.centerSafe, content.fillBody && styles.fill, content.paddingBottomInset != null && { paddingBottom: content.paddingBottomInset }]}>
              <SheetDragContext.Provider value={context}>
                {!content.hideHeader ? <GestureDetector gesture={pan}><View collapsable={false}>{header}</View></GestureDetector> : null}
                <View style={[styles.body, content.fillBody && styles.fill, content.bodyStyle]}>{content.children}</View>
                {content.footer ? <View style={[styles.footer, content.footerStyle]}>{content.footer}</View> : null}
              </SheetDragContext.Provider>
            </SafeAreaView>
          </Animated.View>
        </View>
      </GestureHandlerRootView>
  );
  if (inline) return <SheetPortal>{sheet}</SheetPortal>;
  return (
    <RNModal visible transparent animationType="none" statusBarTranslucent hardwareAccelerated onRequestClose={close}
      onShow={() => { ready.current = true; enter(); }}>
      {sheet}
    </RNModal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inlineRoot: { ...StyleSheet.absoluteFillObject },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  viewport: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', overflow: 'hidden' },
  centerViewport: { justifyContent: 'center', alignItems: 'center', padding: 16 },
  centerPanel: { width: '100%', maxWidth: 300, borderRadius: 16, backgroundColor: 'transparent', overflow: 'visible' },
  centerSafe: { backgroundColor: 'transparent' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: waiterLayout.sheetRadius, borderTopRightRadius: waiterLayout.sheetRadius, maxHeight: '92%', overflow: 'hidden' },
  safe: { backgroundColor: colors.card, flexShrink: 1, minHeight: 0 },
  fill: { flex: 1, minHeight: 0 },
  handleWrap: { paddingTop: 10, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.slate300 },
  sheetTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
  header: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingTop: 10 },
  headerHandle: { marginBottom: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: spacing.md },
  title: { fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 },
  body: { flexShrink: 1, minHeight: 0, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  footer: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
});
