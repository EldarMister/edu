import React from 'react';
import { BackHandler, Keyboard } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { cancelAnimation, Easing, runOnJS, useReducedMotion, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { panelHistory } from './history';
import { useBottomPanelHistory } from './context';
import { panelDragOrigin, PANEL_DURATION, PanelCompletion, resistPanelOffset, shouldDismissPanel } from './geometry';

export const panelEasing = Easing.bezier(0.32, 0.72, 0, 1);
type Exit = 'close' | 'suspend';
export type PanelMotion = {
  offset: SharedValue<number>; travel: SharedValue<number>; measured: SharedValue<boolean>;
  interaction: SharedValue<number>;
  closing: SharedValue<boolean>; enabled: SharedValue<boolean>; reduceMotion: boolean;
  draggable: boolean;
  close: (velocity?: number) => void;
  dismiss: (interaction: number) => void;
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
  const interaction = useSharedValue(0);
  const measured = useSharedValue(false);
  const closing = useSharedValue(false);
  const enabled = useSharedValue(false);
  const reduceMotion = useReducedMotion();
  const completion = React.useRef(new PanelCompletion());
  const state = React.useRef({ visible, active, rendered, height: 0, phase: 'hidden', seq: 0, token: 0, requested: false, mounted: true, action: undefined as (() => void) | undefined });
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

  const exit = React.useCallback((mode: Exit, velocity = 0, settled = false) => {
    const current = state.current;
    if (!current.mounted || !current.rendered || current.phase === 'closing') return;
    if (mode === 'close') {
      const token = completion.current.close(); if (token === null) return;
      current.token = token; current.phase = 'closing';
      Keyboard.dismiss();
    } else current.phase = 'suspending';
    const seq = ++current.seq;
    setInteractive(false);
    interaction.value += 1;
    closing.value = true; enabled.value = false; cancelAnimation(offset);
    const distance = current.height + 24;
    if (settled || reduceMotion || !current.height) {
      offset.value = distance; finish(seq, mode);
    } else {
      offset.value = withSpring(distance, { duration: PANEL_DURATION, dampingRatio: 1, overshootClamping: true, velocity }, done => {
        if (done) runOnJS(finish)(seq, mode);
      });
    }
  }, [closing, enabled, finish, interaction, offset, reduceMotion]);

  const close = React.useCallback((velocity = 0, settled = false) => {
    if (!state.current.visible || !state.current.active || state.current.phase === 'closing') return;
    state.current.requested = true;
    // Keep the initiating owner's callback; a later order/status must not replace it.
    state.current.action = callbacks.current.onClose;
    exit('close', velocity, settled);
  }, [exit]);

  const dismiss = React.useCallback((version: number) => {
    if (version === interaction.value) close(0, offset.value >= state.current.height + 24);
  }, [close, interaction, offset]);

  const enter = React.useCallback(() => {
    const current = state.current;
    if (!current.mounted || !current.visible || !current.active || !current.height || current.phase === 'closing' || current.phase === 'open') return;
    ++current.seq; current.phase = 'open'; closing.value = false; enabled.value = draggable;
    interaction.value += 1;
    setInteractive(true);
    cancelAnimation(offset);
    offset.value = reduceMotion ? 0 : withTiming(0, { duration: PANEL_DURATION, easing: panelEasing });
  }, [closing, draggable, enabled, interaction, offset, reduceMotion]);

  const measure = React.useCallback((height: number) => {
    const current = state.current;
    if (height <= 0 || !current.mounted || height === current.height) return;
    // JS writes to shared values are asynchronous. Keep the measured height
    // here as well so the first layout can enable the pan and start opening.
    const first = current.height === 0;
    current.height = height;
    const distance = height + 24;
    travel.value = distance;
    if (first) { offset.value = distance; measured.value = true; enter(); }
    else if (current.phase === 'suspended') offset.value = distance;
    else if (current.phase === 'closing' || current.phase === 'suspending') {
      const seq = current.seq;
      const mode: Exit = current.phase === 'closing' ? 'close' : 'suspend';
      cancelAnimation(offset);
      if (reduceMotion) { offset.value = distance; finish(seq, mode); }
      else offset.value = withSpring(distance, { duration: PANEL_DURATION, dampingRatio: 1, overshootClamping: true }, done => {
        if (done) runOnJS(finish)(seq, mode);
      });
    }
  }, [enter, finish, measured, offset, reduceMotion, travel]);

  React.useLayoutEffect(() => {
    state.current.mounted = true; completion.current.open();
    return () => {
      state.current.mounted = false; ++state.current.seq; completion.current.invalidate();
      interaction.value += 1;
      enabled.value = false; cancelAnimation(offset); panelHistory.remove(id);
    };
  }, [enabled, id, interaction, offset]);

  React.useLayoutEffect(() => {
    if (visible) {
      const hasLayout = state.current.rendered && state.current.height > 0;
      cancelAnimation(offset); ++state.current.seq;
      interaction.value += 1;
      completion.current.open(); state.current.requested = false; state.current.action = undefined; state.current.phase = 'waiting';
      state.current.rendered = true;
      if (!hasLayout) { state.current.height = 0; measured.value = false; offset.value = 100000; }
      setRendered(true); panelHistory.add({ id, parent, persistent, inline });
    } else if (state.current.rendered) {
      state.current.requested = false;
      exit('close');
    }
  }, [visible, id, parent, persistent, inline, exit, interaction, measured, offset, ownerKey]);

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

  const motion = React.useMemo<PanelMotion>(() => ({ offset, travel, interaction, measured, closing, enabled, reduceMotion, draggable, close, dismiss }),
    [close, closing, dismiss, draggable, enabled, interaction, measured, offset, reduceMotion, travel]);
  return { rendered, active, interactive: active && interactive, measure, motion };
}

/** Each touch zone owns a pan. Only the winning pan updates the shared offset. */
export function useBottomPanelPan(motion: PanelMotion, scrollY?: SharedValue<number>) {
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const base = useSharedValue(0);
  const drag = useSharedValue<number | null>(null);
  return React.useMemo(() => {
    const { offset, travel, interaction, closing, enabled, reduceMotion, dismiss } = motion;
    const settle = (velocity: number, success: boolean, displacement = 0) => {
      'worklet';
      const version = drag.value;
      drag.value = null;
      if (version === null || version !== interaction.value || !enabled.value) return;
      if (success && shouldDismissPanel(offset.value, velocity, travel.value, displacement)) {
        // Keep the handle live until the spring reaches the closed position.
        const complete = (finished?: boolean) => {
          'worklet';
          if (finished && version === interaction.value) runOnJS(dismiss)(version);
        };
        if (reduceMotion) {
          offset.value = travel.value;
          complete(true);
        } else {
          offset.value = withSpring(travel.value, { duration: PANEL_DURATION, dampingRatio: 1, overshootClamping: true, velocity }, complete);
        }
      } else {
        offset.value = reduceMotion ? 0 : withSpring(0, { duration: PANEL_DURATION, dampingRatio: 0.8, overshootClamping: true, velocity });
      }
    };
    const pan = Gesture.Pan().enabled(motion.draggable).maxPointers(1)
      .onTouchesDown((event, manager) => {
        'worklet';
        const touch = event.allTouches[0];
        if (!touch || !enabled.value || closing.value || (scrollY && scrollY.value > 1)) { manager.fail(); return; }
        touchX.value = touch.absoluteX; touchY.value = touch.absoluteY;
      })
      .onStart(event => {
        'worklet';
        if (!enabled.value || closing.value) return;
        cancelAnimation(offset);
        base.value = panelDragOrigin(offset.value, travel.value) - event.absoluteY;
        interaction.value += 1;
        drag.value = interaction.value;
      })
      .onUpdate(event => {
        'worklet';
        if (drag.value === interaction.value) offset.value = resistPanelOffset(base.value + event.absoluteY, travel.value);
      })
      .onEnd((event, success) => {
        'worklet';
        settle(success ? event.velocityY : 0, success, event.absoluteY - touchY.value);
      })
      .onFinalize(() => {
        'worklet';
        settle(0, false);
      });
    if (!scrollY) return pan.activeOffsetY([-8, 8]).failOffsetX([-10, 10]);
    return pan.manualActivation(true)
      .onTouchesMove((event, manager) => {
        'worklet';
        if (drag.value !== null) return;
        const touch = event.allTouches[0];
        if (!touch || event.allTouches.length !== 1 || !enabled.value || closing.value) { manager.fail(); return; }
        const dx = touch.absoluteX - touchX.value, dy = touch.absoluteY - touchY.value;
        if (Math.abs(dx) > 10 || dy < -8 || scrollY.value > 1) manager.fail();
        else if (dy > 8 && dy > Math.abs(dx) * 1.3) manager.activate();
      })
      .onTouchesUp((_event, manager) => {
        'worklet';
        if (drag.value === null) manager.fail();
      });
  }, [base, drag, motion, scrollY, touchX, touchY]);
}
