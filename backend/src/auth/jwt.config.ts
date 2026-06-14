export const DEFAULT_JWT_ACCESS_SECRET = 'change-me-access-secret';
export const DEFAULT_JWT_REFRESH_SECRET = 'change-me-refresh-secret';

export function getJwtAccessSecret() {
  return process.env.JWT_ACCESS_SECRET ?? DEFAULT_JWT_ACCESS_SECRET;
}

export function getJwtRefreshSecret() {
  return process.env.JWT_REFRESH_SECRET ?? DEFAULT_JWT_REFRESH_SECRET;
}

export function assertSafeJwtSecrets() {
  const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
  if (!isProd) return;

  const access = getJwtAccessSecret();
  const refresh = getJwtRefreshSecret();

  if (access === DEFAULT_JWT_ACCESS_SECRET || refresh === DEFAULT_JWT_REFRESH_SECRET) {
    throw new Error('JWT secrets must be configured in production');
  }
}
