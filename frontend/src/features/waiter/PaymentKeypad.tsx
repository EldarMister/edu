import { useT } from '@/lib/i18n';

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'backspace'] as const;
export type PaymentKey = (typeof KEYS)[number];

export function PaymentKeypad({ disabled, onKey, onExact }: {
  disabled: boolean;
  onKey: (key: PaymentKey) => void;
  onExact?: () => void;
}) {
  const t = useT();
  return (
    <div role="group" aria-label={t('Клавиатура ввода суммы')}
      className="w-full max-w-md">
      {onExact && (
        <button type="button" className="btn-secondary mb-3 min-h-12 w-full text-base font-medium" disabled={disabled} onClick={onExact}>
          {t('Точная сумма')}
        </button>
      )}
      <div className="grid grid-cols-3 gap-2.5 lg:gap-3">
        {KEYS.map(key => (
          <button key={key} type="button" disabled={disabled}
            aria-label={key === 'backspace' ? t('Стереть цифру') : undefined}
            className="grid h-[clamp(2.75rem,9dvh,5.75rem)] place-items-center rounded-xl border border-border bg-card text-2xl font-medium text-text-primary tabular-nums transition-colors hover:border-primary hover:text-primary disabled:opacity-50 lg:text-3xl"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onKey(key)}>
            {key === 'backspace' ? '⌫' : key}
          </button>
        ))}
      </div>
    </div>
  );
}
