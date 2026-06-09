import { useEffect, type ReactNode } from 'react';
import orientationService from '@/services/orientationService';

type OrientationLockProps = {
  children: ReactNode;
  className: string;
  lock: 'portrait' | 'landscape';
};

export function OrientationLock({ children, className, lock }: OrientationLockProps) {
  useEffect(() => {
    void orientationService.lock(lock);

    return () => {
      orientationService.unlock();
    };
  }, [lock]);

  return (
    <div className={className}>
      <div className="orientation-content">{children}</div>
    </div>
  );
}
