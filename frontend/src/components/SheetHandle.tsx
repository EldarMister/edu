import { useLayoutEffect, useRef, type PointerEvent, type RefObject } from 'react';
import { useT } from '@/lib/i18n';

const SETTLE_MS = 300;

function resetMotion(node: HTMLElement) {
  delete node.dataset.sheetDrag;
  node.style.removeProperty('--sheet-drag-offset');
}

export function SheetHandle({ panel, onClose, enabled = true, className = '' }: {
  panel: RefObject<HTMLElement>;
  onClose: () => void;
  enabled?: boolean;
  className?: string;
}) {
  const t = useT();
  const timer = useRef<number>();
  const movingPanel = useRef<HTMLElement>();
  const gesture = useRef<{ id: number; y: number; offset: number; active: boolean; time: number; lastY: number; velocity: number }>();
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    return () => {
      window.clearTimeout(timer.current);
      gesture.current = undefined;
      if (movingPanel.current) resetMotion(movingPanel.current);
      movingPanel.current = undefined;
    };
  }, [panel, enabled]);

  function start(event: PointerEvent<HTMLButtonElement>) {
    const node = panel.current;
    if (!node || !enabled || !event.isPrimary || event.button !== 0) return;
    window.clearTimeout(timer.current);
    movingPanel.current = node;
    const transform = getComputedStyle(node).transform;
    const offset = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
    node.dataset.sheetDrag = 'hold';
    node.style.setProperty('--sheet-drag-offset', `${offset}px`);
    gesture.current = { id: event.pointerId, y: event.clientY, offset, active: false, time: event.timeStamp, lastY: event.clientY, velocity: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const state = gesture.current;
    const node = panel.current;
    if (!node || !state || state.id !== event.pointerId) return;
    const distance = event.clientY - state.y;
    if (!state.active && Math.abs(distance) < 8) return;
    if (event.timeStamp > state.time) state.velocity = (event.clientY - state.lastY) / (event.timeStamp - state.time);
    state.lastY = event.clientY;
    state.time = event.timeStamp;
    state.active = true;
    const offset = state.offset + distance;
    node.style.setProperty('--sheet-drag-offset', `${offset < 0 ? offset * 0.2 : offset}px`);
  }

  function finish(event: PointerEvent<HTMLButtonElement>) {
    const state = gesture.current;
    const node = panel.current;
    if (!node || !state || state.id !== event.pointerId) return;
    gesture.current = undefined;
    const distance = event.clientY - state.y;
    const height = node.offsetHeight;
    const velocity = event.timeStamp - state.time < 90 ? state.velocity : 0;
    const dismiss = event.type === 'pointerup' && state.active &&
      (distance > Math.min(120, height * 0.3) || (distance > 16 && velocity > 0.55));
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.dataset.sheetDrag = reduceMotion ? 'hold' : 'settle';
    node.style.setProperty('--sheet-drag-offset', dismiss ? '100%' : '0px');
    if (!dismiss) return;
    if (reduceMotion) close.current();
    else timer.current = window.setTimeout(() => close.current(), SETTLE_MS);
  }

  return (
    <button
      type="button"
      aria-label={t('Закрыть панель')}
      className={`flex h-7 w-full shrink-0 cursor-grab touch-none select-none items-center justify-center active:cursor-grabbing ${className}`}
      onClick={(event) => { if (enabled && event.detail === 0) close.current(); }}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    ><span aria-hidden className="h-1 w-[34px] rounded-full bg-slate-300" /></button>
  );
}
