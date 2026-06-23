import { useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import {
  useCafeStaff,
  useCleanupCafe,
  useDeleteCafe,
  useDeleteStaff,
  useSetStaffActive,
  type CleanupScope,
  type PlatformCafe,
} from './api';

const SCOPE_LABEL: Record<CleanupScope, string> = {
  orders: 'Заказы и продажи',
  menu: 'Меню (категории, блюда)',
  warehouse: 'Склад (сырьё, закупки)',
};

export function ManageCafeModal({ cafe, onClose, onDeleted }: { cafe: PlatformCafe; onClose: () => void; onDeleted: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="modal-backdrop animate-fade-in" onClick={onClose} />
      <div className="animate-card-pop relative z-10 max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <h3 className="text-[17px] font-semibold text-text-primary">Управление · {cafe.name}</h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-secondary">✕</button>
        </div>

        <CleanupSection cafe={cafe} />
        <StaffSection cafe={cafe} />
        <DangerZone cafe={cafe} onDeleted={onDeleted} />
      </div>
    </div>
  );
}

function CleanupSection({ cafe }: { cafe: PlatformCafe }) {
  const cleanup = useCleanupCafe();
  const push = useNotifications((s) => s.push);
  const [scopes, setScopes] = useState<Set<CleanupScope>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const toggle = (s: CleanupScope) =>
    setScopes((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  // Меню/склад тянут заказы (история ссылается на них) — показываем это.
  const willAlsoClearOrders = (scopes.has('menu') || scopes.has('warehouse')) && !scopes.has('orders');

  const run = async () => {
    try {
      await cleanup.mutateAsync({ id: cafe.id, scopes: [...scopes] });
      push({ message: 'Данные очищены', type: 'success', at: new Date().toISOString() });
      setScopes(new Set());
      setConfirming(false);
    } catch (e) {
      push({ message: apiError(e), type: 'error', at: new Date().toISOString() });
    }
  };

  return (
    <section className="mt-5 border-t border-border pt-4">
      <p className="mb-2 text-sm font-semibold text-text-primary">Частичная очистка данных</p>
      <div className="space-y-1.5">
        {(Object.keys(SCOPE_LABEL) as CleanupScope[]).map((s) => (
          <label key={s} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 text-sm hover:bg-background">
            <input type="checkbox" className="accent-primary" checked={scopes.has(s)} onChange={() => toggle(s)} />
            <span className="text-text-primary">{SCOPE_LABEL[s]}</span>
          </label>
        ))}
      </div>
      {willAlsoClearOrders && (
        <p className="mt-2 text-xs text-warning">Меню и склад связаны с историей — заказы тоже будут очищены.</p>
      )}

      {!confirming ? (
        <button
          type="button"
          disabled={scopes.size === 0}
          onClick={() => setConfirming(true)}
          className="btn-md mt-3 rounded-lg border border-danger/40 px-4 font-semibold text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
        >
          Очистить выбранное
        </button>
      ) : (
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 p-3">
          <p className="text-sm text-danger">Очистить безвозвратно? Это нельзя отменить.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="btn-secondary btn-sm flex-1">Отмена</button>
            <button type="button" onClick={run} disabled={cleanup.isPending} className="btn-sm flex-1 rounded-lg bg-danger font-semibold text-white hover:bg-danger/90 disabled:opacity-50">
              {cleanup.isPending ? 'Очищаем…' : 'Очистить'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function StaffSection({ cafe }: { cafe: PlatformCafe }) {
  const { data: staff, isLoading } = useCafeStaff(cafe.id, true);
  const setActive = useSetStaffActive(cafe.id);
  const del = useDeleteStaff(cafe.id);
  const push = useNotifications((s) => s.push);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      push({ message: ok, type: 'success', at: new Date().toISOString() });
    } catch (e) {
      push({ message: apiError(e), type: 'error', at: new Date().toISOString() });
    }
  };

  return (
    <section className="mt-5 border-t border-border pt-4">
      <p className="mb-2 text-sm font-semibold text-text-primary">Персонал</p>
      {isLoading ? (
        <div className="flex justify-center py-4 text-primary"><Spinner className="h-5 w-5" /></div>
      ) : (
        <div className="space-y-1.5">
          {staff?.map((u) => (
            <div key={u.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-text-primary">
                  {u.name} <span className="text-xs font-normal text-text-muted">· {u.role}</span>
                  {!u.isActive && <span className="ml-1 text-xs text-danger">(отключён)</span>}
                </p>
                <p className="text-xs text-text-muted">{u.phone}</p>
              </div>
              <button
                type="button"
                onClick={() => act(() => setActive.mutateAsync({ userId: u.id, isActive: !u.isActive }), u.isActive ? 'Сотрудник отключён' : 'Сотрудник включён')}
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-background"
              >
                {u.isActive ? 'Отключить' : 'Включить'}
              </button>
              {u.role !== 'OWNER' && (
                <button
                  type="button"
                  onClick={() => act(() => del.mutateAsync(u.id), 'Сотрудник удалён')}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/10"
                >
                  Удалить
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DangerZone({ cafe, onDeleted }: { cafe: PlatformCafe; onDeleted: () => void }) {
  const del = useDeleteCafe();
  const push = useNotifications((s) => s.push);
  const [step, setStep] = useState(0); // 0 — скрыто, 1..3 — подтверждения
  const [typed, setTyped] = useState('');

  const doDelete = async () => {
    try {
      await del.mutateAsync({ id: cafe.id, confirmName: typed });
      push({ message: `Кафе «${cafe.name}» удалено`, type: 'success', at: new Date().toISOString() });
      onDeleted();
    } catch (e) {
      push({ message: apiError(e), type: 'error', at: new Date().toISOString() });
    }
  };

  return (
    <section className="mt-5 rounded-xl border border-danger/30 bg-danger/5 p-4">
      <p className="text-sm font-semibold text-danger">Опасная зона</p>
      <p className="mt-1 text-xs text-text-secondary">Удаление кафе стирает ВСЕ его данные безвозвратно.</p>

      {step === 0 && (
        <button type="button" onClick={() => setStep(1)} className="btn-md mt-3 w-full rounded-lg bg-danger font-semibold text-white hover:bg-danger/90">
          Удалить кафе
        </button>
      )}

      {step === 1 && (
        <ConfirmStep
          text={`Удалить кафе «${cafe.name}»? Все заказы, меню, склад и персонал будут удалены.`}
          confirmLabel="Понимаю, далее"
          onCancel={() => setStep(0)}
          onConfirm={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <ConfirmStep
          text={`Это действие НЕОБРАТИМО. Данные кафе «${cafe.name}» восстановить будет нельзя.`}
          confirmLabel="Да, продолжить"
          onCancel={() => setStep(0)}
          onConfirm={() => setStep(3)}
        />
      )}
      {step === 3 && (
        <div className="mt-3">
          <p className="text-sm text-danger">Введите название кафе для подтверждения:</p>
          <input className="input mt-2" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={cafe.name} />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => { setStep(0); setTyped(''); }} className="btn-secondary btn-sm flex-1">Отмена</button>
            <button
              type="button"
              onClick={doDelete}
              disabled={typed.trim() !== cafe.name || del.isPending}
              className="btn-sm flex-1 rounded-lg bg-danger font-semibold text-white hover:bg-danger/90 disabled:opacity-40"
            >
              {del.isPending ? 'Удаляем…' : 'Удалить навсегда'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ConfirmStep({ text, confirmLabel, onCancel, onConfirm }: { text: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="mt-3">
      <p className="text-sm text-danger">{text}</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary btn-sm flex-1">Отмена</button>
        <button type="button" onClick={onConfirm} className="btn-sm flex-1 rounded-lg bg-danger font-semibold text-white hover:bg-danger/90">
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
