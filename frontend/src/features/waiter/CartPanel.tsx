import type { TableItem } from '@/types';
import { useCart, cartTotals } from './cart';
import { displayOrderNumber, hallSuffix, money } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Spinner } from '@/components/Spinner';
import { NumberTicker } from '@/components/NumberTicker';
import { CartLinesList, TakeawaySwitch } from './CartItems';

export function CartPanel({
  table,
  hallName,
  mode,
  orderNumber,
  submitting,
  canSubmit,
  sendLabel,
  onSubmit,
  onBlockedSubmit,
  onCancelEdit,
}: {
  table: TableItem;
  hallName?: string;
  mode: 'create' | 'add' | 'edit';
  orderNumber?: string;
  submitting: boolean;
  canSubmit: boolean;
  /** Подпись кнопки отправки нового заказа («Отправить на кухню» / «в бар» / «Добавить в заказ»). */
  sendLabel: string;
  onSubmit: () => void;
  onBlockedSubmit: () => void;
  onCancelEdit?: () => void;
}) {
  const t = useT();
  const { lines, comment, inc, dec, setComment, setLineTakeaway, setAllTakeaway, clear } = useCart();
  const totals = cartTotals(lines);
  const hasLines = lines.length > 0;
  const allTakeaway = hasLines && lines.every((l) => l.takeaway);
  const canSend = hasLines && canSubmit && !submitting;
  const isBlockedByShift = hasLines && !canSubmit;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border pb-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            {mode === 'edit'
              ? `${t('Редактирование')} ${displayOrderNumber(orderNumber ?? '')}`
              : mode === 'add'
                ? `${t('Добавление в')} ${displayOrderNumber(orderNumber ?? '')}`
                : t('Новый заказ')}
          </h2>
          <p className="mt-0.5 text-sm text-text-muted">{t('Стол')} {table.number}{hallSuffix({ hall: hallName ? { name: hallName } : null })}</p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {hasLines && <TakeawaySwitch on={allTakeaway} onChange={setAllTakeaway} />}
          {mode === 'edit' && onCancelEdit && (
            <button
              onClick={onCancelEdit}
              className="text-sm font-medium text-text-muted hover:text-text-secondary"
            >
              {t('Отмена')}
            </button>
          )}
        </div>
      </div>

      {/* Позиции — компактный список как в мобильной корзине */}
      <div className="no-scrollbar flex-1 overflow-y-auto py-3">
        {hasLines ? (
          <CartLinesList lines={lines} inc={inc} dec={dec} onToggleTakeaway={setLineTakeaway} priceWidth="w-[88px]" />
        ) : (
          <p className="py-10 text-center text-sm text-text-muted">
            {t('Выберите блюда из меню, чтобы добавить в заказ')}
          </p>
        )}
      </div>

      {/* Низ: общий комментарий + итоги + кнопки */}
      <div className="border-t border-border pt-3">
        <input
          className="input mb-3 h-10 text-sm"
          placeholder={t('Комментарий к заказу')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />

        <div className="space-y-1 text-sm">
          {totals.discount > 0 && (
            <Row label={t('Сумма')} value={money(totals.total)} />
          )}
          {totals.discount > 0 && (
            <Row label={t('Скидка')} value={`−${money(totals.discount)}`} valueClass="text-success" />
          )}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[15px] font-medium text-text-secondary">{t('Итого')}</span>
            <NumberTicker value={totals.final} className="text-xl font-semibold text-text-primary" />
          </div>
        </div>

        <button
          className={`${canSend ? 'btn-primary' : 'btn-secondary'} btn-lg mt-3 w-full font-semibold ${
            isBlockedByShift ? 'cursor-not-allowed opacity-60' : ''
          }`}
          disabled={!hasLines || submitting}
          aria-disabled={!canSend}
          onClick={() => {
            if (!canSubmit) {
              onBlockedSubmit();
              return;
            }
            onSubmit();
          }}
        >
          {submitting ? (
            <Spinner />
          ) : mode === 'edit' ? (
            t('Сохранить изменения')
          ) : mode === 'add' ? (
            `${t('Добавить к заказу')} · ${totals.count} ${t('шт')}.`
          ) : (
            sendLabel
          )}
        </button>

        {hasLines && (
          <button
            className="mt-2 h-9 w-full text-sm font-medium text-primary hover:underline"
            onClick={() => clear()}
          >
            {t('Очистить')}
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-muted">{label}</span>
      <span className={valueClass || 'text-text-secondary'}>{value}</span>
    </div>
  );
}
