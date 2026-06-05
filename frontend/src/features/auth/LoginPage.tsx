import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { homeForRole } from '@/routes/ProtectedRoute';
import { Spinner } from '@/components/Spinner';
import type { LoginResponse } from '@/types';

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post<LoginResponse>('/auth/login', { phone, password });
      setSession(data);
      navigate(homeForRole(data.user.role), { replace: true });
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      {/* Логотип */}
      <div className="mb-8 text-center">
        <h1 className="text-xl font-semibold text-text-primary">
          Вкусно <span className="text-primary">•</span> POS
        </h1>
        <p className="mt-1 text-sm text-text-muted">Система управления рестораном</p>
      </div>

      {/* Карточка входа */}
      <div className="card w-full max-w-[400px] p-7 sm:p-8">
        <div className="mb-6 text-center">
          <h2 className="text-xl font-semibold text-text-primary">Вход в систему</h2>
          <p className="mx-auto mt-1.5 max-w-[260px] text-sm text-text-muted">
            Введите номер телефона и пароль для входа в систему
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">
              Номер телефона
            </label>
            <input
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="username"
              placeholder="Введите номер телефона"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Пароль</label>
            <div className="relative">
              <input
                className="input pr-11"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Введите пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-text-light hover:text-text-secondary"
                tabIndex={-1}
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button type="submit" className="btn-primary btn-lg w-full font-semibold" disabled={loading}>
            {loading ? <Spinner /> : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Eye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOff() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.4M6.6 6.6A13.3 13.3 0 0 0 2 11s3.5 7 10 7a9 9 0 0 0 4.2-1M1 1l22 22" />
    </svg>
  );
}
