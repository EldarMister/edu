import React from 'react';
import type { GestureResponderEvent, PressableProps, ScrollView, View } from 'react-native';
import type { Point } from './gesture';

type Bounds = { x: number; y: number; width: number; height: number };
type NativeRef = React.RefObject<View | ScrollView | null>;
export type HandPressableProps = PressableProps & {
  /** A semantic action version, independent of render-created callback identity. */
  handTargetKey?: string;
  /** The opaque panel above a modal backdrop is not part of its press area. */
  handExclude?: NativeRef;
};
export type HandTarget = {
  id: symbol; revision: number; layer: string; view: View | null; disabled: boolean;
  press?: PressableProps['onPress']; clip?: NativeRef; exclude?: NativeRef; identity?: string;
};
export type TargetHit = { target: HandTarget; revision: number; layerVersion: number; bounds: Bounds; point: Point };
const contains = (b: Bounds, p: Point) => b.width > 0 && b.height > 0 && p.x >= b.x && p.y >= b.y && p.x <= b.x + b.width && p.y <= b.y + b.height;
function measure(input: View | ScrollView | null): Promise<Bounds | null> {
  // RN 0.76 exposes getNativeScrollRef at runtime, but omits it from ScrollView.d.ts.
  const measurable = input as (Partial<Pick<View, 'measureInWindow'>> & { getNativeScrollRef?: () => View | null }) | null;
  const view = measurable?.getNativeScrollRef ? measurable.getNativeScrollRef() : measurable;
  if (!view?.measureInWindow) return Promise.resolve(null);
  const measureInWindow = view.measureInWindow.bind(view);
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 150);
    measureInWindow((x, y, width, height) => { clearTimeout(timer); resolve({ x, y, width, height }); });
  });
}

export class HandTargetRegistry {
  readonly targets = new Map<symbol, HandTarget>();
  private baseLayer = 'board';
  private layerVersion = 0;
  get activeLayer() { return this.baseLayer; }
  set activeLayer(layer: string) { if (layer !== this.baseLayer) { this.baseLayer = layer; this.layerVersion++; } }
  private readonly modals = new Map<string, { depth: number; order: number }>();
  private modalSequence = 0;
  private get currentLayer() {
    return [...this.modals].sort((a, b) => b[1].depth - a[1].depth || b[1].order - a[1].order)[0]?.[0] ?? this.activeLayer;
  }
  mountModal(layer: string, depth: number) {
    this.modals.set(layer, { depth, order: ++this.modalSequence });
    this.layerVersion++;
    return () => { this.modals.delete(layer); this.layerVersion++; };
  }
  async hit(point: Point): Promise<TargetHit | null> {
    const layer = this.currentLayer;
    const layerVersion = this.layerVersion;
    const hits = await Promise.all([...this.targets.values()].map(async target => {
      if (target.disabled || !target.press || target.layer !== layer) return null;
      const revision = target.revision;
      const [bounds, clip, exclude] = await Promise.all([
        measure(target.view), target.clip ? measure(target.clip.current) : Promise.resolve(null),
        target.exclude ? measure(target.exclude.current) : Promise.resolve(null),
      ]);
      if (this.targets.get(target.id) !== target || revision !== target.revision || target.disabled || layerVersion !== this.layerVersion) return null;
      if (!bounds || !contains(bounds, point) || (target.clip && (!clip || !contains(clip, point)))) return null;
      if (target.exclude && (!exclude || contains(exclude, point))) return null;
      return { target, revision, layerVersion, bounds, point: { ...point } };
    }));
    // A nested checkbox/button wins over a card's larger press target.
    return hits.filter((hit): hit is TargetHit => hit !== null).sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0] ?? null;
  }
  async activate(hit: TargetHit, shouldActivate: () => boolean = () => true) {
    const current = await this.hit(hit.point);
    if (!shouldActivate() || !current || current.target !== hit.target || current.revision !== hit.revision || current.layerVersion !== hit.layerVersion) return false;
    const { point, bounds } = current;
    current.target.press?.({
      nativeEvent: { pageX: point.x, pageY: point.y, locationX: point.x - bounds.x, locationY: point.y - bounds.y, timestamp: Date.now(), target: 0 },
      preventDefault() {}, stopPropagation() {}, persist() {}, isDefaultPrevented: () => false, isPropagationStopped: () => false,
    } as unknown as GestureResponderEvent);
    return true;
  }
}

