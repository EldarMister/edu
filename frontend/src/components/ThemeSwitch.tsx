import { useT } from '@/lib/i18n';
import { useTheme } from '@/store/theme';
import './theme-switch.css';

export function ThemeSwitch() {
  const t = useT();
  const theme = useTheme((state) => state.theme);
  const setTheme = useTheme((state) => state.setTheme);
  const title = t('Тёмная тема');

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        <p className="text-xs text-text-muted">{t('На этом устройстве')}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-label={title}
        aria-checked={theme === 'dark'}
        className="theme-switch"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        <span aria-hidden="true" className="theme-switch-sky">
          <span className="theme-switch-stars" />
          <span className="theme-switch-cloud" />
          <span className="theme-switch-orb" />
        </span>
      </button>
    </div>
  );
}
