import { useEffect, useRef, useState } from 'react';
import { handMetrics, PinchGesture, type Point } from './gesture';
import { loadHandModel } from './model';
import { HandCameraSession, type HandStatus } from './session';
import type { HandDelegate } from './worker-types';
import './hand-control.css';
import { Toggle } from '@/components/Toggle';
import { KitchenVoiceSettings } from '../KitchenVoiceSettings';

const PREFS_KEY = 'edu-pos:hand-control:v1';
type Preferences = { sensitivity: number; delegate: HandDelegate };
type Target = { element: HTMLElement; identity: string; point: Point };
const STATUS: Record<HandStatus, string> = {
  off: 'Управление выключено', loading: 'Подключаем камеру и модель…', searching: 'Покажите руку камере',
  found: 'Рука обнаружена', paused: 'Камера остановлена. Нажмите «Возобновить»', error: 'Управление выключено',
};
function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { sensitivity: Math.max(0.75, Math.min(1.3, Number(value.sensitivity) || 1)), delegate: value.delegate === 'GPU' ? 'GPU' : 'CPU' };
  } catch { return { sensitivity: 1, delegate: 'CPU' }; }
}
function identity(element: HTMLElement) {
  return [element.dataset.handKey, element.getAttribute('aria-label'), element.textContent, element.closest('[data-order-id]')?.getAttribute('data-order-id')].join('|');
}
function enabled(element: HTMLElement) {
  return element.isConnected && !element.matches(':disabled,[aria-disabled="true"]') && !element.closest('[inert],[data-hand-ignore]') && element.getClientRects().length > 0;
}
function targetAt(scope: HTMLElement, point: Point): HTMLElement | null {
  const hit = document.elementFromPoint(point.x, point.y);
  const element = hit?.closest<HTMLElement>('button,[role="button"],input[type="checkbox"],input[type="radio"],label,summary');
  if (!element || !scope.contains(element) || !enabled(element)) return null;
  if (element instanceof HTMLLabelElement) {
    const control = element.control;
    return control instanceof HTMLElement && enabled(control) && control.matches('input[type="checkbox"],input[type="radio"]') ? control : null;
  }
  return element;
}

