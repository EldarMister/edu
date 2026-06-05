import { useAuth } from '@/store/auth';

/** Заглушка для интерфейсов, которые появятся на этапах 6–7. */
export function ComingSoon({ title }: { title: string }) {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold text-text-primary">{title}</h1>
      <p className="max-w-sm text-text-secondary">
        Этот раздел будет реализован на следующем этапе. Сейчас готовы авторизация, официантская и
        кухонная части.
      </p>
      <p className="text-sm text-text-muted">
        Вы вошли как {user?.name} ({user?.role})
      </p>
      <button className="btn-secondary btn-md" onClick={logout}>
        Выйти
      </button>
    </div>
  );
}
