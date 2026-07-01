import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { useStartShift } from './api';

type Phase = 'idle' | 'loading' | 'success';

/** Тайминги — как в mobile ShiftRequiredScreen (референс designe/Смена не начата). */
const MIN_LOADING_MS = 1450;
const SUCCESS_HOLD_MS = 680;
const FADE_MS = 260;

/** Размер кругового индикатора загрузки. */
const RING_SIZE = 132;
const RING_STROKE = 4;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

const TEXT: Record<Phase, { title: string; subtitle: string }> = {
  idle: { title: 'Смена не начата', subtitle: 'Начните смену, чтобы принимать заказы.' },
  loading: { title: 'Проверяем данные…', subtitle: 'Это займёт несколько секунд' },
  success: { title: 'Смена начата', subtitle: '' },
};

/**
 * Экран «Смена не начата» (по референсу designe/Смена не начата):
 * idle — логотип EP + мягкая пульсация фона (размытые круги «дышат»);
 * loading — круговой индикатор заполняется по часовой стрелке;
 * success — галочка в синем круге, затем плавный переход в раздел.
 * onBusyChange(true) — запуск пошёл: родитель удерживает оверлей до конца анимации.
 */
export function ShiftGate({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const t = useT();
  const push = useNotifications((s) => s.push);
  const startShift = useStartShift();
  const [phase, setPhase] = useState<Phase>('idle');
  const [fadingOut, setFadingOut] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    },
    [],
  );

  // Успех: показать галочку, выдержать паузу и плавно убрать экран.
  useEffect(() => {
    if (phase !== 'success') return;
    const hold = setTimeout(() => setFadingOut(true), SUCCESS_HOLD_MS);
    return () => clearTimeout(hold);
  }, [phase]);

  useEffect(() => {
    if (!fadingOut) return;
    const done = setTimeout(() => onBusyChange(false), FADE_MS);
    return () => clearTimeout(done);
  }, [fadingOut, onBusyChange]);

  function onStart() {
    if (phase !== 'idle') return;
    onBusyChange(true);
    setPhase('loading');
    const startedAt = Date.now();
    startShift.mutate(undefined, {
      onSuccess: () => {
        const remaining = Math.max(MIN_LOADING_MS - (Date.now() - startedAt), 0);
        successTimerRef.current = setTimeout(() => {
          successTimerRef.current = null;
          setPhase('success');
        }, remaining);
      },
      onError: (err) => {
        if (successTimerRef.current) {
          clearTimeout(successTimerRef.current);
          successTimerRef.current = null;
        }
        setPhase('idle');
        onBusyChange(false);
        push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
      },
    });
  }

  const { title, subtitle } = TEXT[phase];

  return (
    <div
      className="flex h-full flex-col bg-white transition-opacity"
      style={{ opacity: fadingOut ? 0 : 1, transitionDuration: `${FADE_MS}ms` }}
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8">
        {/* Зона анимации: пульсирующее свечение + плитка логотипа / индикатор / успех */}
        <div className="relative flex h-[220px] w-[220px] items-center justify-center">
          {phase !== 'success' && (
            <div className="shift-halo" aria-hidden>
              <span className="shift-halo-ring shift-halo-ring-outer" />
              <span className="shift-halo-ring shift-halo-ring-mid" />
              <span className="shift-halo-glow" />
            </div>
          )}

          {/* Круговой индикатор загрузки (по часовой стрелке, старт сверху) */}
          <div
            className={`absolute -rotate-90 transition-opacity duration-200 ${
              phase === 'loading' ? 'opacity-100' : 'opacity-0'
            }`}
            aria-hidden
          >
            <svg width={RING_SIZE} height={RING_SIZE}>
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_R}
                stroke="rgba(0, 91, 255, 0.12)"
                strokeWidth={RING_STROKE}
                fill="none"
              />
              {phase === 'loading' && (
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_R}
                  stroke="#005BFF"
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={RING_C}
                  strokeDashoffset={RING_C}
                  className="animate-shift-ring-fill"
                />
              )}
            </svg>
          </div>

          {/* Плитка с логотипом EP (появляется с лёгким масштабированием) */}
          {phase !== 'success' && (
            <div className="animate-card-pop relative flex h-24 w-24 items-center justify-center rounded-[22px] border border-border bg-white shadow-card">
              <img src="/ep-mark.png" alt="EDU POS" className="h-[38px] w-[60px] object-contain" />
            </div>
          )}

          {/* Успех: белая галочка в синем круге */}
          {phase === 'success' && (
            <div className="animate-check-pop relative flex h-24 w-24 items-center justify-center rounded-full bg-primary">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 12.5 10 16.5 18 8" />
              </svg>
            </div>
          )}
        </div>

        <h2 className="mt-8 text-center text-[22px] font-bold text-text-primary">{t(title)}</h2>
        {subtitle && <p className="mt-2 text-center text-[15px] leading-6 text-text-muted">{t(subtitle)}</p>}
      </div>

      <div className="mx-auto w-full max-w-sm shrink-0 px-4 pb-6" style={{ minHeight: 48 + 24 }}>
        {phase === 'idle' && (
          <button className="btn-primary btn-lg w-full font-semibold" onClick={onStart}>
            {t('Начать смену')}
          </button>
        )}
      </div>
    </div>
  );
}
