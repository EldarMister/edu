import { useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import {
  useCafes,
  useCreateCafe,
  useResumeCafe,
  useSuspendCafe,
  useUpdateSubscription,
  type PlatformCafe,
} from './api';

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '—');
const isExpired = (iso: string | null) => !!iso && new Date(iso).getTime() < Date.now();

export function CafesPage() {
  const { data: cafes, isLoading, isError, error } = useCafes();
  const [showCreate, setShowCreate] = useState(false);

  if (isLoading) {
    return <div className="flex justify-center py-16 text-primary"><Spinner className="h-7 w-7" /></div>;
  }
  if (isError || !cafes) {
    return <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">{apiError(error)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">Кафе · {cafes.length}</h2>
        <button type="button" onClick={() => setShowCreate(true)} className="btn-primary btn-md">
          + Создать кафе
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {cafes.map((cafe) => (
          <CafeCard key={cafe.id} cafe={cafe} />
        ))}
      </div>

      {showCreate && <CreateCafeModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CafeCard({ cafe }: { cafe: PlatformCafe }) {
  const suspend = useSuspendCafe();
  const resume = useResumeCafe();
  const updateSub = useUpdateSubscription();
  const push = useNotifications((s) => s.push);
  const [date, setDate] = useState(cafe.paidUntil ? cafe.paidUntil.slice(0, 10) : '');
  const [showSuspend, setShowSuspend] = useState(false);

  const suspended = cafe.status === 'suspended';

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      push({ message: ok, type: 'success', at: new Date().toISOString() });
    } catch (e) {
      push({ message: apiError(e), type: 'error', at: new Date().toISOString() });
    }
  };

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-text-primary">{cafe.name}</p>
          <p className="mt-0.5 text-xs text-text-muted">
            {cafe.staffCount} сотр. · {cafe.ordersCount} заказов · с {fmtDate(cafe.createdAt)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            suspended ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'
          }`}
        >
          {suspended ? 'Приостановлено' : 'Работает'}
        </span>
      </div>

      {suspended && cafe.suspendedReason && (
        <p className="mt-2 rounded-lg bg-danger/5 px-2.5 py-1.5 text-xs text-danger">{cafe.suspendedReason}</p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <div>
          <label className="mb-1 block text-xs text-text-muted">Оплачено до</label>
          <input
            type="date"
            className="input h-9 w-40 px-2.5"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={updateSub.isPending}
          onClick={() =>
            act(
              () => updateSub.mutateAsync({ id: cafe.id, paidUntil: date ? new Date(date).toISOString() : null }),
              'Подписка обновлена',
            )
          }
          className="btn-secondary btn-md h-9"
        >
          Сохранить
        </button>
        {cafe.paidUntil && (
          <span className={`pb-2 text-xs ${isExpired(cafe.paidUntil) ? 'text-danger' : 'text-text-muted'}`}>
            {isExpired(cafe.paidUntil) ? 'срок истёк' : `до ${fmtDate(cafe.paidUntil)}`}
          </span>
        )}
      </div>

      <div className="mt-3">
        {suspended ? (
          <button
            type="button"
            disabled={resume.isPending}
            onClick={() => act(() => resume.mutateAsync(cafe.id), 'Кафе возобновлено')}
            className="btn-primary btn-md w-full"
          >
            Возобновить работу
          </button>
        ) : (
          <button
            type="button"
            disabled={suspend.isPending}
            onClick={() => setShowSuspend(true)}
            className="btn-md w-full rounded-lg border border-danger/40 font-semibold text-danger transition-colors hover:bg-danger/10"
          >
            Приостановить
          </button>
        )}
      </div>

      {showSuspend && (
        <SuspendModal
          cafeName={cafe.name}
          busy={suspend.isPending}
          onClose={() => setShowSuspend(false)}
          onConfirm={async () => {
            await act(() => suspend.mutateAsync({ id: cafe.id }), 'Кафе приостановлено');
            setShowSuspend(false);
          }}
        />
      )}
    </div>
  );
}

function SuspendModal({
  cafeName,
  busy,
  onClose,
  onConfirm,
}: {
  cafeName: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="modal-backdrop animate-fade-in" onClick={onClose} />
      <div className="animate-card-pop relative z-10 w-full max-w-sm rounded-2xl bg-card p-5 shadow-soft">
        <h3 className="text-[17px] font-semibold text-text-primary">Приостановить «{cafeName}»?</h3>
        <p className="mt-1.5 text-sm text-text-secondary">
          Персонал не сможет войти, QR-меню отключится. Возобновить можно в любой момент.
        </p>
        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onClose} className="btn-secondary btn-md flex-1">Отмена</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="btn-md flex-1 rounded-lg bg-danger font-semibold text-white transition-colors hover:bg-danger/90 disabled:opacity-50"
          >
            {busy ? 'Приостанавливаем…' : 'Приостановить'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateCafeModal({ onClose }: { onClose: () => void }) {
  const create = useCreateCafe();
  const push = useNotifications((s) => s.push);
  const [form, setForm] = useState({ cafeName: '', ownerName: '', ownerPhone: '', ownerPassword: '' });
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    try {
      await create.mutateAsync(form);
      push({ message: `Кафе «${form.cafeName}» создано`, type: 'success', at: new Date().toISOString() });
      onClose();
    } catch (e) {
      setErr(apiError(e));
    }
  };

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const ready = form.cafeName && form.ownerName && form.ownerPhone && form.ownerPassword.length >= 4;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="modal-backdrop animate-fade-in" onClick={onClose} />
      <div className="animate-card-pop relative z-10 w-full max-w-md rounded-2xl bg-card p-5 shadow-soft">
        <h3 className="text-[17px] font-semibold text-text-primary">Новое кафе</h3>
        <p className="mt-1 text-xs text-text-muted">Создаст кафе, владельца (OWNER) и настройки. Телефон — логин владельца.</p>

        <div className="mt-4 space-y-3">
          <Field label="Название кафе"><input className="input" value={form.cafeName} onChange={(e) => set('cafeName', e.target.value)} placeholder="Кафе Бахор" /></Field>
          <Field label="Имя владельца"><input className="input" value={form.ownerName} onChange={(e) => set('ownerName', e.target.value)} placeholder="Алишер" /></Field>
          <Field label="Телефон владельца (логин)"><input className="input" value={form.ownerPhone} onChange={(e) => set('ownerPhone', e.target.value)} placeholder="+996700123456" /></Field>
          <Field label="Пароль владельца"><input className="input" value={form.ownerPassword} onChange={(e) => set('ownerPassword', e.target.value)} placeholder="мин. 4 символа" /></Field>
        </div>

        {err && <p className="mt-3 text-sm text-danger">{err}</p>}

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onClose} className="btn-secondary btn-md flex-1">Отмена</button>
          <button type="button" onClick={submit} disabled={!ready || create.isPending} className="btn-primary btn-md flex-1">
            {create.isPending ? 'Создаём…' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text-secondary">{label}</label>
      {children}
    </div>
  );
}
