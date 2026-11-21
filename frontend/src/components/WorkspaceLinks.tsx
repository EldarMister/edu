import { useAuth } from '@/store/auth';
import { accessForUser } from '@/lib/workspaces';

/** A full navigation starts each workplace with a fresh cache and socket context. */
export function WorkspaceLinks({ current }: { current: 'admin' | 'terminal' | 'production' }) {
  const user = useAuth((state) => state.user);
  if (!user) return null;
  const access = accessForUser(user);
  const showAdmin = current !== 'admin' && access.admin;
  const production = current === 'production' ? null : access.production;
  if (!showAdmin && !production) return null;
  return <div className={`flex flex-wrap items-center gap-2 text-sm${current === 'admin' ? ' px-3 py-3' : ''}`}>
    {showAdmin && <a className="btn-secondary btn-md" href={user.role === 'OWNER' ? '/owner' : '/admin'}>Админ-панель ↗</a>}
    {production && <a className="btn-secondary btn-md" href={'/' + production}>{production === 'bar' ? 'Экран бара' : 'Экран кухни'} ↗</a>}
  </div>;
}
