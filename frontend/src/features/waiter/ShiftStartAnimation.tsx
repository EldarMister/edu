export type ShiftAnimState = 'idle' | 'loading' | 'success';

const SIZE = 132; // диаметр зоны анимации
const TILE = 84; // плитка с логотипом / круг успеха
const STROKE = 4; // толщина кольца прогресса
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/**
 * Центральная анимация старта смены (строго по референсу /designe «Смена не начата»):
 * idle — логотип EP + мягкая пульсация фона;
 * loading — круговой индикатор заполняется по часовой стрелке;
 * success — белая галочка в синем круге.
 */
export function ShiftStartAnimation({ state }: { state: ShiftAnimState }) {
  const isSuccess = state === 'success';
  // В loading кольцо заполнено почти полностью; смещение анимируется через CSS-transition.
  const dashOffset = state === 'loading' ? C * 0.08 : C;

  return (
    <div className="relative flex items-center justify-center" style={{ width: SIZE, height: SIZE }}>
      {/* Мягкое статичное свечение */}
      <div
        className="absolute rounded-full bg-primary/5"
        style={{ width: SIZE, height: SIZE }}
      />

      {/* Пульсация фона (скрыта при успехе) */}
      {!isSuccess && (
        <div
          className="animate-shift-halo-pulse absolute rounded-full border-2 border-primary/15"
          style={{ width: SIZE * 0.92, height: SIZE * 0.92 }}
        />
      )}

      <div
        className="animate-shift-logo-in relative flex items-center justify-center"
        style={{ width: SIZE, height: SIZE }}
      >
        {/* Круговой индикатор загрузки (старт сверху, по часовой стрелке) */}
        <svg
          width={SIZE}
          height={SIZE}
          className="absolute -rotate-90 transition-opacity duration-200"
          style={{ opacity: state === 'loading' ? 1 : 0 }}
        >
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke="rgba(0,91,255,0.15)" strokeWidth={STROKE} fill="none" />
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

        {/* Плитка с логотипом EP */}
        <div
          className="flex items-center justify-center rounded-[22px] border border-border bg-white shadow-card transition-opacity duration-200"
          style={{ width: TILE, height: TILE, opacity: isSuccess ? 0 : 1 }}
        >
          <img src="/edupos.png?v=edu-pos" alt="EDU POS" className="h-9 w-auto object-contain" />
        </div>

        {/* Успех: галочка в синем круге */}
        {isSuccess && (
          <div
            className="animate-shift-check-pop absolute flex items-center justify-center rounded-full bg-primary"
            style={{ width: TILE, height: TILE }}
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
              <path d="M6 12.5 L10 16.5 L18 8" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
