export type ShiftAnimState = 'idle' | 'loading' | 'success';

const SIZE = 220; // диаметр зоны анимации / кольца загрузки
const SUCCESS = 132; // круг успеха
const STROKE = 5; // толщина кольца прогресса
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/**
 * Центральная анимация старта смены (строго по референсу /designe «Смена не начата»):
 * idle — логотип EP (прозрачный фон) внутри мягко пульсирующего круга;
 * loading — круговой индикатор заполняется по часовой стрелке;
 * success — белая галочка в синем круге.
 */
export function ShiftStartAnimation({ state }: { state: ShiftAnimState }) {
  const isSuccess = state === 'success';
  const dashOffset = state === 'loading' ? C * 0.08 : C;

  return (
    <div className="relative flex items-center justify-center" style={{ width: SIZE, height: SIZE }}>
      {/* Фоновая пульсация — круг: статичная подложка, дышащее свечение и расходящиеся кольца. */}
      {!isSuccess && (
        <>
          <div className="absolute rounded-full bg-primary/5" style={{ width: SIZE * 0.82, height: SIZE * 0.82 }} />
          <div
            className="animate-shift-glow absolute rounded-full bg-primary/20 blur-2xl"
            style={{ width: SIZE * 0.7, height: SIZE * 0.7 }}
          />
          <div className="animate-shift-ripple absolute rounded-full border border-primary/25" style={{ width: SIZE, height: SIZE }} />
          <div
            className="animate-shift-ripple absolute rounded-full border border-primary/20"
            style={{ width: SIZE, height: SIZE, animationDelay: '0.9s' }}
          />
          <div
            className="animate-shift-ripple absolute rounded-full border border-primary/15"
            style={{ width: SIZE, height: SIZE, animationDelay: '1.8s' }}
          />
        </>
      )}

      {/* Круговой индикатор загрузки (старт сверху, по часовой стрелке) */}
      <svg
        width={SIZE}
        height={SIZE}
        className="absolute -rotate-90 transition-opacity duration-200"
        style={{ opacity: state === 'loading' ? 1 : 0 }}
      >
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke="rgba(0,91,255,0.12)" strokeWidth={STROKE} fill="none" />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke="#005BFF"
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={C}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 1100ms cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>

      {/* Логотип EP с прозрачным фоном — внутри круга пульсации */}
      <img
        src="/ep-mark.png?v=edu-pos"
        alt="EDU POS"
        className="animate-shift-logo-in relative object-contain transition-opacity duration-200"
        style={{ width: SIZE * 0.5, opacity: isSuccess ? 0 : 1 }}
      />

      {/* Успех: галочка в синем круге */}
      {isSuccess && (
        <div
          className="animate-shift-check-pop absolute flex items-center justify-center rounded-full bg-primary"
          style={{ width: SUCCESS, height: SUCCESS }}
        >
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
            <path d="M6 12.5 L10 16.5 L18 8" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
  );
}
