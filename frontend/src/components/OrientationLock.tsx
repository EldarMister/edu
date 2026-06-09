import { type ReactNode } from 'react';

type OrientationLockProps = {
  children: ReactNode;
  className: string;
  lock: 'portrait' | 'landscape';
};

/**
 * Обёртка для маршрутов. Ориентация следует системному автоповороту.
 * Принудительная блокировка через JS API убрана — она конфликтовала с
 * манифестом и не работала надёжно на всех устройствах.
 */
export function OrientationLock({ children, className }: OrientationLockProps) {
  return (
    <div className={className}>
      <div className="orientation-content">{children}</div>
    </div>
  );
}
