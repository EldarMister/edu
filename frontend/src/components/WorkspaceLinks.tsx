import { useAuth } from '@/store/auth';
import { accessForUser } from '@/lib/workspaces';
import { resolvePermissions } from '@/lib/permissions';

/** A full navigation starts each workplace with a fresh cache and socket context. */
export function WorkspaceLinks({ current }: { current: 'admin' | 'terminal' | 'production' }) {
  const user = useAuth((state) => state.user);
  if (!user) return null;
  const access = accessForUser(user);
  const showAdmin = current !== 'admin' && access.admin;
  const adminPath = user.role === 'OWNER' ? '/owner' : '/admin';
  const rights = resolvePermissions(user.role, user.permissions);
  const receiveFromTerminal = current === 'terminal' && access.admin && (user.role === 'OWNER' || (rights.sections.warehouse
    && !rights.readOnlySections?.includes('warehouse') && rights.actions.warehouseReceive && rights.actions.warehouseCosts));
  const production = current === 'production' ? null : access.production;
  if (!showAdmin && !production) return null;
  return <div className={`flex flex-wrap items-center gap-2 text-sm${current === 'admin' ? ' px-3 py-3' : ''}`}>
    {showAdmin && <a className="btn-secondary btn-md" href={adminPath}>Админ-панель ↗</a>}
    {receiveFromTerminal && <a className="btn-secondary btn-md" target="_blank" rel="noopener noreferrer"
      href={adminPath + '?section=warehouse&view=supplies&editor=purchase&action=import'}>Добавить накладную по фото ↗</a>}
    {production && <a className="btn-secondary btn-md" href={'/' + production}>{production === 'bar' ? 'Экран бара' : 'Экран кухни'} ↗</a>}
  </div>;
}
