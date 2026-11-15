import { Toggle } from '@/components/Toggle';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/store/theme';

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
      <Toggle ariaLabel={title} checked={theme === 'dark'} onChange={(checked) => setTheme(checked ? 'dark' : 'light')} />
    </div>
  );
}
