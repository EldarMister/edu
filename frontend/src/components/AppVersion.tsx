import { APP_VERSION_LABEL } from '@/lib/version';

/** Версия сборки приложения — мелким серым текстом. */
export function AppVersion({ className = '' }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-text-light ${className}`} title={APP_VERSION_LABEL}>
      {APP_VERSION_LABEL}
    </p>
  );
}
