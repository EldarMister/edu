import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { google } from 'googleapis';

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
};

type PersonalDriveOAuthConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  lines: string[];
};

const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? '30');
const backupPrefix = process.env.BACKUP_PREFIX ?? 'edu-pos-prod';
const pgDumpBin = process.env.PG_DUMP_BIN ?? 'pg_dump';
const opensslBin = process.env.OPENSSL_BIN ?? 'openssl';
const pgSslMode = process.env.BACKUP_PGSSLMODE ?? 'require';
const notifySuccess = process.env.BACKUP_NOTIFY_ON_SUCCESS === '1';

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function makeLogger(): Logger {
  const lines: string[] = [];
  const write = (level: 'info' | 'warn' | 'error', message: string) => {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
    lines.push(line);
    // eslint-disable-next-line no-console
    console[level === 'error' ? 'error' : 'log'](line);
  };

  return {
    lines,
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
  };
}

function timestampForFileName() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseDatabaseUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (!url.hostname || !database || !url.username) {
    throw new Error('BACKUP_DATABASE_URL must include host, user, and database name');
  }

  return {
    host: url.hostname,
    port: url.port || '5432',
    database,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

async function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv, logger: Logger) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) logger.info(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) logger.warn(text);
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

function loadServiceAccountKey(): ServiceAccountKey {
  const raw = requiredEnv('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON');
  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const parsed = JSON.parse(json) as Partial<ServiceAccountKey>;

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON must contain client_email and private_key');
  }

  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
  };
}

function loadPersonalDriveOAuthConfig(): PersonalDriveOAuthConfig | null {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;

  if (!clientId && !clientSecret && !refreshToken) {
    return null;
  }

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN must all be set for personal Google Drive backups',
    );
  }

  return {
    clientId,
    clientSecret,
    refreshToken,
  };
}

async function createDriveClient() {
  const personalOAuth = loadPersonalDriveOAuthConfig();

  if (personalOAuth) {
    const auth = new google.auth.OAuth2(personalOAuth.clientId, personalOAuth.clientSecret);
    auth.setCredentials({ refresh_token: personalOAuth.refreshToken });
    await auth.getAccessToken();
    return google.drive({ version: 'v3', auth });
  } else {
    const key = loadServiceAccountKey();
    const auth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    await auth.authorize();
    return google.drive({ version: 'v3', auth });
  }
}

async function uploadToDrive(filePath: string, fileName: string, driveFolderId: string, logger: Logger) {
  const drive = await createDriveClient();
  const stat = await fs.stat(filePath);

  logger.info(`Uploading ${fileName} (${stat.size} bytes) to Google Drive`);
  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [driveFolderId],
    },
    media: {
      mimeType: 'application/octet-stream',
      body: createReadStream(filePath),
    },
    fields: 'id,name,size,createdTime,webViewLink',
    supportsAllDrives: true,
  });

  const file = response.data;
  logger.info(`Uploaded backup to Drive: id=${file.id}, name=${file.name}`);
  return { drive, file };
}

async function deleteExpiredBackups(
  drive: Awaited<ReturnType<typeof createDriveClient>>,
  driveFolderId: string,
  logger: Logger,
) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const escapedPrefix = backupPrefix.replace(/'/g, "\\'");
  const escapedFolderId = driveFolderId.replace(/'/g, "\\'");
  const q = [
    `'${escapedFolderId}' in parents`,
    `name contains '${escapedPrefix}'`,
    `createdTime < '${cutoff}'`,
    'trashed = false',
  ].join(' and ');

  const response = await drive.files.list({
    q,
    fields: 'files(id,name,createdTime)',
    pageSize: 1000,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = response.data.files ?? [];
  if (files.length === 0) {
    logger.info(`Retention cleanup: no backups older than ${retentionDays} days`);
    return;
  }

  for (const file of files) {
    if (!file.id) continue;
    await drive.files.delete({ fileId: file.id, supportsAllDrives: true });
    logger.info(`Deleted expired backup: ${file.name} (${file.createdTime})`);
  }
}

async function notify(message: string, isFailure: boolean, logger: Logger) {
  const requests: Promise<Response>[] = [];
  const webhookUrl = process.env.BACKUP_FAILURE_WEBHOOK_URL;
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;

  if (!isFailure && !notifySuccess) {
    return;
  }

  if (webhookUrl) {
    requests.push(
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: isFailure ? 'failed' : 'ok',
          project: 'edu-pos',
          message,
          timestamp: new Date().toISOString(),
        }),
      }),
    );
  }

  if (telegramToken && telegramChatId) {
    requests.push(
      fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: message,
          disable_web_page_preview: true,
        }),
      }),
    );
  }

  if (requests.length === 0) {
    if (isFailure) logger.warn('No failure notification channel configured');
    return;
  }

  const results = await Promise.allSettled(requests);
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.warn(`Notification request failed: ${result.reason}`);
      continue;
    }
    if (!result.value.ok) {
      logger.warn(`Notification endpoint returned HTTP ${result.value.status}`);
    }
  }
}

async function encryptBackup(inputPath: string, outputPath: string, logger: Logger) {
  if (!process.env.BACKUP_ENCRYPTION_PASSWORD) {
    return inputPath;
  }

  logger.info('Encrypting backup with AES-256-CBC');
  await runCommand(
    opensslBin,
    [
      'enc',
      '-aes-256-cbc',
      '-salt',
      '-pbkdf2',
      '-iter',
      '200000',
      '-in',
      inputPath,
      '-out',
      outputPath,
      '-pass',
      'env:BACKUP_ENCRYPTION_PASSWORD',
    ],
    process.env,
    logger,
  );
  return outputPath;
}

async function main() {
  const logger = makeLogger();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-pos-db-backup-'));
  const timestamp = timestampForFileName();
  const baseFileName = `${backupPrefix}-${timestamp}.dump`;
  const dumpPath = path.join(tempDir, baseFileName);
  const encryptedPath = `${dumpPath}.enc`;

  try {
    const backupDatabaseUrl = requiredEnv('BACKUP_DATABASE_URL');
    const driveFolderId = requiredEnv('GOOGLE_DRIVE_FOLDER_ID');
    const connection = parseDatabaseUrl(backupDatabaseUrl);
    logger.info(`Starting PostgreSQL backup for ${connection.host}:${connection.port}/${connection.database}`);

    await runCommand(
      pgDumpBin,
      [
        '--format=custom',
        '--compress=9',
        '--no-owner',
        '--no-acl',
        '--host',
        connection.host,
        '--port',
        connection.port,
        '--username',
        connection.user,
        '--dbname',
        connection.database,
        '--file',
        dumpPath,
      ],
      {
        ...process.env,
        PGPASSWORD: connection.password,
        PGSSLMODE: pgSslMode,
      },
      logger,
    );

    const uploadPath = await encryptBackup(dumpPath, encryptedPath, logger);
    const uploadName = path.basename(uploadPath);
    const { drive, file } = await uploadToDrive(uploadPath, uploadName, driveFolderId, logger);
    await deleteExpiredBackups(drive, driveFolderId, logger);

    const successMessage = `Database backup completed: ${uploadName}${file.webViewLink ? `\n${file.webViewLink}` : ''}`;
    logger.info(successMessage);
    await notify(successMessage, false, logger);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Database backup failed: ${message}`);
    await notify(`Database backup failed: ${message}`, true, logger);
    process.exitCode = 1;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

void main();
