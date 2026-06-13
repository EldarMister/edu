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
    const [dev, main] = await Promise.all([
      this.externalEnvironment('dev', process.env.MONITOR_DEV_DATABASE_URL),
      this.externalEnvironment('main', process.env.MONITOR_MAIN_DATABASE_URL),
    ]);
    return { current, dev, main };
  }

  async statusText(target?: 'current' | 'dev' | 'main' | 'project' | 'migrations'): Promise<string> {
    if (target === 'dev') return this.externalText('dev', process.env.MONITOR_DEV_DATABASE_URL);
    if (target === 'main') return this.externalText('main', process.env.MONITOR_MAIN_DATABASE_URL);
    if (target === 'project') return this.projectText();
    if (target === 'migrations') {
      const status = await this.currentMigrations();
      return this.formatMigrations('current', status);
    }
    return this.formatHealth(await this.current());
  }

  async hasProblem(): Promise<boolean> {
    const project = await this.project();
    return [project.current, project.dev, project.main].some((item) => item?.status === 'degraded');
  }

  private async projectText() {
    const project = await this.project();
    const parts = [
      this.formatHealth(project.current),
      project.dev ? this.formatExternal(project.dev) : 'dev: not configured',
      project.main ? this.formatExternal(project.main) : 'main: not configured',
    ];
    return parts.join('\n\n');
  }

  private async externalText(name: 'dev' | 'main', url?: string) {
    const status = await this.externalEnvironment(name, url);
    if (!status) return `${name}: not configured. Set MONITOR_${name.toUpperCase()}_DATABASE_URL.`;
    return this.formatExternal(status);
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

  private formatHealth(status: AppHealth) {
    return [
      `EDU POS ${status.env}: ${status.status.toUpperCase()}`,
      `DB: ${status.database}`,
      `Commit: ${status.commit ?? 'unknown'}`,
      this.formatMigrations('migrations', status.migrations),
      status.error ? `Error: ${status.error}` : null,
    ].filter(Boolean).join('\n');
  }

  private formatExternal(status: {
    name: string;
    status: HealthStatus;
    database: DbStatus;
    migrations: MigrationStatus;
    error?: string;
  }) {
    return [
      `${status.name}: ${status.status.toUpperCase()}`,
      `DB: ${status.database}`,
      this.formatMigrations('migrations', status.migrations),
      status.error ? `Error: ${status.error}` : null,
    ].filter(Boolean).join('\n');
  }

  private formatMigrations(label: string, status: MigrationStatus) {
    const lines = [
      `${label}: ${status.status.toUpperCase()}`,
      `Local: ${status.localCount}`,
      `Applied: ${status.appliedCount}`,
      `Latest local: ${status.latestLocal ?? 'none'}`,
      `Latest applied: ${status.latestApplied ?? 'none'}`,
    ];
    if (status.missing.length > 0) {
      lines.push(`Missing: ${status.missing.slice(0, 8).join(', ')}`);
      if (status.missing.length > 8) lines.push(`...and ${status.missing.length - 8} more`);
    }
    if (status.failed.length > 0) lines.push(`Failed: ${status.failed.join(', ')}`);
    return lines.join('\n');
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
