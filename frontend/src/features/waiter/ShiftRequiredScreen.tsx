import { useEffect, useRef, useState } from 'react';
import { ShiftStartAnimation, type ShiftAnimState } from './ShiftStartAnimation';
import { useStartShift } from './api';
import { useNotifications } from '@/store/notifications';

const TEXT: Record<ShiftAnimState, { title: string; subtitle: string }> = {
  idle: { title: 'Смена не начата', subtitle: 'Чтобы принимать заказы, начните смену' },
  loading: { title: 'Проверяем данные…', subtitle: 'Это займёт несколько секунд' },
  success: { title: 'Смена начата', subtitle: '' },
};

// Минимальная длительность загрузки — чтобы кольцо успело красиво заполниться,
// даже если сервер ответил мгновенно.
const MIN_LOADING_MS = 1900;
const SUCCESS_HOLD_MS = 820;
const FADE_MS = 320;

/**
 * Экран «Смена не начата» (строго по референсу /designe, как в mobile).
 * Показывается поверх контента вкладок, пока смена не активна.
 * onBusyChange(true) — запуск пошёл: родитель удерживает оверлей, даже когда
 * смена уже стала активной, пока не доиграет анимация успеха;
 * onBusyChange(false) — оверлей можно убрать (после анимации либо при ошибке).
 */
export function ShiftRequiredScreen({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const [phase, setPhase] = useState<ShiftAnimState>('idle');
  const [visible, setVisible] = useState(true);
  const successTimerRef = useRef<number | null>(null);
  const startShift = useStartShift();
  const push = useNotifications((s) => s.push);

  useEffect(() => () => {
    if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
  }, []);

  // Успех: показать галочку, выдержать паузу и плавно убрать экран.
  useEffect(() => {
    if (phase !== 'success') return;
    const fadeAt = setTimeout(() => setVisible(false), SUCCESS_HOLD_MS);
    const done = setTimeout(() => onBusyChange(false), SUCCESS_HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(fadeAt);
      clearTimeout(done);
    };
  }, [phase, onBusyChange]);

  const onStart = () => {
    if (phase !== 'idle') return;
    onBusyChange(true);
    setPhase('loading');
    const startedAt = Date.now();
    startShift.mutate(undefined, {
      onSuccess: () => {
        const remaining = Math.max(MIN_LOADING_MS - (Date.now() - startedAt), 0);
        successTimerRef.current = window.setTimeout(() => {
          successTimerRef.current = null;
          setPhase('success');
        }, remaining);
      },
      onError: () => {
        if (successTimerRef.current) {
          window.clearTimeout(successTimerRef.current);
          successTimerRef.current = null;
        }
        setPhase('idle');
        onBusyChange(false);
        push({
          message: 'Не удалось начать смену. Попробуйте ещё раз.',
          type: 'error',
          at: new Date().toISOString(),
        });
      },
    });
  };

  const { title, subtitle } = TEXT[phase];

  return (
    <div className={`flex h-full flex-col bg-white transition-opacity ${visible ? 'opacity-100' : 'opacity-0'}`} style={{ transitionDuration: `${FADE_MS}ms` }}>
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <ShiftStartAnimation state={phase} />
        <h2 className="mt-8 text-center text-[22px] font-bold text-text-primary">{title}</h2>
        {subtitle ? (
          <p className="mt-2 max-w-[15rem] text-center text-base leading-relaxed text-text-muted">{subtitle}</p>
        ) : null}
      </div>

      <div className="px-5 pb-6 pt-2" style={{ minHeight: 72 }}>
        {phase === 'idle' && (
          <button
            onClick={onStart}
            className="btn-primary btn-lg w-full font-semibold transition-transform active:scale-[0.99]"
          >
            Начать смену
          </button>
        )}
      </div>
    </div>
  );
}
