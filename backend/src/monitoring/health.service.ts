import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import path from 'path';
import { PrismaService } from '../prisma/prisma.service';

type DbStatus = 'ok' | 'error';
type HealthStatus = 'ok' | 'degraded';

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
    return { current, dev };
  }

  async statusPage() {
    const project = await this.project();
    const cards = [
      this.renderCurrentCard('Main database', project.current),
      project.dev
        ? this.renderExternalCard('Dev database', project.dev)
        : this.renderEmptyCard('Dev database', 'Set MONITOR_DEV_DATABASE_URL to show dev DB status.'),
    ].join('');
    const overall = [project.current, project.dev].some((item) => item?.status === 'degraded')
      ? 'degraded'
      : 'ok';

    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="60" />
  <title>EDU POS Status</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fb;
      --card: #ffffff;
      --text: #0f172a;
      --muted: #64748b;
      --border: #dbe3ef;
      --ok: #16a34a;
      --bad: #dc2626;
      --warn-bg: #fff7ed;
      --ok-bg: #ecfdf5;
      --bad-bg: #fef2f2;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 18px; }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
    h1 { margin: 0; font-size: 30px; line-height: 1.15; }
    p { margin: 0; }
    .muted { color: var(--muted); }
    .pill { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 8px 12px; font-weight: 700; font-size: 14px; }
    .pill.ok { background: var(--ok-bg); color: var(--ok); }
    .pill.degraded { background: var(--bad-bg); color: var(--bad); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .card { min-width: 0; border: 1px solid var(--border); border-radius: 14px; background: var(--card); padding: 18px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04); }
    .card h2 { margin: 0 0 12px; font-size: 18px; }
    .row { display: flex; justify-content: space-between; gap: 14px; padding: 9px 0; border-top: 1px solid #edf2f7; }
    .row:first-of-type { border-top: 0; }
    .label { color: var(--muted); }
    .value { font-weight: 700; text-align: right; overflow-wrap: anywhere; }
    .status { margin-bottom: 12px; }
    .status.ok { color: var(--ok); }
    .status.degraded { color: var(--bad); }
    .list { margin-top: 10px; border-radius: 10px; background: var(--bad-bg); padding: 10px; color: #991b1b; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    .empty { background: var(--warn-bg); color: #9a3412; }
    footer { margin-top: 18px; color: var(--muted); font-size: 13px; }
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
        <h1>EDU POS Status</h1>
        <p class="muted">Backend, database and Prisma migrations. Auto-refresh: 60s.</p>
      </div>
      <span class="pill ${overall}">${overall === 'ok' ? 'OK' : 'NEEDS ATTENTION'}</span>
    </header>
    <section class="grid">${cards}</section>
    <footer>Updated: ${this.escapeHtml(new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' }))} Bishkek time</footer>
  </main>
</body>
</html>`;
  }

  private async externalEnvironment(name: 'dev' | 'main', url?: string) {
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
    const failed = appliedRows
      .filter((row) => !row.finished_at || row.rolled_back_at)
      .map((row) => row.migration_name);
    const behind = missing.length > 0 || failed.length > 0;
    return {
      status: behind ? 'degraded' : 'ok',
      localCount: local.length,
      appliedCount: applied.length,
      behind,
      missing,
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
  }) {
    return this.renderCard({
      title,
      status: status.status,
      database: status.database,
      env: status.name,
      commit: null,
      migrations: status.migrations,
      error: status.error,
    });
  }

  private renderCard(input: {
    title: string;
    status: HealthStatus;
    database: DbStatus;
    env: string;
    commit: string | null;
    migrations: MigrationStatus;
    error?: string;
  }) {
    const migrationProblem = input.migrations.missing.length > 0 || input.migrations.failed.length > 0;
    return `<article class="card">
  <h2>${this.escapeHtml(input.title)}</h2>
  <div class="status ${input.status}">${input.status === 'ok' ? 'OK' : 'Needs attention'}</div>
  ${this.row('Environment', input.env)}
  ${this.row('Database', input.database)}
  ${input.commit ? this.row('Commit', input.commit.slice(0, 8)) : ''}
  ${this.row('Local migrations', String(input.migrations.localCount))}
  ${this.row('Applied migrations', String(input.migrations.appliedCount))}
  ${this.row('Latest local', input.migrations.latestLocal ?? 'none')}
  ${this.row('Latest applied', input.migrations.latestApplied ?? 'none')}
  ${migrationProblem ? this.renderProblems(input.migrations) : ''}
  ${input.error ? `<div class="list">${this.escapeHtml(input.error)}</div>` : ''}
</article>`;
  }

  private renderEmptyCard(title: string, message: string) {
    return `<article class="card">
  <h2>${this.escapeHtml(title)}</h2>
  <div class="status degraded">Not configured</div>
  <div class="list empty">${this.escapeHtml(message)}</div>
</article>`;
  }

  private row(label: string, value: string) {
    return `<div class="row"><span class="label">${this.escapeHtml(label)}</span><span class="value">${this.escapeHtml(value)}</span></div>`;
  }

  private renderProblems(status: MigrationStatus) {
    const parts: string[] = [];
    if (status.missing.length > 0) {
      parts.push(`Missing: ${status.missing.slice(0, 12).join(', ')}`);
      if (status.missing.length > 12) parts.push(`and ${status.missing.length - 12} more`);
    }
    if (status.failed.length > 0) parts.push(`Failed: ${status.failed.join(', ')}`);
    return `<div class="list">${this.escapeHtml(parts.join('\n'))}</div>`;
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
