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
  const desired = useRef<Point | null>(null);
  const position = useRef<Point | null>(null);
  const hover = useRef<Target | null>(null);
  const lastSample = useRef(-Infinity);
  const [status, setStatus] = useState<HandStatus>('off');
  const [error, setError] = useState('');
  const [preferences] = useState(readPreferences);
  const preferencesRef = useRef(preferences);
  const running = status === 'loading' || status === 'searching' || status === 'found';

  function clearPointer() {
    hover.current?.element.removeAttribute('data-hand-hover');
    hover.current = null;
    desired.current = null;
    position.current = null;
    gesture.current.reset();
    if (cursor.current) cursor.current.style.opacity = '0';
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
        if (!mounted || !metrics) { clearPointer(); return; }
        lastSample.current = performance.now();
        desired.current = metrics.point;
        const clicked = gesture.current.update(metrics.pinch, now, hover.current, preferencesRef.current.sensitivity);
        if (!clicked) return;
        const scope = root.current?.closest<HTMLElement>('[data-hand-scope]');
        // Revalidate after the entire gesture: cancellation/realtime updates may have changed the target.
        if (scope && enabled(clicked.element) && identity(clicked.element) === clicked.identity && targetAt(scope, clicked.point) === clicked.element) {
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

  useEffect(() => {
    if (!running) { clearPointer(); return; }
    let animation = 0;
    let previous = performance.now();
    const render = (now: number) => {
      animation = requestAnimationFrame(render);
      const elapsed = Math.min(50, now - previous);
      previous = now;
      const scope = root.current?.closest<HTMLElement>('[data-hand-scope]');
      if (!scope || !cursor.current || !desired.current) return;
      if (now - lastSample.current > 450) { clearPointer(); return; }
      const bounds = scope.getBoundingClientRect();
      const left = Math.max(0, bounds.left), top = Math.max(0, bounds.top);
      const width = Math.min(window.innerWidth, bounds.right) - left;
      const height = Math.min(window.innerHeight, bounds.bottom) - top;
      const target = { x: left + desired.current.x * Math.max(0, width - 1), y: top + desired.current.y * Math.max(0, height - 1) };
      if (!position.current) position.current = target;
      if (!gesture.current.locked) {
        const alpha = 1 - Math.exp(-elapsed / 65);
        position.current.x += (target.x - position.current.x) * alpha;
        position.current.y += (target.y - position.current.y) * alpha;
        const element = targetAt(scope, position.current);
        if (hover.current?.element !== element) hover.current?.element.removeAttribute('data-hand-hover');
        hover.current = element ? { element, identity: identity(element), point: { ...position.current } } : null;
        element?.setAttribute('data-hand-hover', 'true');
      }
      cursor.current.dataset.pinching = String(gesture.current.locked);
      cursor.current.style.opacity = '1';
      cursor.current.style.transform = `translate3d(${position.current.x - 15}px,${position.current.y - 15}px,0)`;
    };
    animation = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animation);
  }, [running]);

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
