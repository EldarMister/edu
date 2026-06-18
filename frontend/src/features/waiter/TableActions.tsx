import { useEffect, useRef, useState } from 'react';
import type { Hall, TableItem } from '@/types';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { TABLE_STATUS } from '@/lib/status';
import { useT } from '@/lib/i18n';
import type { AvailableWaiter } from './api';

// ---------- Маленькие иконки ----------
const I = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => (
      <path key={i} d={p} />
    ))}
  </svg>
);
const PencilIcon = () => <I d="M12 20h9|M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />;
const CloseIcon = () => <I d="M18 6 6 18|M6 6l12 12" />;
const MoveIcon = () => <I d="M5 9l-3 3 3 3|M9 5l3-3 3 3|M15 19l-3 3-3-3|M19 9l3 3-3 3|M2 12h20|M12 2v20" />;
const TransferIcon = () => <I d="M16 3h5v5|M21 3l-7 7|M8 21H3v-5|M3 21l7-7" />;

// ---------- Chip «Стол X» рядом с «Меню» (десктоп) ----------
export function TableChip({ number, hallName }: { number: number; hallName?: string }) {
  const t = useT();
  return (
    <span className="inline-flex items-center rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
      {t('Стол')} {number}{hallName ? ` · ${hallName}` : ''}
    </span>
  );
}

