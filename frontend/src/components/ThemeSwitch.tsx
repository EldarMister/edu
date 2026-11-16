import { useT } from '@/lib/i18n';
import { useTheme } from '@/store/theme';
import './theme-switch.css';

export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const theme = useTheme((state) => state.theme);
  const setTheme = useTheme((state) => state.setTheme);
  const title = t('Тема');

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium text-text-primary">{title}</span>
      <button
        type="button"
        role="switch"
        aria-label={title}
        aria-checked={theme === 'dark'}
        className={compact ? 'theme-switch theme-switch--compact' : 'theme-switch'}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        <span aria-hidden="true" className="theme-switch-sky">
          <span className="theme-switch-star theme-switch-star--first" />
          <span className="theme-switch-star theme-switch-star--second" />
          <span className="theme-switch-star theme-switch-star--third" />
          <svg viewBox="0 0 16 16" className="theme-switch-cloud">
            <path transform="matrix(.77976 0 0 .78395 -299.99 -418.63)" fill="#fff"
              d="m391.84 540.91c-.421-.329-.949-.524-1.523-.524-1.351 0-2.451 1.084-2.485 2.435-1.395.526-2.388 1.88-2.388 3.466 0 1.874 1.385 3.423 3.182 3.667v.034h12.73v-.006c1.775-.104 3.182-1.584 3.182-3.395 0-1.747-1.309-3.186-2.994-3.379.007-.106.011-.214.011-.322 0-2.707-2.271-4.901-5.072-4.901-2.073 0-3.856 1.202-4.643 2.925" />
          </svg>
        </span>
      </button>
    </div>
  );
}