type TargetContext = { registry: HandTargetRegistry; layer: string; clip?: NativeRef; identity?: string; modalDepth?: number; enabled?: boolean };
export const HandTargetContext = React.createContext<TargetContext | null>(null);
export function HandTargetLayer({ name, children }: { name: string; children: React.ReactNode }) {
  const parent = React.useContext(HandTargetContext);
  const value = React.useMemo(() => parent ? { ...parent, layer: name, clip: undefined } : null, [parent, name]);
  return <HandTargetContext.Provider value={value}>{children}</HandTargetContext.Provider>;
}
/** Remains mounted throughout exit animations; nested native windows win over their parents. */
export function HandTargetModal({ children }: { children: React.ReactNode }) {
  const parent = React.useContext(HandTargetContext);
  const layer = React.useId();
  const depth = (parent?.modalDepth ?? 0) + 1;
  React.useLayoutEffect(() => parent?.registry.mountModal(layer, depth), [parent?.registry, layer, depth]);
  const value = React.useMemo(() => parent ? { registry: parent.registry, layer, modalDepth: depth } : null, [parent?.registry, layer, depth]);
  return <HandTargetContext.Provider value={value}>{children}</HandTargetContext.Provider>;
}
export function HandTargetIdentity({ value, children }: { value: string; children: React.ReactNode }) {
  const parent = React.useContext(HandTargetContext);
  const context = React.useMemo(() => parent ? { ...parent, identity: `${parent.identity ?? ''}:${value}` } : null, [parent, value]);
  return <HandTargetContext.Provider value={context}>{children}</HandTargetContext.Provider>;
}
export function HandTargetEnabled({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const parent = React.useContext(HandTargetContext);
  const value = React.useMemo(() => parent ? { ...parent, enabled: parent.enabled !== false && enabled } : null, [parent, enabled]);
  return <HandTargetContext.Provider value={value}>{children}</HandTargetContext.Provider>;
}
export function HandTargetClip({ viewRef, children }: { viewRef: React.RefObject<View | ScrollView | null>; children: React.ReactNode }) {
  const parent = React.useContext(HandTargetContext);
  const value = React.useMemo(() => parent ? { ...parent, clip: viewRef } : null, [parent, viewRef]);
  return <HandTargetContext.Provider value={value}>{children}</HandTargetContext.Provider>;
}

/** Callback closures refresh on every render; only a changed action invalidates a held pinch. */
export function updateHandTarget(target: HandTarget, props: HandPressableProps, context: TargetContext | null) {
  const disabled = !!props.disabled || props.accessibilityState?.disabled === true || context?.enabled === false;
  const identity = JSON.stringify([context?.identity, props.handTargetKey, props.accessibilityLabel, props.accessibilityState]);
  const layer = context?.layer ?? '';
  if (target.identity !== identity || target.disabled !== disabled || target.layer !== layer || !!target.press !== !!props.onPress || target.clip !== context?.clip || target.exclude !== props.handExclude) target.revision++;
  target.press = props.onPress;
  target.disabled = disabled;
  target.layer = layer;
  target.identity = identity;
  target.clip = context?.clip;
  target.exclude = props.handExclude;
}
export function useHandTarget(props: HandPressableProps, forwarded: React.ForwardedRef<View>) {
  const context = React.useContext(HandTargetContext);
  const target = React.useRef<HandTarget>({ id: Symbol(), revision: 0, layer: '', view: null, disabled: true });
  const ref = React.useCallback((view: View | null) => {
    target.current.view = view;
    if (typeof forwarded === 'function') forwarded(view);
    else if (forwarded) forwarded.current = view;
  }, [forwarded]);
  const current = target.current;
  updateHandTarget(current, props, context);
  React.useLayoutEffect(() => {
    if (!context) return;
    context.registry.targets.set(current.id, current);
    return () => { context.registry.targets.delete(current.id); };
  }, [context?.registry, current]);
  return ref;
}