// ---------- Кнопка выбора стола рядом с поиском (экран меню) ----------
export function TableSelectButton({
  number,
  hallName,
  onClick,
  disabled,
}: {
  number: number;
  hallName?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-white px-3 text-sm font-medium text-text-primary transition-colors hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {t('Стол')} {number}{hallName ? ` · ${hallName}` : ''}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}

// ---------- Модалка выбора стола на экране меню ----------
export function TableSelectModal({
  halls,
  currentTableId,
  onPick,
  onClose,
}: {
  halls: Hall[];
  currentTableId: string | null;
  onPick: (tableId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const groups = halls.map((h) => ({ name: h.name, tables: h.tables })).filter((g) => g.tables.length > 0);

  return (
    <Modal open onClose={onClose} title={t('Выбор стола')}>
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.name}>
            <p className="mb-1.5 text-xs font-medium text-text-muted">{g.name}</p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {g.tables.map((tbl) => {
                const selected = tbl.id === currentTableId;
                return (
                  <button
                    key={tbl.id}
                    onClick={() => onPick(tbl.id)}
                    className={`relative flex h-[60px] flex-col items-center justify-center rounded-xl border text-[15px] font-medium transition-colors ${
                      selected
                        ? 'border-primary bg-primary text-white'
                        : 'border-border bg-white text-text-primary hover:border-primary/40'
                    }`}
                  >
                    {tbl.number}
                    {!selected && (
                      <span
                        className={`absolute right-2 top-2 h-2.5 w-2.5 rounded-full ${TABLE_STATUS[tbl.status].dot}`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------- Кнопка «Редактировать» + выпадающее меню ----------
export function TableActionsMenu({
  disabled,
  onCloseTable,
  onMove,
  onTransfer,
}: {
  disabled?: boolean;
  onCloseTable: () => void;
  onMove: () => void;
  onTransfer: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items = [
    { label: 'Закрыть стол', icon: <CloseIcon />, onClick: onCloseTable },
    { label: 'Перенести стол', icon: <MoveIcon />, onClick: onMove },
    { label: 'Передать стол', icon: <TransferIcon />, onClick: onTransfer },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
      >
        <PencilIcon />
        {t('Редактировать')}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-48 overflow-hidden rounded-xl border border-border bg-white py-1 shadow-soft">
          {items.map((it) => (
            <button
              key={it.label}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-background hover:text-text-primary"
            >
              <span className="text-text-light">{it.icon}</span>
              {t(it.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Модалка «Закрыть стол» ----------
export function CloseTableModal({
  tableNumber,
  hasActiveOrder,
  pending,
  onConfirm,
  onClose,
}: {
  tableNumber: number;
  hasActiveOrder: boolean;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  if (hasActiveOrder) {
    return (
      <Modal
        open
        onClose={onClose}
        title={t('Закрыть стол?')}
        footer={
          <button className="btn-secondary btn-lg w-full" onClick={onClose}>
            {t('Понятно')}
          </button>
        }
      >
        <p className="text-sm text-text-secondary">
          {t('У этого стола есть активный заказ. Завершите или оплатите заказ перед закрытием стола.')}
        </p>
      </Modal>
    );
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={t('Закрыть стол?')}
      footer={
        <div className="flex gap-2">
          <button className="btn-secondary btn-lg flex-1" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button className="btn-primary btn-lg flex-1 font-semibold" disabled={pending} onClick={onConfirm}>
            {pending ? <Spinner /> : t('Закрыть стол')}
          </button>
        </div>
      }
    >
      <p className="text-sm text-text-secondary">
        {t('Вы действительно хотите закрыть стол')} №{tableNumber}?
      </p>
    </Modal>
  );
}

// ---------- Модалка «Перенести стол» ----------
export function MoveTableModal({
  halls,
  currentTableId,
  pending,
  onConfirm,
  onClose,
}: {
  halls: Hall[];
  currentTableId: string;
  pending: boolean;
  onConfirm: (targetTableId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [target, setTarget] = useState<string | null>(null);

  const groups = halls
    .map((h) => ({
      name: h.name,
      tables: h.tables.filter((t) => t.status === 'free' && t.id !== currentTableId),
    }))
    .filter((g) => g.tables.length > 0);

  const total = groups.reduce((n, g) => n + g.tables.length, 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('Перенести стол')}
      footer={
        <div className="flex gap-2">
          <button className="btn-secondary btn-lg flex-1" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button
            className="btn-primary btn-lg flex-1 font-semibold"
            disabled={!target || pending}
            onClick={() => target && onConfirm(target)}
          >
            {pending ? <Spinner /> : t('Перенести')}
          </button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-text-muted">{t('Выберите стол, на который нужно перенести заказ')}</p>
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">{t('Нет доступных столов для переноса')}</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.name}>
              <p className="mb-1.5 text-xs font-medium text-text-muted">{g.name}</p>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {g.tables.map((t) => (
                  <TablePick key={t.id} table={t} selected={target === t.id} onClick={() => setTarget(t.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function TablePick({ table, selected, onClick }: { table: TableItem; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-[60px] flex-col items-center justify-center rounded-xl border text-[15px] font-medium transition-colors ${
        selected
          ? 'border-primary bg-primary text-white'
          : 'border-border bg-white text-text-primary hover:border-primary/40'
      }`}
    >
      {table.number}
    </button>
  );
}

// ---------- Модалка «Передать стол» ----------
export function TransferTableModal({
  waiters,
  loading,
  excludeWaiterId,
  pending,
  onConfirm,
  onClose,
}: {
  waiters: AvailableWaiter[];
  loading: boolean;
  excludeWaiterId: string | null;
  pending: boolean;
  onConfirm: (waiter: AvailableWaiter) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [sel, setSel] = useState<string | null>(null);
  const list = waiters.filter((w) => w.id !== excludeWaiterId);
  const selected = list.find((w) => w.id === sel) ?? null;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('Передать стол')}
      footer={
        <div className="flex gap-2">
          <button className="btn-secondary btn-lg flex-1" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button
            className="btn-primary btn-lg flex-1 font-semibold"
            disabled={!selected || pending}
            onClick={() => selected && onConfirm(selected)}
          >
            {pending ? <Spinner /> : t('Передать')}
          </button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-text-muted">{t('Выберите официанта, которому нужно передать стол')}</p>
      {loading ? (
        <div className="flex justify-center py-8 text-primary">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">{t('Нет доступных официантов для передачи')}</p>
      ) : (
        <div className="space-y-2">
          {list.map((w) => (
            <button
              key={w.id}
              onClick={() => setSel(w.id)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                sel === w.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
              }`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {w.name[0]}
              </span>
              <span className="text-[15px] font-medium text-text-primary">{w.name}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
