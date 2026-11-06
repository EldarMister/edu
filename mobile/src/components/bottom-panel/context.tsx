import React from 'react';
import { View, type ViewProps } from 'react-native';
import { panelHistory } from './history';

export type PanelCloseController = {
  id: string; onClose: () => void; close: () => void;
  closeActions?: readonly (() => void)[];
};
export const PanelCloseContext = React.createContext<PanelCloseController | null>(null);
export function useBottomPanelClose() { return React.useContext(PanelCloseContext)?.close; }
export function useBottomPanelHistory() {
  return React.useSyncExternalStore(panelHistory.subscribe, panelHistory.getSnapshot, panelHistory.getSnapshot);
}

export type PanelController = { request: React.MutableRefObject<(() => void) | null> };
export function useBottomPanelController(initial = false) {
  const [visible, setVisible] = React.useState(initial);
  const request = React.useRef<(() => void) | null>(null);
  const next = React.useRef<(() => void) | null>(null);
  const onClose = React.useCallback(() => {
    setVisible(false); const callback = next.current; next.current = null; callback?.();
  }, []);
  const open = React.useCallback(() => setVisible(true), []);
  const close = React.useCallback(() => { request.current?.(); }, []);
  const switchTo = React.useCallback((callback: () => void) => {
    if (!visible) { callback(); return; }
    next.current = callback; request.current?.();
  }, [visible]);
  React.useEffect(() => () => { next.current = null; }, []);
  return { visible, open, close, switchTo, bind: { visible, onClose, controller: { request } } };
}

/** Inline panels live outside the waiter's screen boundary, native Modals in their own window. */
export function PanelScreenBoundary({ mode = 'native', ...props }: ViewProps & { mode?: 'native' | 'inline' }) {
  const state = useBottomPanelHistory();
  const hidden = state.temporary > 0 && (mode === 'inline' ? state.inline : !state.inline);
  return <View {...props} pointerEvents={hidden ? 'none' : props.pointerEvents}
    accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'} />;
}