/** Mount once inside [data-hand-scope]. Mark the order list with [data-hand-scroll]. */
export function KitchenHandControl() {
  const root = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const session = useRef<HandCameraSession | null>(null);
  const gesture = useRef(new PinchGesture<Target>());
  const position = useRef<Point | null>(null);
  const hover = useRef<Target | null>(null);
  const lastSample = useRef(-Infinity);
  const staleTimer = useRef<ReturnType<typeof setTimeout> | undefined>();
  const [status, setStatus] = useState<HandStatus>('off');
  const [error, setError] = useState('');
  const [preferences] = useState(readPreferences);
  const preferencesRef = useRef(preferences);
  const running = status === 'loading' || status === 'searching' || status === 'found';

  function clearPointer() {
    clearTimeout(staleTimer.current);
    staleTimer.current = undefined;
    hover.current?.element.removeAttribute('data-hand-hover');
    hover.current = null;
    position.current = null;
    lastSample.current = -Infinity;
    gesture.current.reset();
    if (cursor.current) {
      cursor.current.style.opacity = '0';
      cursor.current.removeAttribute('data-pinching');
    }
  }

  useEffect(() => {
    preferencesRef.current = preferences;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(preferences)); } catch { /* Storage may be disabled. */ }
    gesture.current.reset();
  }, [preferences]);

  useEffect(() => {
    let mounted = true;
    const control = new HandCameraSession({
      createWorker: () => new Worker(new URL('./hand.worker.ts', import.meta.url), { type: 'module' }),
      loadModel: loadHandModel,
      onStatus: (next, message) => {
        if (!mounted) return;
        setStatus(next);
        if (message) setError(message);
      },
      onDiagnostics: () => {},
      onSample: (sample, now) => {
        const metrics = handMetrics(sample);
        const scope = root.current?.closest<HTMLElement>('[data-hand-scope]');
        const pointer = cursor.current;
        if (!mounted || !metrics || !scope || !pointer) { clearPointer(); return; }
        const elapsed = now - lastSample.current;
        if (elapsed > 450 && position.current) clearPointer();
        lastSample.current = now;
        clearTimeout(staleTimer.current);
        staleTimer.current = setTimeout(clearPointer, 450);

        // Hit testing follows recognition frames. CSS interpolates the cursor
        // between samples without polling the layout or DOM on animation frames.
        if (!gesture.current.locked || !position.current) {
          const bounds = scope.getBoundingClientRect();
          const left = Math.max(0, bounds.left), top = Math.max(0, bounds.top);
          const width = Math.min(window.innerWidth, bounds.right) - left;
          const height = Math.min(window.innerHeight, bounds.bottom) - top;
          const target = { x: left + metrics.point.x * Math.max(0, width - 1), y: top + metrics.point.y * Math.max(0, height - 1) };
          const point = position.current ?? target;
          const alpha = 1 - Math.exp(-Math.min(160, elapsed) / 65);
          point.x += (target.x - point.x) * alpha;
          point.y += (target.y - point.y) * alpha;
          position.current = point;
          const element = targetAt(scope, point);
          if (hover.current?.element !== element) {
            hover.current?.element.removeAttribute('data-hand-hover');
            element?.setAttribute('data-hand-hover', 'true');
          }
          hover.current = element ? { element, identity: identity(element), point: { ...point } } : null;
        }
        const clicked = gesture.current.update(metrics.pinch, now, hover.current, preferencesRef.current.sensitivity);
        pointer.dataset.pinching = String(gesture.current.locked);
        pointer.style.opacity = '1';
        const point = position.current;
        pointer.style.transform = `translate3d(${point.x - 15}px,${point.y - 15}px,0)`;
        // Revalidate after the entire gesture: cancellation/realtime updates may have changed the target.
        if (clicked && enabled(clicked.element) && identity(clicked.element) === clicked.identity && targetAt(scope, clicked.point) === clicked.element) {
          clicked.element.click();
        }
      },
    });
    session.current = control;
    const pause = () => {
      if (document.visibilityState === 'hidden') control.pause();
    };
    const pageHide = () => control.pause();
    const geometryChanged = () => clearPointer();
    document.addEventListener('visibilitychange', pause);
    window.addEventListener('pagehide', pageHide);
    window.addEventListener('resize', geometryChanged);
    window.addEventListener('orientationchange', geometryChanged);
    document.addEventListener('scroll', geometryChanged, true);
    return () => {
      mounted = false;
      control.stop();
      session.current = null;
      clearPointer();
      document.removeEventListener('visibilitychange', pause);
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('resize', geometryChanged);
      window.removeEventListener('orientationchange', geometryChanged);
      document.removeEventListener('scroll', geometryChanged, true);
    };
  }, []);

  function start() {
    setError('');
    void session.current?.start(preferences.delegate);
  }
  function toggle() {
    if (running) { session.current?.stop(); return; }
    start();
  }

  return (
    <div ref={root} className="hand-control">
      <KitchenVoiceSettings handControl={
        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between gap-4 py-2">
            <span className="font-medium text-text-primary">Управление рукой</span>
            <Toggle ariaLabel="Управление рукой" checked={running} onChange={toggle} />
          </div>
          {(running || status === 'paused') && <p className="mt-1 text-xs text-text-muted" role="status">{status === 'paused' ? 'Камера остановлена. Включите тумблер для продолжения.' : STATUS[status]}</p>}
          {error && <p className="mt-1 text-xs text-danger" role="alert">{error}</p>}
        </div>
      } />
      <div ref={cursor} className="hand-control-cursor" aria-hidden="true" />
    </div>
  );
}
