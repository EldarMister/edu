import { useState } from 'react';
import { apiError } from '@/lib/api';
import { usePlatformAuth } from './auth';
import { usePlatformLogin } from './api';

export function PlatformLogin() {
  const setSession = usePlatformAuth((s) => s.setSession);
  const login = usePlatformLogin();
  const [form, setForm] = useState({ login: '', password: '' });
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const res = await login.mutateAsync(form);
      setSession(res.accessToken, res.admin);
    } catch (e2) {
      setErr(apiError(e2));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="mb-1 text-lg font-bold text-text-primary">EDU POS · Платформа</div>
        <p className="mb-5 text-sm text-text-muted">Панель управления кафе</p>

        <label className="mb-1.5 block text-sm font-medium text-text-secondary">Логин</label>
        <input
          className="input mb-3"
          autoFocus
          value={form.login}
          onChange={(e) => setForm((f) => ({ ...f, login: e.target.value }))}
          placeholder="superadmin"
        />

        <label className="mb-1.5 block text-sm font-medium text-text-secondary">Пароль</label>
        <input
          className="input mb-4"
          type="password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          placeholder="••••••••"
        />

        {err && <p className="mb-3 text-sm text-danger">{err}</p>}

        <button type="submit" disabled={login.isPending} className="btn-primary btn-md w-full">
          {login.isPending ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
