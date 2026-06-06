import { useState } from 'react';
import type { TableItem } from '@/types';
import { useCart, cartTotals } from './cart';
import { displayOrderNumber, money, dishUnitPrice } from '@/lib/format';
import { Spinner } from '@/components/Spinner';

export function CartPanel({
  table,
  mode,
  orderNumber,
  submitting,
  canSubmit,
  onSubmit,
  onBlockedSubmit,
}: {
  table: TableItem;
  mode: 'create' | 'add';
  orderNumber?: string;
  submitting: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onBlockedSubmit: () => void;
}) {
  const { lines, comment, inc, dec, remove, setLineComment, setComment } = useCart();
  const totals = cartTotals(lines);
  const [commentFor, setCommentFor] = useState<string | null>(null);
  const hasLines = lines.length > 0;
  const canSend = hasLines && canSubmit && !submitting;
  const isBlockedByShift = hasLines && !canSubmit;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border pb-3">
        <h2 className="text-lg font-semibold text-text-primary">
          {mode === 'add' ? `Добавление в ${displayOrderNumber(orderNumber ?? '')}` : 'Новый заказ'}
        </h2>
        <p className="mt-0.5 text-sm text-text-muted">
          Стол {table.number}
        </p>
      </div>

      {/* Позиции */}
      <div className="no-scrollbar flex-1 space-y-3 overflow-y-auto py-3">
        {lines.length === 0 && (
          <p className="py-10 text-center text-sm text-text-muted">
            Выберите блюда из меню, чтобы добавить в заказ
          </p>
        )}
        {lines.map((l) => {
          const unit = dishUnitPrice(l.dish.price, l.dish.discountType, l.dish.discountValue);
          return (
            <div key={l.dish.id} className="rounded-xl border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-text-primary">{l.dish.name}</p>
                  <p className="text-sm text-text-muted">{money(unit)}</p>
                </div>
                <button
                  onClick={() => remove(l.dish.id)}
                  className="text-danger hover:opacity-80"
                  aria-label="Удалить"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                  </svg>
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Stepper sign="−" onClick={() => dec(l.dish.id)} />
                  <span className="w-6 text-center text-[15px] font-medium">{l.quantity}</span>
                  <Stepper sign="+" onClick={() => inc(l.dish.id)} />
                </div>
                <span className="text-[15px] font-semibold text-text-primary">
                  {money(unit * l.quantity)}
                </span>
              </div>

              {commentFor === l.dish.id || l.comment ? (
                <input
                  className="input mt-2 h-9 text-sm"
                  placeholder="Комментарий: без лука, острый…"
                  value={l.comment ?? ''}
                  autoFocus={commentFor === l.dish.id}
                  onChange={(e) => setLineComment(l.dish.id, e.target.value)}
                />
              ) : (
                <button
                  onClick={() => setCommentFor(l.dish.id)}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  + комментарий
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Низ: общий комментарий + итоги + кнопка */}
      <div className="border-t border-border pt-3">
        <input
          className="input mb-3 h-10 text-sm"
          placeholder="Комментарий к заказу"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />

        <div className="space-y-1 text-sm">
          {totals.discount > 0 && (
            <Row label="Сумма" value={money(totals.total)} />
          )}
          {totals.discount > 0 && (
            <Row label="Скидка" value={`−${money(totals.discount)}`} valueClass="text-success" />
          )}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[15px] font-medium text-text-secondary">Итого</span>
            <span className="text-xl font-semibold text-text-primary">{money(totals.final)}</span>
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
          ) : mode === 'add' ? (
            `Добавить к заказу · ${totals.count} шт.`
          ) : (
            'Отправить на кухню'
          )}
        </button>
      </div>
    </div>
  );
}

function Stepper({ sign, onClick }: { sign: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white text-lg leading-none text-text-secondary hover:border-primary hover:text-primary"
    >
      {sign}
    </button>
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
