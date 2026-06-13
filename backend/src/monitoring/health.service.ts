import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import path from 'path';
import { PrismaService } from '../prisma/prisma.service';

type DbStatus = 'ok' | 'error';
type HealthStatus = 'ok' | 'warning' | 'degraded';

interface AppliedMigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

export interface MigrationStatus {
  status: HealthStatus;
  localCount: number;
  appliedCount: number;
  behind: boolean;
  missing: string[];
  extraApplied: string[];
  latestLocal: string | null;
  latestApplied: string | null;
  failed: string[];
}

export interface AppHealth {
  status: HealthStatus;
  env: string;
  commit: string | null;
  time: string;
  database: DbStatus;
  migrations: MigrationStatus;
  error?: string;
}

export interface ExternalEnvironmentStatus {
  name: 'dev' | 'main';
  status: HealthStatus;
  database: DbStatus;
  migrations: MigrationStatus;
  error?: string;
  commit?: string | null;
  backend?: DbStatus;
  backendError?: string;
}

@Injectable()
export class HealthService {
  constructor(private prisma: PrismaService) {}

  async current(): Promise<AppHealth> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const migrations = await this.currentMigrations();
      return {
        status: migrations.status,
        env: this.envName(),
        commit: this.commitSha(),
        time: new Date().toISOString(),
        database: 'ok',
        migrations,
      };
    } catch (err) {
      return {
        status: 'degraded',
        env: this.envName(),
        commit: this.commitSha(),
        time: new Date().toISOString(),
        database: 'error',
        migrations: await this.localOnlyMigrations(),
        error: this.errorMessage(err),
      };
    }
  }

  async currentMigrations(): Promise<MigrationStatus> {
    const local = await this.localMigrationNames();
    const applied = await this.appliedMigrationNames(this.prisma);
    return this.compareMigrations(local, applied);
  }

  async project() {
    const current = await this.current();
    const dev = await this.externalEnvironment('dev', process.env.MONITOR_DEV_DATABASE_URL);
    if (dev) {
      await this.attachExternalBackendHealth(dev, process.env.MONITOR_DEV_HEALTH_URL);
    }
    return { current, dev };
  }

  async statusPage() {
    const project = await this.project();
    const cards = [
      this.renderCurrentCard('Продакшен', project.current),
      project.dev
        ? this.renderExternalCard('Dev', project.dev)
        : this.renderEmptyCard('Dev', 'Добавьте MONITOR_DEV_DATABASE_URL в main backend, чтобы видеть dev базу.'),
    ].join('');
    const overall = [project.current, project.dev].some((item) => item?.status === 'degraded')
      ? 'degraded'
      : [project.current, project.dev].some((item) => item?.status === 'warning')
        ? 'warning'
      : 'ok';

    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="60" />
  <title>Статус EDU POS</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #eef3f8;
      --card: #ffffff;
      --text: #0f172a;
      --muted: #64748b;
      --border: #dbe3ef;
      --ok: #16a34a;
      --bad: #dc2626;
      --warn: #d97706;
      --warn-bg: #fff7ed;
      --ok-bg: #ecfdf5;
      --bad-bg: #fef2f2;
      --panel: #f8fafc;
      font-family: "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--text);
      background:
        linear-gradient(135deg, rgba(15, 98, 254, 0.08), transparent 32%),
        radial-gradient(circle at 85% 12%, rgba(22, 163, 74, 0.10), transparent 30%),
        var(--bg);
    }
    main { max-width: 1180px; margin: 0 auto; padding: 34px 22px 42px; }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 22px;
      border: 1px solid rgba(219, 227, 239, 0.85);
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.74);
      padding: 22px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.07);
      backdrop-filter: blur(12px);
    }
    h1 { margin: 0; font-size: 32px; line-height: 1.1; letter-spacing: 0; }
    p { margin: 0; }
    .muted { color: var(--muted); }
    .pill { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 8px 12px; font-weight: 700; font-size: 14px; }
    .pill.ok { background: var(--ok-bg); color: var(--ok); }
    .pill.warning { background: var(--warn-bg); color: var(--warn); }
    .pill.degraded { background: var(--bad-bg); color: var(--bad); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .card { min-width: 0; border: 1px solid var(--border); border-radius: 18px; background: var(--card); padding: 20px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06); }
    .card h2 { margin: 0; font-size: 20px; }
    .card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .badge { border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 800; }
    .badge.ok { background: var(--ok-bg); color: var(--ok); }
    .badge.warning { background: var(--warn-bg); color: var(--warn); }
    .badge.degraded { background: var(--bad-bg); color: var(--bad); }
    .rows { border: 1px solid #e8eef6; border-radius: 14px; overflow: hidden; background: var(--panel); }
    .row { display: flex; justify-content: space-between; gap: 14px; padding: 12px 14px; border-top: 1px solid #e8eef6; }
    .row:first-of-type { border-top: 0; }
    .label { color: var(--muted); }
    .value { font-weight: 700; text-align: right; overflow-wrap: anywhere; }
    .list { margin-top: 12px; border-radius: 14px; padding: 12px; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-line; }
    .list.degraded { background: var(--bad-bg); color: #991b1b; }
    .list.warning { background: var(--warn-bg); color: #9a3412; }
    .empty { background: var(--warn-bg); color: #9a3412; }
    footer { margin-top: 18px; color: var(--muted); font-size: 13px; padding-left: 4px; }
    @media (max-width: 900px) {
      header { flex-direction: column; }
      .grid { grid-template-columns: 1fr; }
      h1 { font-size: 25px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Статус EDU POS</h1>
        <p class="muted">Бэкенд, база данных и миграции Prisma. Автообновление: 60 сек.</p>
      </div>
      <span class="pill ${overall}">${this.overallLabel(overall)}</span>
    </header>
    <section class="grid">${cards}</section>
    <footer>Обновлено: ${this.escapeHtml(new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' }))}, Бишкек</footer>
  </main>
</body>
</html>`;
  }

  private async externalEnvironment(name: 'dev' | 'main', url?: string): Promise<ExternalEnvironmentStatus | null> {
    if (!url) return null;
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    try {
      await prisma.$queryRaw`SELECT 1`;
      const local = await this.localMigrationNames();
      const applied = await this.appliedMigrationNames(prisma);
      const migrations = this.compareMigrations(local, applied);
      return {
        name,
        status: migrations.status,
        database: 'ok' as DbStatus,
        migrations,
      };
    } catch (err) {
      return {
        name,
        status: 'degraded' as HealthStatus,
        database: 'error' as DbStatus,
        migrations: await this.localOnlyMigrations(),
        error: this.errorMessage(err),
      };
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  }

  private async attachExternalBackendHealth(status: ExternalEnvironmentStatus, url?: string) {
    if (!url) {
      status.backend = 'error';
      status.backendError = 'MONITOR_DEV_HEALTH_URL не задан, поэтому коммит dev backend не отображается.';
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(this.normalizeHealthUrl(url), { signal: controller.signal });
      if (!response.ok) {
        status.backend = 'error';
        status.backendError = `Dev backend ответил HTTP ${response.status}`;
        status.status = status.status === 'degraded' ? 'degraded' : 'warning';
        return;
      }
      const health = await response.json() as Partial<AppHealth>;
      status.backend = 'ok';
      status.commit = health.commit ?? null;
      if (health.status === 'degraded') status.status = 'degraded';
      if (health.status === 'warning' && status.status === 'ok') status.status = 'warning';
    } catch (err) {
      status.backend = 'error';
      status.backendError = `Dev backend недоступен: ${this.errorMessage(err)}`;
      status.status = status.status === 'degraded' ? 'degraded' : 'warning';
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeHealthUrl(url: string) {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (trimmed.endsWith('/api/health') || trimmed.endsWith('/health')) return trimmed;
    return `${trimmed}/api/health`;
  }

  private async localMigrationNames() {
    const dir = path.join(process.cwd(), 'prisma', 'migrations');
    let entries: import('fs').Dirent[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  }

  private async appliedMigrationNames(client: Pick<PrismaClient, '$queryRawUnsafe'>) {
    const rows = await client.$queryRawUnsafe<AppliedMigrationRow[]>(
      'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name ASC',
    );
    return rows;
  }

  private compareMigrations(local: string[], appliedRows: AppliedMigrationRow[]): MigrationStatus {
    const applied = appliedRows
      .filter((row) => row.finished_at && !row.rolled_back_at)
      .map((row) => row.migration_name)
      .sort((a, b) => a.localeCompare(b));
    const appliedSet = new Set(applied);
    const missing = local.filter((name) => !appliedSet.has(name));
    const extraApplied = applied.filter((name) => !local.includes(name));
    const failed = appliedRows
      .filter((row) => (!row.finished_at || row.rolled_back_at) && !appliedSet.has(row.migration_name))
      .map((row) => row.migration_name);
    const behind = missing.length > 0 || failed.length > 0;
    const warning = !behind && extraApplied.length > 0;
    return {
      status: behind ? 'degraded' : warning ? 'warning' : 'ok',
      localCount: local.length,
      appliedCount: applied.length,
      behind,
      missing,
      extraApplied,
      latestLocal: local.at(-1) ?? null,
      latestApplied: applied.at(-1) ?? null,
      failed,
    };
  }

  private async localOnlyMigrations(): Promise<MigrationStatus> {
    const local = await this.localMigrationNames();
    return {
      status: 'degraded',
      localCount: local.length,
      appliedCount: 0,
      behind: true,
      missing: local,
      extraApplied: [],
      latestLocal: local.at(-1) ?? null,
      latestApplied: null,
      failed: [],
    };
  }

  private renderCurrentCard(title: string, status: AppHealth) {
    return this.renderCard({
      title,
      status: status.status,
      database: status.database,
      env: status.env,
      commit: status.commit,
      migrations: status.migrations,
      error: status.error,
    });
  }

  private renderExternalCard(title: string, status: {
    name: string;
    status: HealthStatus;
    database: DbStatus;
    migrations: MigrationStatus;
    error?: string;
    commit?: string | null;
    backend?: DbStatus;
    backendError?: string;
  }) {
    return this.renderCard({
      title,
      status: status.status,
      database: status.database,
      env: status.name,
      commit: status.commit ?? null,
      commitHint: status.backendError ? 'не подключен' : null,
      backend: status.backend,
      migrations: status.migrations,
      error: status.error,
      backendError: status.backendError,
    });
  }

  private renderCard(input: {
    title: string;
    status: HealthStatus;
    database: DbStatus;
    env: string;
    commit: string | null;
    commitHint?: string | null;
    backend?: DbStatus;
    migrations: MigrationStatus;
    error?: string;
    backendError?: string;
  }) {
    const migrationProblem = input.migrations.missing.length > 0 || input.migrations.failed.length > 0;
    const migrationWarning = !migrationProblem && input.migrations.extraApplied.length > 0;
    return `<article class="card">
  <div class="card-head">
    <h2>${this.escapeHtml(input.title)}</h2>
    <span class="badge ${input.status}">${this.statusLabel(input.status)}</span>
  </div>
  <div class="rows">
    ${this.row('Окружение', this.envLabel(input.env))}
    ${input.backend ? this.row('Backend', input.backend === 'ok' ? 'доступен' : 'не подключен') : ''}
    ${this.row('База данных', input.database === 'ok' ? 'доступна' : 'недоступна')}
    ${input.commit ? this.row('Коммит', input.commit.slice(0, 8)) : input.commitHint ? this.row('Коммит', input.commitHint) : ''}
    ${this.row('Миграций в коде', String(input.migrations.localCount))}
    ${this.row('Миграций в базе', String(input.migrations.appliedCount))}
    ${this.row('Последняя в коде', input.migrations.latestLocal ?? 'нет')}
    ${this.row('Последняя в базе', input.migrations.latestApplied ?? 'нет')}
  </div>
  ${migrationProblem ? this.renderProblems(input.migrations) : ''}
  ${migrationWarning ? this.renderWarnings(input.migrations) : ''}
  ${input.error ? `<div class="list degraded">${this.escapeHtml(input.error)}</div>` : ''}
  ${input.backendError ? `<div class="list warning">${this.escapeHtml(input.backendError)}</div>` : ''}
</article>`;
  }

  private renderEmptyCard(title: string, message: string) {
    return `<article class="card">
  <div class="card-head">
    <h2>${this.escapeHtml(title)}</h2>
    <span class="badge warning">не настроено</span>
  </div>
  <div class="list empty">${this.escapeHtml(message)}</div>
</article>`;
  }

  private row(label: string, value: string) {
    return `<div class="row"><span class="label">${this.escapeHtml(label)}</span><span class="value">${this.escapeHtml(value)}</span></div>`;
  }

  private renderProblems(status: MigrationStatus) {
    const parts: string[] = [];
    if (status.missing.length > 0) {
      parts.push(`Не применены: ${status.missing.slice(0, 12).join(', ')}`);
      if (status.missing.length > 12) parts.push(`и еще ${status.missing.length - 12}`);
    }
    if (status.failed.length > 0) parts.push(`Активные ошибки миграций: ${status.failed.join(', ')}`);
    return `<div class="list degraded">${this.escapeHtml(parts.join('\n'))}</div>`;
  }

  private renderWarnings(status: MigrationStatus) {
    const text = [
      'В базе есть миграции, которых нет в текущем коде:',
      status.extraApplied.slice(0, 12).join(', '),
      status.extraApplied.length > 12 ? `и еще ${status.extraApplied.length - 12}` : '',
    ].filter(Boolean).join('\n');
    return `<div class="list warning">${this.escapeHtml(text)}</div>`;
  }

  private statusLabel(status: HealthStatus) {
    if (status === 'ok') return 'все нормально';
    if (status === 'warning') return 'предупреждение';
    return 'требует внимания';
  }

  private overallLabel(status: HealthStatus) {
    if (status === 'ok') return 'ВСЕ НОРМАЛЬНО';
    if (status === 'warning') return 'ЕСТЬ ПРЕДУПРЕЖДЕНИЕ';
    return 'ТРЕБУЕТ ВНИМАНИЯ';
  }

  private envLabel(env: string) {
    if (env === 'production') return 'production';
    if (env === 'dev') return 'dev';
    return env;
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private envName() {
    return (
      process.env.APP_ENV ||
      process.env.RAILWAY_ENVIRONMENT_NAME ||
      process.env.NODE_ENV ||
      'unknown'
    );
  }

  private commitSha() {
    return (
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT ||
      process.env.COMMIT_SHA ||
      null
    );
  }

  private errorMessage(err: unknown) {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
