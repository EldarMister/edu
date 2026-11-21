import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Toggle } from '@/components/Toggle';
import './kitchen-tap-feedback.css';

const storageKey = 'edu-pos:kitchen:show-taps';
const preferenceEvent = 'edu-pos:kitchen:show-taps-changed';
let preference = true;

function readPreference() {
  try { preference = localStorage.getItem(storageKey) !== 'false'; }
  catch { /* Retain the current preference if storage is unavailable. */ }
  return preference;
}

function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(preferenceEvent, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(preferenceEvent, listener);
  };
}

export function KitchenTapFeedbackSetting() {
  const enabled = useSyncExternalStore(subscribe, readPreference, () => true);
  return <section className="card px-4 py-3 sm:px-6">
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="font-medium text-text-primary">Показывать нажатия</span>
      <Toggle ariaLabel="Показывать нажатия" checked={enabled} onChange={(value) => {
        preference = value;
        try { localStorage.setItem(storageKey, String(value)); } catch { /* Storage may be disabled. */ }
        window.dispatchEvent(new Event(preferenceEvent));
      }} />
    </div>
  </section>;
}

export function KitchenTapFeedback() {
  const enabled = useSyncExternalStore(subscribe, readPreference, () => true);
  const [point, setPoint] = useState<{ x: number; y: number; id: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const show = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)
        || !event.target.closest('[data-hand-scope]')) return;
      setPoint({ x: event.clientX, y: event.clientY, id: event.timeStamp });
    };
    document.addEventListener('pointerdown', show, true);
    return () => document.removeEventListener('pointerdown', show, true);
  }, [enabled]);
  useEffect(() => {
    if (!point) return;
    const timeout = window.setTimeout(() => setPoint(null), 480);
    return () => window.clearTimeout(timeout);
  }, [point]);
  if (!enabled || !point) return null;
  return createPortal(<span key={point.id} aria-hidden="true" className="kitchen-tap-feedback"
    style={{ left: point.x, top: point.y }} />, document.body);
}
