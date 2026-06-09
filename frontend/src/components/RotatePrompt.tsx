import { useEffect, useState } from 'react';

/**
 * Показывает оверлей «Поверните устройство» когда кухонный экран
 * оказался в портретной ориентации (JS-блокировка не сработала).
 *
 * Используется только внутри кухонного маршрута.
 */
export function RotatePrompt() {
  const [isPortrait, setIsPortrait] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerHeight > window.innerWidth;
  });

  useEffect(() => {
    const check = () => {
      setIsPortrait(window.innerHeight > window.innerWidth);
    };

    // screen.orientation — предпочтительный способ
    if (screen?.orientation) {
      screen.orientation.addEventListener('change', check);
    }
    window.addEventListener('resize', check);
    check();

    return () => {
      screen?.orientation?.removeEventListener?.('change', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  if (!isPortrait) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '20px',
        background: '#0f172a',
        color: '#f1f5f9',
      }}
    >
      {/* Иконка поворота */}
      <svg
        width="72"
        height="72"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#38bdf8"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ animation: 'rotate-hint 2s ease-in-out infinite' }}
      >
        <rect x="4" y="2" width="10" height="16" rx="2" />
        <path d="M17 7l3 3-3 3" />
        <path d="M20 10H9" />
      </svg>

      <style>{`
        @keyframes rotate-hint {
          0%, 100% { transform: rotate(0deg); }
          40%       { transform: rotate(90deg); }
          60%       { transform: rotate(90deg); }
        }
      `}</style>

      <p
        style={{
          fontSize: '18px',
          fontWeight: 600,
          margin: 0,
          textAlign: 'center',
        }}
      >
        Поверните устройство
      </p>
      <p
        style={{
          fontSize: '14px',
          color: '#94a3b8',
          margin: 0,
          textAlign: 'center',
          maxWidth: '240px',
          lineHeight: 1.5,
        }}
      >
        Экран кухни работает в горизонтальном режиме
      </p>
    </div>
  );
}
