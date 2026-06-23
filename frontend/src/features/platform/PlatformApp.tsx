import { useState } from 'react';
import { usePlatformAuth } from './auth';
import { PlatformLogin } from './PlatformLogin';
import { CafesPage } from './CafesPage';
import { MonitoringPage } from './MonitoringPage';

type Tab = 'cafes' | 'monitoring';

export function PlatformApp() {
  const { token, admin, logout } = usePlatformAuth();
  const [tab, setTab] = useState<Tab>('cafes');

  if (!token) return <PlatformLogin />;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-4">
          <span className="text-[15px] font-bold text-text-primary">EDU POS · Платформа</span>
          <nav className="flex rounded-lg bg-background p-1">
            <TabButton active={tab === 'cafes'} onClick={() => setTab('cafes')}>Кафе</TabButton>
            <TabButton active={tab === 'monitoring'} onClick={() => setTab('monitoring')}>Мониторинг</TabButton>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-text-muted sm:inline">{admin?.name}</span>
          <button type="button" onClick={logout} className="text-sm font-medium text-text-secondary hover:text-danger">
            Выйти
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        {tab === 'cafes' ? <CafesPage /> : <MonitoringPage />}
      </main>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-white text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
      }`}
    >
      {children}
    </button>
  );
}
