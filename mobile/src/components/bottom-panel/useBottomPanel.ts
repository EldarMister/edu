import React from 'react';
import { BackHandler, Keyboard } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { cancelAnimation, Easing, runOnJS, useReducedMotion, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { panelHistory } from './history';
import { useBottomPanelHistory } from './context';
import { canStartPanelDrag, PANEL_DURATION, PanelCompletion, resistPanelOffset, shouldDismissPanel } from './geometry';

export const panelEasing = Easing.bezier(0.32, 0.72, 0, 1);
type Exit = 'close' | 'suspend';
export type PanelMotion = {
  offset: SharedValue<number>; travel: SharedValue<number>; headerHeight: SharedValue<number>; measured: SharedValue<boolean>;
  closing: SharedValue<boolean>; enabled: SharedValue<boolean>; reduceMotion: boolean;
  draggable: boolean;
  close: (velocity?: number) => void;
};

export function useBottomPanel({ id, parent, visible, persistent, inline, draggable, onClose, onDismiss, ownerKey }: {
  id: string; parent?: string; visible: boolean; persistent: boolean; inline: boolean; draggable: boolean;
  onClose: () => void; onDismiss?: () => void;
  ownerKey?: string;
}) {
  const stack = useBottomPanelHistory();
  const active = stack.active === id && stack.desired === id;
  const [rendered, setRendered] = React.useState(visible);
  const [interactive, setInteractive] = React.useState(false);
  const offset = useSharedValue(100000);
  const travel = useSharedValue(1);
  const headerHeight = useSharedValue(0);
  const measured = useSharedValue(false);
  const closing = useSharedValue(false);
  const enabled = useSharedValue(false);
  const reduceMotion = useReducedMotion();
  const completion = React.useRef(new PanelCompletion());
  const state = React.useRef({ visible, active, rendered, phase: 'hidden', seq: 0, token: 0, requested: false, mounted: true, action: undefined as (() => void) | undefined });
  const callbacks = React.useRef({ onClose, onDismiss }); callbacks.current = { onClose, onDismiss };
  state.current.visible = visible; state.current.active = active; state.current.rendered = rendered;

  const finish = React.useCallback((seq: number, mode: Exit) => {
    const current = state.current;
    if (!current.mounted || seq !== current.seq) return;
    if (mode === 'suspend') { current.phase = 'suspended'; panelHistory.yield(id); return; }
    if (!completion.current.finish(current.token)) return;
    current.phase = 'hidden'; current.rendered = false;
    setRendered(false); panelHistory.remove(id);
    const { onClose: notify, onDismiss: dismissed } = callbacks.current;
    try { if (current.requested) (current.action ?? notify)(); }
    finally { if (current.mounted && seq === current.seq) dismissed?.(); }
  }, [id]);

  const exit = React.useCallback((mode: Exit, velocity = 0) => {
    const current = state.current;
    if (!current.mounted || !current.rendered || current.phase === 'closing') return;
    if (mode === 'close') {
      const token = completion.current.close(); if (token === null) return;
      current.token = token; current.phase = 'closing';
      Keyboard.dismiss();
    } else current.phase = 'suspending';
    const seq = ++current.seq;
    setInteractive(false);
    closing.value = true; enabled.value = false; cancelAnimation(offset);
    if (reduceMotion || !measured.value) {
      offset.value = travel.value; finish(seq, mode);
    } else {
      offset.value = withSpring(travel.value, { duration: PANEL_DURATION, dampingRatio: 1, overshootClamping: true, velocity }, done => {
        if (done) runOnJS(finish)(seq, mode);
      });
    }
  }, [closing, enabled, finish, measured, offset, reduceMotion, travel]);

  const close = React.useCallback((velocity = 0) => {
    if (!state.current.visible || !state.current.active || state.current.phase === 'closing') return;
    state.current.requested = true;
    // Keep the initiating owner's callback; a later order/status must not replace it.
    state.current.action = callbacks.current.onClose;
    exit('close', velocity);
  }, [exit]);

  const enter = React.useCallback(() => {
    const current = state.current;
    if (!current.mounted || !current.visible || !current.active || !measured.value || current.phase === 'closing') return;
    ++current.seq; current.phase = 'open'; closing.value = false; enabled.value = draggable;
    setInteractive(true);
    cancelAnimation(offset);
    offset.value = reduceMotion ? 0 : withTiming(0, { duration: PANEL_DURATION, easing: panelEasing });
  }, [closing, draggable, enabled, measured, offset, reduceMotion]);

  const measure = React.useCallback((height: number) => {
    if (height <= 0 || !state.current.mounted) return;
    const first = !measured.value;
    travel.value = height + 24;
    if (first) { offset.value = travel.value; measured.value = true; enter(); }
    else if (state.current.phase === 'suspended') offset.value = travel.value;
    else if (state.current.phase === 'closing' || state.current.phase === 'suspending') {
      const seq = state.current.seq;
      const mode: Exit = state.current.phase === 'closing' ? 'close' : 'suspend';
      cancelAnimation(offset);
      if (reduceMotion) { offset.value = travel.value; finish(seq, mode); }
      else offset.value = withSpring(travel.value, { duration: PANEL_DURATION, dampingRatio: 1, overshootClamping: true }, done => {
        if (done) runOnJS(finish)(seq, mode);
      });
    }
  }, [enter, finish, measured, offset, reduceMotion, travel]);

  React.useLayoutEffect(() => {
    state.current.mounted = true; completion.current.open();
    return () => {
      state.current.mounted = false; ++state.current.seq; completion.current.invalidate();
      enabled.value = false; cancelAnimation(offset); panelHistory.remove(id);
    };
  }, [enabled, id, offset]);

  React.useLayoutEffect(() => {
    if (visible) {
      const hasLayout = state.current.rendered && measured.value;
      cancelAnimation(offset); ++state.current.seq;
      completion.current.open(); state.current.requested = false; state.current.action = undefined; state.current.phase = 'waiting';
      state.current.rendered = true;
      if (!hasLayout) { measured.value = false; offset.value = 100000; }
      setRendered(true); panelHistory.add({ id, parent, persistent, inline });
    } else if (state.current.rendered) {
      state.current.requested = false;
      exit('close');
    }
  }, [visible, id, parent, persistent, inline, exit, measured, offset, ownerKey]);

  React.useEffect(() => {
    if (!rendered || !visible || state.current.phase === 'closing') return;
    if (active) enter();
    else if (stack.active === id && stack.desired !== id) exit('suspend');
    else enabled.value = false;
  }, [active, enabled, enter, exit, id, rendered, stack.active, stack.desired, visible, ownerKey]);

  React.useEffect(() => {
    if (!rendered || !active || persistent) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => listener.remove();
  }, [active, close, persistent, rendered]);

  const motion = React.useMemo<PanelMotion>(() => ({ offset, travel, headerHeight, measured, closing, enabled, reduceMotion, draggable, close }),
    [close, closing, draggable, enabled, headerHeight, measured, offset, reduceMotion, travel]);
  return { rendered, active, interactive: active && interactive, measure, motion };
}

/** Header and scroll gestures share the same position, including a caught spring. */
export function useBottomPanelPan(motion: PanelMotion, scrollY?: SharedValue<number>) {
  const x = useSharedValue(0), y = useSharedValue(0), base = useSharedValue(0), eligible = useSharedValue(false);
  return React.useMemo(() => {
    const { offset, travel, headerHeight, closing, enabled, reduceMotion, close } = motion;
    const pan = Gesture.Pan().enabled(motion.draggable).maxPointers(1)
      .onStart(event => { cancelAnimation(offset); base.value = offset.value - event.translationY; })
      .onUpdate(event => {
        if (enabled.value && !closing.value) offset.value = resistPanelOffset(base.value + event.translationY, travel.value);
      })
      .onEnd(event => {
        if (!enabled.value || closing.value) return;
        if (shouldDismissPanel(offset.value, event.velocityY, travel.value)) {
          closing.value = true; runOnJS(close)(event.velocityY);
        } else offset.value = reduceMotion ? 0 : withSpring(0, { duration: PANEL_DURATION, dampingRatio: 0.8, overshootClamping: true, velocity: event.velocityY });
      })
      .onFinalize((_event, success) => {
        if (!success && !closing.value) offset.value = reduceMotion ? 0 : withSpring(0, { duration: PANEL_DURATION, dampingRatio: 0.8, overshootClamping: true });
      });
    if (!scrollY) return pan.activeOffsetY([-10, 10]).failOffsetX([-10, 10]);
    return pan.manualActivation(true)
      .onTouchesDown((event, manager) => {
        const touch = event.allTouches[0];
        eligible.value = !!touch && enabled.value && !closing.value && canStartPanelDrag(scrollY.value, touch.y + headerHeight.value);
        if (!eligible.value || !touch) { manager.fail(); return; }
        x.value = touch.absoluteX; y.value = touch.absoluteY;
      })
      .onTouchesMove((event, manager) => {
        const touch = event.allTouches[0];
        if (!touch || !eligible.value || !enabled.value || closing.value) { manager.fail(); return; }
        const dx = touch.absoluteX - x.value, dy = touch.absoluteY - y.value;
        if (Math.abs(dx) > 10 || dy < -8 || scrollY.value > 1) manager.fail();
        else if (dy > 10 && dy > Math.abs(dx) * 1.3) manager.activate();
      });
  }, [base, eligible, motion, scrollY, x, y]);
}
