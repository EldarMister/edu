import { useAuth } from '@/store/auth';
import { accessForUser } from '@/lib/workspaces';

/** A full navigation starts each workplace with a fresh cache and socket context. */
export function WorkspaceLinks({ current }: { current: 'admin' | 'terminal' | 'production' }) {
  const user = useAuth((state) => state.user);
  if (!user) return null;
  const access = accessForUser(user);
  return <div className="flex flex-wrap items-center gap-2 text-sm">
    {current !== 'terminal' && access.terminal && <a className="btn-secondary btn-md" href="/waiter">Открыть кассу ↗</a>}
    {current !== 'admin' && access.admin && <a className="btn-secondary btn-md" href={user.role === 'OWNER' ? '/owner' : '/admin'}>Админ-панель ↗</a>}
    {current !== 'production' && access.production && <a className="btn-secondary btn-md" href={'/' + access.production}>{access.production === 'bar' ? 'Экран бара' : 'Экран кухни'} ↗</a>}
  </div>;
}
