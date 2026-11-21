import { money } from '@/lib/format';
import { useT } from '@/lib/i18n';

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'backspace'] as const;
export type PaymentKey = (typeof KEYS)[number] | 'clear';

export function PaymentKeypad({ disabled, onKey, onExact, cashPresets, cashPresetsDisabled, onCashPreset }: {
  disabled: boolean;
  onKey: (key: PaymentKey) => void;
  onExact: () => void;
  cashPresets: readonly number[];
  cashPresetsDisabled: boolean;
  onCashPreset: (amount: number) => void;
}) {
  const t = useT();
  return (
    <div role="group" aria-label={t('Клавиатура ввода суммы')}
      className="w-full max-w-2xl">
      {cashPresets.length > 0 && <div role="group" aria-label={t('Быстрые суммы наличными')} className="mb-2.5 grid grid-cols-2 gap-2.5 lg:mb-3 lg:gap-3">
        {cashPresets.map((amount) => <button key={amount} type="button"
          className="btn-secondary flex h-[clamp(3.125rem,12dvh,8rem)] items-center justify-center rounded-xl px-1 text-xl font-semibold tabular-nums lg:text-3xl"
          disabled={cashPresetsDisabled} onPointerDown={(event) => event.preventDefault()} onClick={() => onCashPreset(amount)}>
          {money(amount)}
        </button>)}
      </div>}
      <div className="grid grid-cols-3 gap-2.5 lg:gap-3">
        {KEYS.map(key => (
          <button key={key} type="button" disabled={disabled}
            aria-label={key === 'backspace' ? t('Стереть цифру') : undefined}
            className="grid h-[clamp(3.125rem,12dvh,8rem)] place-items-center rounded-xl border border-border bg-card text-2xl font-medium text-text-primary tabular-nums transition-colors hover:border-primary hover:text-primary disabled:opacity-50 lg:text-4xl"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onKey(key)}>
            {key === 'backspace' ? '⌫' : key}
          </button>
        ))}
        <button type="button" className="btn-secondary col-span-2 h-[clamp(3.5rem,10dvh,5rem)] text-lg font-semibold lg:text-xl"
          disabled={disabled} onPointerDown={(event) => event.preventDefault()} onClick={onExact}>
          {t('Точная сумма')}
        </button>
        <button type="button" className="btn-secondary h-[clamp(3.5rem,10dvh,5rem)] text-2xl lg:text-3xl"
          aria-label={t('Очистить сумму')} disabled={disabled}
          onPointerDown={(event) => event.preventDefault()} onClick={() => onKey('clear')}>
          C
        </button>
      </div>
    </div>
  );
}
