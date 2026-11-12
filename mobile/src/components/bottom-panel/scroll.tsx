import React from 'react';
import { FlatList, ScrollView, type FlatListProps, type ScrollViewProps, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useBottomPanelPan, type PanelMotion } from './useBottomPanel';

export const PanelMotionContext = React.createContext<PanelMotion | null>(null);
function useScrollGesture(motion: PanelMotion, onScroll: ScrollViewProps['onScroll']) {
  const offset = useSharedValue(0);
  const pan = useBottomPanelPan(motion, offset);
  const native = React.useMemo(() => Gesture.Native(), []);
  const gesture = React.useMemo(() => Gesture.Exclusive(pan, native), [native, pan]);
  const notify = React.useCallback((event: NativeScrollEvent) => {
    onScroll?.({ nativeEvent: event } as NativeSyntheticEvent<NativeScrollEvent>);
  }, [onScroll]);
  const handler = useAnimatedScrollHandler({ onScroll: event => {
    offset.value = event.contentOffset.y;
    if (onScroll) runOnJS(notify)(event);
  } }, [notify, onScroll]);
  return { gesture, handler };
}

export const PanelScrollView = React.forwardRef<ScrollView, ScrollViewProps>(function PanelScrollView(props, ref) {
  const motion = React.useContext(PanelMotionContext);
  return motion && !props.horizontal ? <DraggableScroll {...props} ref={ref} motion={motion} /> : <ScrollView {...props} ref={ref} />;
});
const DraggableScroll = React.forwardRef<ScrollView, ScrollViewProps & { motion: PanelMotion }>(function DraggableScroll({ motion, onScroll, ...props }, ref) {
  const { gesture, handler } = useScrollGesture(motion, onScroll);
  const forward = React.useCallback((node: ScrollView | null) => {
    if (typeof ref === 'function') ref(node); else if (ref) ref.current = node;
  }, [ref]);
  return <GestureDetector gesture={gesture}><Animated.ScrollView {...props} ref={forward}
    bounces={false} overScrollMode="never" scrollEventThrottle={props.scrollEventThrottle ?? 16} onScroll={handler} /></GestureDetector>;
});

const AnimatedList = Animated.createAnimatedComponent(FlatList<unknown>);
const DraggableList = React.forwardRef<FlatList<unknown>, FlatListProps<unknown> & { motion: PanelMotion }>(function DraggableList({ motion, onScroll, ...props }, ref) {
  const { gesture, handler } = useScrollGesture(motion, onScroll);
  return <GestureDetector gesture={gesture}><AnimatedList {...props} ref={ref}
    bounces={false} overScrollMode="never" scrollEventThrottle={props.scrollEventThrottle ?? 16} onScroll={handler} /></GestureDetector>;
});
export const PanelFlatList = React.forwardRef<FlatList<unknown>, FlatListProps<unknown>>(function PanelFlatList(props, ref) {
  const motion = React.useContext(PanelMotionContext);
  return motion && !props.horizontal ? <DraggableList {...props} ref={ref} motion={motion} /> : <FlatList {...props} ref={ref} />;
}) as <ItemT>(props: FlatListProps<ItemT> & React.RefAttributes<FlatList<ItemT>>) => React.ReactElement;
