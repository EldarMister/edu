import type { WaiterShift } from '@/types';
import { useAuth } from '@/store/auth';
import { useNotifications } from '@/store/notifications';
import { Spinner } from '@/components/Spinner';
import { disconnectSocket } from '@/lib/socket';
import { money, timeHM } from '@/lib/format';
import { beep } from '@/lib/sound';

export function WaiterProfile({
  shift,
  shiftLoading,
  shiftPending,
  onStartShift,
  onEndShift,
  pushStatus,
  onEnablePush,
}: {
  shift: WaiterShift | null;
  shiftLoading: boolean;
  shiftPending: boolean;
  onStartShift: () => void;
  onEndShift: () => void;
  pushStatus: 'unsupported' | 'unavailable' | 'default' | 'denied' | 'subscribed' | 'error';
  onEnablePush: () => void;
}) {
  const { user, logout } = useAuth();
  const history = useNotifications((s) => s.history);
  const shiftActive = shift?.status === 'active';

  function onLogout() {
    disconnectSocket();
    logout();
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="card p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
            {user?.name?.[0] ?? '?'}
          </div>
          <div>
            <p className="text-[17px] font-semibold text-text-primary">{user?.name}</p>
            <p className="text-sm text-text-muted">Официант · {user?.phone}</p>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-text-primary">Смена</h3>
            <p className="mt-1 text-sm text-text-muted">
              {shiftActive ? 'Смена активна' : 'Смена не начата'}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
              shiftActive ? 'bg-success/10 text-success' : 'bg-background text-text-muted'
            }`}
          >
            {shiftActive ? 'Смена активна' : 'Не начата'}
          </span>
        </div>

        {shiftActive && (
          <div className="mt-4 grid gap-2 border-t border-border pt-3 text-sm">
            <ShiftRow label="Начало" value={timeHM(shift.startedAt)} />
            <ShiftRow label="Заказов за смену" value={String(shift.stats?.ordersCount ?? 0)} />
            <ShiftRow label="Сумма за смену" value={money(shift.stats?.totalAmount ?? 0)} />
            <ShiftRow label="Активных заказов" value={String(shift.stats?.activeOrdersCount ?? 0)} />
          </div>
        )}

        <button
          className={`${shiftActive ? 'btn-secondary' : 'btn-primary'} btn-lg mt-4 w-full`}
          disabled={shiftLoading || shiftPending}
          onClick={shiftActive ? onEndShift : onStartShift}
        >
          {shiftPending || shiftLoading ? (
            <Spinner />
          ) : shiftActive ? (
            'Закончить смену'
          ) : (
            'Начать смену'
          )}
        </button>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-[15px] font-semibold text-text-primary">Уведомления</h3>
        <div className="mb-4 rounded-xl border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-text-primary">Системные уведомления</p>
              <p className="mt-1 text-xs text-text-muted">{pushStatusText(pushStatus)}</p>
            </div>
            {pushStatus !== 'subscribed' && pushStatus !== 'unsupported' && pushStatus !== 'denied' && (
              <button className="btn-primary btn-md shrink-0" onClick={onEnablePush}>
                Включить
              </button>
            )}
          </div>
          <button className="btn-secondary btn-md mt-3 w-full" onClick={() => beep('notify')}>
            Проверить звук
          </button>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-text-muted">Уведомлений пока нет</p>
        ) : (
          <ul className="space-y-2.5">
            {history.map((n) => (
              <li key={n.id} className="flex gap-2.5 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <div>
                  <p className="text-text-secondary">{n.message}</p>
                  <p className="text-xs text-text-light">{timeHM(n.at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button className="btn-secondary btn-lg w-full" onClick={onLogout}>
        Выйти
      </button>
    </div>
  );
}

function pushStatusText(status: 'unsupported' | 'unavailable' | 'default' | 'denied' | 'subscribed' | 'error') {
  switch (status) {
    case 'subscribed':
      return 'Включены. Официант получит уведомление, даже если сайт закрыт.';
    case 'denied':
      return 'Запрещены в настройках браузера. Разрешите уведомления для этого сайта.';
    case 'unavailable':
      return 'Серверные push-ключи ещё не настроены.';
    case 'unsupported':
      return 'Этот браузер не поддерживает push-уведомления.';
    case 'error':
      return 'Не удалось включить. Проверьте HTTPS, service worker и настройки сервера.';
    default:
      return 'Нажмите “Включить”, чтобы получать готовность заказа вне сайта.';
  }
}

function ShiftRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </div>
  );
}
