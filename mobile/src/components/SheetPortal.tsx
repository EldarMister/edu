import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

type PortalEntry = { id: string; content: React.ReactNode };
type PortalState = {
  entries: PortalEntry[];
  viewportHeight: number;
  put: (id: string, content: React.ReactNode) => void;
  remove: (id: string) => void;
  setViewportHeight: (height: number) => void;
};

function createPortalStore() {
  return createStore<PortalState>((set) => ({
    entries: [],
    viewportHeight: 0,
    put: (id, content) => set((state) => {
      const entry = state.entries.find((item) => item.id === id);
      if (entry?.content === content) return state;
      return {
        entries: entry
          ? state.entries.map((item) => item.id === id ? { id, content } : item)
          : [...state.entries, { id, content }],
      };
    }),
    remove: (id) => set((state) => state.entries.some((item) => item.id === id)
      ? { entries: state.entries.filter((item) => item.id !== id) }
      : state),
    setViewportHeight: (height) => set((state) => Math.abs(state.viewportHeight - height) > 0.5
      ? { viewportHeight: height }
      : state),
  }));
}

const PortalContext = React.createContext<StoreApi<PortalState> | null>(null);
const emptyPortalStore = createPortalStore();

/** A navigator owns its portal, so signing out also removes every inline sheet. */
export function SheetPortalProvider({ children }: { children: React.ReactNode }) {
  const storeRef = React.useRef<StoreApi<PortalState> | null>(null);
  if (!storeRef.current) storeRef.current = createPortalStore();
  return <PortalContext.Provider value={storeRef.current}>{children}</PortalContext.Provider>;
}

export function useSheetPortalViewportHeight() {
  const store = React.useContext(PortalContext);
  return useStore(store ?? emptyPortalStore, (state) => state.viewportHeight);
}

/** Updating the overlay does not put React state in the navigator itself. */
export function SheetPortal({ children }: { children: React.ReactNode }) {
  const store = React.useContext(PortalContext);
  const id = React.useId();

  React.useLayoutEffect(() => {
    store?.getState().put(id, children);
  }, [children, id, store]);
  React.useLayoutEffect(() => () => store?.getState().remove(id), [id, store]);
  if (!store) throw new Error('An inline BottomSheet requires a SheetPortalProvider and SheetPortalHost.');
  return null;
}

export function SheetPortalHost({ style }: { style?: ViewStyle }) {
  const store = React.useContext(PortalContext);
  const entries = useStore(store ?? emptyPortalStore, (state) => state.entries);
  return (
    <View pointerEvents="box-none" style={[styles.host, style]} onLayout={(event) => {
      store?.getState().setViewportHeight(event.nativeEvent.layout.height);
    }}>
      {entries.map((entry) => <React.Fragment key={entry.id}>{entry.content}</React.Fragment>)}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { ...StyleSheet.absoluteFillObject, zIndex: 40 },
});
