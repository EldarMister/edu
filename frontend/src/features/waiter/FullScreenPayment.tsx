import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { IconCard, IconCash, IconQr } from '@/features/admin/components/icons';
import { displayOrderNumber, money, orderPlaceLabel } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { Order } from '@/types';
import { PaymentKeypad, type PaymentKey } from './PaymentKeypad';
import { normalizeAmount, quickCashAmounts, tenderTotals, type TenderAmounts, type TenderMethod } from './paymentAmounts';

const METHODS = [
  { value: 'cash', label: 'Наличные', Icon: IconCash },
  { value: 'card', label: 'Карта', Icon: IconCard },
  { value: 'qr', label: 'QR-код', Icon: IconQr },
] as const;
const EMPTY = { cash: '', card: '', qr: '' };

export function FullScreenPayment({ order, enabled, qrConfigured, allItemsServed, open, busy, error,
  splitOpen, onClose, onSplit, onConfirm }: {
  order: Order;
  enabled: readonly string[];
  qrConfigured: boolean;
  allItemsServed: boolean;
  open: boolean;
  busy: boolean;
  error: string;
  splitOpen: boolean;
  onClose: () => void;
  onSplit: () => void;
  onConfirm: (amounts: TenderAmounts, active: TenderMethod) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(EMPTY);
  const [active, setActive] = useState<TenderMethod>();
  const replaceAmount = useRef(true);
  const splitTrigger = useRef<HTMLButtonElement>(null);
  const prevSplitOpen = useRef(false);
  const total = Number(order.finalAmount);
  const methods = METHODS.filter(({ value }) => enabled.includes(value));
  const selected = active && enabled.includes(active) ? active : undefined;
  const entered = {
    cash: enabled.includes('cash') ? Number(draft.cash) || 0 : 0,
    card: enabled.includes('card') ? Number(draft.card) || 0 : 0,
    qr: enabled.includes('qr') ? Number(draft.qr) || 0 : 0,
  };
  const { amounts, remaining, change, over } = tenderTotals(total, entered);
  const showQrWarning = !qrConfigured && (selected === 'qr' || entered.qr > 0);
  const qrMissing = !qrConfigured && (entered.qr > 0 || (total === 0 && selected === 'qr'));
  const cashDue = amounts.cash + remaining;
  const cashPresets = enabled.includes('cash') ? quickCashAmounts(cashDue) : [];
  const canConfirm = selected && allItemsServed && !busy && !remaining && !over && !qrMissing;

  useEffect(() => {
    if (prevSplitOpen.current && !splitOpen) splitTrigger.current?.focus({ preventScroll: true });
    prevSplitOpen.current = splitOpen;
  }, [splitOpen]);

  function focusTender(method: TenderMethod) {
    setActive(method);
    replaceAmount.current = true;
  }

  function activate(method: TenderMethod) {
    if (entered[method] > 0) return;
    replaceAmount.current = true;

    if (remaining > 0) {
      setDraft((current) => ({ ...current, [method]: String(remaining) }));
    } else if (METHODS.filter(({ value }) => entered[value] > 0).length === 1 && !over) {
      // Переключение единственного способа оплаты, пока кассир не разделил сумму.
      setDraft({ ...EMPTY, [method]: String(total) });
    }
  }

  function changeAmount(method: TenderMethod, value: string) {
    const next = normalizeAmount(value);
    if (next === null) return;
    setDraft((current) => ({ ...current, [method]: next }));
    replaceAmount.current = false;
  }

  function pressKey(key: PaymentKey) {
    if (!selected) return;
    if (key === 'clear') {
      changeAmount(selected, '');
      return;
    }
    const value = draft[selected];
    if (key === 'backspace') {
      changeAmount(selected, value.slice(0, -1));
      return;
    }
    const base = replaceAmount.current || (value === '0' && key !== '.') ? '' : value;
    changeAmount(selected, base + key);
  }

  function applyCashPreset(amount: number) {
    setActive('cash');
    changeAmount('cash', String(amount));
    replaceAmount.current = true;
  }

  function exactAmount() {
    if (!selected) return;
    const other = METHODS.reduce((sum, { value }) => value === selected ? sum : sum + Math.round(entered[value] * 100), 0);
    changeAmount(selected, String(Math.max(0, Math.round(total * 100) - other) / 100));
    replaceAmount.current = true;
  }

  return (
    <Modal open={open} fullScreen title={`${t('Оплата заказа')} · ${displayOrderNumber(order.orderNumber)}`}
      onClose={() => { if (!busy && !splitOpen) onClose(); }}>
      <div className="grid min-h-full grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <aside className="flex justify-center border-r border-border bg-background p-4 min-[900px]:p-7 xl:p-10">
          <PaymentKeypad disabled={busy || !selected} onKey={pressKey} onExact={exactAmount}
            cashPresets={cashPresets} cashPresetsDisabled={busy || (selected !== undefined && selected !== 'cash')}
            onCashPreset={applyCashPreset} />
        </aside>
        <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5 p-5 min-[900px]:p-8 xl:p-10">
          <div>
            <p className="text-sm text-text-muted">{orderPlaceLabel(order, t)}</p>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-lg font-medium text-text-secondary">{t('К оплате')}</h3>
              <p className="text-3xl font-semibold tabular-nums text-text-primary xl:text-4xl">{money(total)}</p>
            </div>
          </div>

          {!allItemsServed && <p role="alert" className="rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">
            {t('Нельзя принять оплату: есть неподанные блюда.')}
          </p>}

          {methods.length > 0 ? <fieldset disabled={busy} className="min-w-0">
            <legend className="mb-2 text-sm font-medium text-text-secondary">{t('Способ оплаты')}</legend>
            <div className="grid gap-2">
              {methods.map(({ value, label, Icon }) => (
                <label key={value}
                  className={`grid min-h-14 cursor-text grid-cols-[minmax(0,1fr)_minmax(5.5rem,40%)] items-center gap-x-3 rounded-xl border px-3 py-2 transition-colors min-[900px]:px-4 ${
                    selected === value ? 'border-primary bg-primary/5 ring-1 ring-inset ring-primary/30' : 'border-border hover:bg-background'
                  }`}>
                  <span className="flex min-w-0 items-center gap-3 font-medium text-text-primary">
                    <span aria-hidden="true" className={`shrink-0 ${selected === value ? 'text-primary' : 'text-text-muted'}`}><Icon /></span>
                    <span className="break-words">{t(label)}</span>
                  </span>
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <input aria-label={t(label)} type="text" inputMode="none"
                      className="w-full min-w-0 bg-transparent py-1 text-right text-xl font-semibold tabular-nums text-text-primary outline-none placeholder:text-text-light lg:text-2xl"
                      value={draft[value]} placeholder="0" onFocus={() => focusTender(value)}
                      onClick={() => activate(value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') activate(value); }}
                      onChange={(event) => changeAmount(value, event.target.value)} />
                    <span aria-hidden="true" className="text-sm text-text-muted">с</span>
                  </span>
                  {value === 'cash' && <span className="col-span-2 text-right text-sm text-text-secondary" aria-live="polite">
                    {!over && change > 0 && `${t('Сдача')} ${money(change)}`}
                  </span>}
                </label>
              ))}
            </div>
          </fieldset> : <p role="alert" className="text-sm text-warning">{t('Нет доступных способов оплаты')}</p>}

          {showQrWarning && <p role="alert" className="text-sm text-warning">
            {t('QR-код не загружен. Добавьте его в настройках или выберите другой способ оплаты.')}
          </p>}

          <div className="space-y-2 border-t border-border pt-4 text-sm" aria-live="polite">
            {over ? <p className="text-danger">{t('Сумма превышает итог заказа')}</p> : (
              <div className="flex justify-between gap-3">
                <span className="text-text-muted">{t('Осталось к оплате')}</span>
                <span className="font-medium text-text-primary">{money(remaining)}</span>
              </div>
            )}
            {error && <p role="alert" className="text-danger">{error}</p>}
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <button ref={splitTrigger} type="button" className="btn-secondary btn-lg grow whitespace-nowrap"
              disabled={busy || !allItemsServed || !methods.length || total <= 0} onClick={onSplit}>
              {t('Разделить счёт')}
            </button>
            <button type="button" className="btn-primary btn-lg grow font-semibold"
              disabled={!canConfirm} onClick={() => { if (canConfirm) onConfirm(amounts, selected); }}>
              {busy ? <Spinner /> : t('Принять оплату')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
