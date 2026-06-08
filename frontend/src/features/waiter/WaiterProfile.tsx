import { useState } from 'react';
import type { WaiterShift } from '@/types';
import { useAuth } from '@/store/auth';
import { useNotifications } from '@/store/notifications';
import { Spinner } from '@/components/Spinner';
import { AppVersion } from '@/components/AppVersion';
import { disconnectSocket } from '@/lib/socket';
import { timeHM } from '@/lib/format';
import { beep } from '@/lib/sound';
import { useT } from '@/lib/i18n';

export function WaiterProfile({
  shift,
  shiftLoading,
  shiftPending,
  onStartShift,
  onEndShift,
  pushStatus,
  onEnablePush,
  onOpenCabinet,
}: {
  shift: WaiterShift | null;
  shiftLoading: boolean;
  shiftPending: boolean;
  onStartShift: () => void;
  onEndShift: () => void;
  pushStatus: 'unsupported' | 'unavailable' | 'default' | 'denied' | 'subscribed' | 'error';
  onEnablePush: () => void;
  onOpenCabinet: () => void;
}) {
  const t = useT();
  const { user, logout } = useAuth();
  const history = useNotifications((s) => s.history);
  const shiftActive = shift?.status === 'active';

  const [notifOpen, setNotifOpen] = useState(true);
  const [showAllNotif, setShowAllNotif] = useState(false);
  const visibleNotifs = showAllNotif ? history : history.slice(0, 3);

  function onLogout() {
    disconnectSocket();
    logout();
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <button
        onClick={onOpenCabinet}
        className="card flex w-full items-center gap-3 p-5 text-left transition-colors hover:border-primary/40"
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
          {user?.name?.[0] ?? '?'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold text-text-primary">{user?.name}</p>
          <p className="truncate text-sm text-text-muted">{t('Официант')} · {user?.phone}</p>
        </div>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-text-light" aria-hidden>
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[15px] font-semibold text-text-primary">{t('Смена')}</h3>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
              shiftActive ? 'bg-success/10 text-success' : 'bg-background text-text-muted'
            }`}
          >
            {shiftActive ? t('Смена активна') : t('Не начата')}
          </span>
        </div>

        {shiftActive && (
          <div className="mt-4 flex items-center justify-between gap-4 text-sm">
            <span className="text-text-muted">{t('Начало')}</span>
            <span className="font-medium text-text-primary">{timeHM(shift.startedAt)}</span>
          </div>
        )}

        <button
          className="btn-primary btn-lg mt-4 w-full"
          disabled={shiftLoading || shiftPending}
          onClick={shiftActive ? onEndShift : onStartShift}
        >
          {shiftPending || shiftLoading ? (
            <Spinner />
          ) : shiftActive ? (
            t('Закончить смену')
          ) : (
            t('Начать смену')
          )}
        </button>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[15px] font-semibold text-text-primary">{t('Уведомления')}</h3>
          <button
            className="flex items-center gap-1 text-sm font-medium text-primary"
            onClick={() => setNotifOpen((v) => !v)}
          >
            {notifOpen ? t('Скрыть') : t('Показать')}
            <Chevron up={notifOpen} />
          </button>
        </div>

        {notifOpen && (
          <>
            <div className="mb-4 mt-3 rounded-xl border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-text-primary">{t('Системные уведомления')}</p>
                  <p className="mt-1 text-xs text-text-muted">{pushStatusText(pushStatus, t)}</p>
                </div>
                {pushStatus !== 'subscribed' && pushStatus !== 'unsupported' && pushStatus !== 'denied' && (
                  <button className="btn-primary btn-md shrink-0" onClick={onEnablePush}>
                    {t('Включить')}
                  </button>
                )}
              </div>
              <button className="btn-secondary btn-md mt-3 w-full" onClick={() => beep('notify')}>
                {t('Проверить звук')}
              </button>
            </div>

            {history.length === 0 ? (
              <p className="text-sm text-text-muted">{t('Уведомлений пока нет')}</p>
            ) : (
              <>
                <ul className="space-y-2.5">
                  {visibleNotifs.map((n) => (
                    <li key={n.id} className="flex gap-2.5 text-sm">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <div>
                        <p className="text-text-secondary">{n.message}</p>
                        <p className="text-xs text-text-light">{timeHM(n.at)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                {history.length > 3 && (
                  <button
                    className="mt-3 flex items-center gap-1 text-sm font-medium text-primary"
                    onClick={() => setShowAllNotif((v) => !v)}
                  >
                    {showAllNotif ? t('Скрыть лишние уведомления') : t('Показать все уведомления')}
                    <Chevron up={showAllNotif} />
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>

      <button
        className="btn-secondary btn-lg w-full gap-2 text-danger hover:bg-danger/5"
        onClick={onLogout}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="M16 17l5-5-5-5M21 12H9" />
        </svg>
        {t('Выйти')}
      </button>

      <AppVersion className="pt-1" />
    </div>
  );
}

function pushStatusText(
  status: 'unsupported' | 'unavailable' | 'default' | 'denied' | 'subscribed' | 'error',
  t: (value: string) => string,
) {
  switch (status) {
    case 'subscribed':
      return t('Включены. Официант получит уведомление, даже если сайт закрыт.');
    case 'denied':
      return t('Запрещены в настройках браузера. Разрешите уведомления для этого сайта.');
    case 'unavailable':
      return t('Серверные push-ключи ещё не настроены.');
    case 'unsupported':
      return t('Этот браузер не поддерживает push-уведомления.');
    case 'error':
      return t('Не удалось включить. Проверьте HTTPS, service worker и настройки сервера.');
    default:
      return t('Нажмите “Включить”, чтобы получать готовность заказа вне сайта.');
  }
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${up ? '' : 'rotate-180'}`}
      aria-hidden
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}
