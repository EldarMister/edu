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
      className="self-start rounded-xl border border-border bg-background p-3">
      {onExact && (
        <button type="button" className="btn-secondary btn-md mb-2 w-full" disabled={disabled} onClick={onExact}>
          {t('Точная сумма')}
        </button>
      )}
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map(key => (
          <button key={key} type="button" disabled={disabled}
            aria-label={key === 'backspace' ? t('Стереть цифру') : undefined}
            className="grid h-12 place-items-center rounded-lg border border-border bg-card text-xl font-semibold text-text-primary tabular-nums transition-colors hover:border-primary hover:text-primary disabled:opacity-50 lg:h-14"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onKey(key)}>
            {key === 'backspace' ? '⌫' : key}
          </button>
        ))}
      </div>
    </div>
  );
}
