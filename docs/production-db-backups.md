# Production database backups

This project backs up the production PostgreSQL database every day with GitHub Actions and stores the backup files in Google Drive.

## Architecture

Railway should be used as the first recovery layer by enabling native database backups/PITR in the Railway dashboard. This repository adds an external recovery layer: a scheduled GitHub Actions workflow runs `pg_dump`, uploads the dump to Google Drive, deletes old backup files, and sends a failure notification.

```text
GitHub Actions schedule
  -> pg_dump production PostgreSQL
  -> optional OpenSSL encryption
  -> Google Drive upload
  -> retention cleanup
  -> GitHub log artifact and optional failure notification
```

## Files

```text
.github/workflows/backup-prod-db.yml
backend/scripts/backup-postgres-to-drive.ts
backend/scripts/google-drive-oauth.ts
backend/package.json
backend/package-lock.json
backend/.env.example
docs/production-db-backups.md
```

## Schedule

The workflow runs daily at `21:10 UTC`, which is `03:10 Asia/Bishkek`.

It also supports manual runs from GitHub:

```text
GitHub -> Actions -> Backup production database -> Run workflow
```

It can also be started from Telegram with:

```text
/backup
```

## Required secrets and variables

Configure these in:

```text
GitHub repository -> Settings -> Secrets and variables -> Actions
```

Required repository secrets for personal Google Drive:

```text
PROD_DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME
GOOGLE_DRIVE_FOLDER_ID=...
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
GOOGLE_DRIVE_REFRESH_TOKEN=...
```

Alternative secret for Shared Drive / Google Workspace setups:

```text
GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON=...
```

Recommended repository secret:

```text
BACKUP_ENCRYPTION_PASSWORD=long-random-password
```

Optional notification secrets:

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
BACKUP_FAILURE_WEBHOOK_URL=https://...
```

Required Railway variables for Telegram `/backup` command:

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_CHAT_ID=...
TELEGRAM_WEBHOOK_SECRET=long-random-string
GITHUB_BACKUP_DISPATCH_TOKEN=github-token-with-actions-write
GITHUB_BACKUP_REPO=EldarMister/edu
GITHUB_BACKUP_WORKFLOW_ID=backup-prod-db.yml
GITHUB_BACKUP_REF=main
```

Optional repository variables:

```text
BACKUP_RETENTION_DAYS=30
BACKUP_PREFIX=edu-pos-prod
BACKUP_PGSSLMODE=require
```

The backup script prefers personal Google Drive OAuth when `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, and `GOOGLE_DRIVE_REFRESH_TOKEN` are set. If they are absent, it falls back to `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`.

## Personal Google Drive setup

1. Open Google Cloud Console.
2. Create or select a project.
3. Enable Google Drive API.
4. Open `APIs & Services -> Credentials`.
5. Create an `OAuth client ID`.
6. Application type: `Desktop app`.
7. Copy the generated client ID and client secret.
8. Create a folder in your personal Google Drive for database backups.
9. Copy the folder ID from the Google Drive URL.
10. Add these GitHub repository secrets:

```text
GOOGLE_DRIVE_FOLDER_ID
GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET
```

11. Generate an authorization URL locally:

```bash
cd backend

$env:GOOGLE_DRIVE_CLIENT_ID="..."
$env:GOOGLE_DRIVE_CLIENT_SECRET="..."
npm run drive:oauth:url
```

12. Open the printed URL in your browser and allow access.
13. After Google redirects you, copy the `code` query parameter from the redirect URL.
14. Exchange the code for a refresh token:

```bash
$env:GOOGLE_DRIVE_CLIENT_ID="..."
$env:GOOGLE_DRIVE_CLIENT_SECRET="..."
$env:GOOGLE_DRIVE_OAUTH_CODE="paste-code-here"
npm run drive:oauth:token
```

15. Save the printed value as repository secret `GOOGLE_DRIVE_REFRESH_TOKEN`.

Default redirect URI for the helper is:

```text
http://localhost
```

If you configure a different redirect URI in Google Cloud, set it locally before running the helper:

```bash
$env:GOOGLE_DRIVE_OAUTH_REDIRECT_URI="http://localhost"
```

Folder URL example:

```text
https://drive.google.com/drive/folders/<GOOGLE_DRIVE_FOLDER_ID>
```

## Service account setup (optional)

Use this only if you have a Shared Drive / Google Workspace setup.

1. Create a service account.
2. Create a JSON key for the service account.
3. Create a Drive folder for backups.
4. Share that folder with the service account `client_email`.
5. Add the folder ID to `GOOGLE_DRIVE_FOLDER_ID`.
6. Add the JSON to `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`.

`GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` can be either raw service account JSON or base64-encoded JSON.

## Backup file names

Backup names include date and time:

```text
edu-pos-prod-2026-06-15T21-10-03-123Z.dump
edu-pos-prod-2026-06-15T21-10-03-123Z.dump.enc
```

If `BACKUP_ENCRYPTION_PASSWORD` is configured, the uploaded file has `.enc`.

## Retention policy

The script deletes Drive files in the configured folder when all of these are true:

```text
name contains BACKUP_PREFIX
createdTime is older than BACKUP_RETENTION_DAYS
trashed = false
```

Default retention is 30 days.

## Logging

Backup logs are written to the GitHub Actions job output and uploaded as an artifact:

```text
backup-prod-db-log-<github-run-id>
```

Artifact retention is 30 days.

## Failure notifications

GitHub Actions marks the run as failed when backup, upload, encryption, or retention cleanup fails.

For external notifications, configure one of these:

```text
TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
BACKUP_FAILURE_WEBHOOK_URL
```

The webhook receives JSON:

```json
{
  "status": "failed",
  "project": "edu-pos",
  "message": "Database backup failed: ...",
  "timestamp": "2026-06-15T21:10:00.000Z"
}
```

## Telegram manual backup command

The backend exposes a public Telegram webhook:

```text
POST /api/telegram/backup/webhook
```

The route is not protected by JWT because Telegram calls it directly. It is protected by:

```text
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_ALLOWED_CHAT_ID
```

Create a GitHub token for `GITHUB_BACKUP_DISPATCH_TOKEN`:

1. Open GitHub -> Settings -> Developer settings -> Personal access tokens.
2. Prefer a fine-grained token.
3. Select repository `EldarMister/edu`.
4. Grant Actions read/write access.
5. Add the token to Railway variable `GITHUB_BACKUP_DISPATCH_TOKEN`.

Set the Telegram webhook after the backend is deployed:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://YOUR_BACKEND_DOMAIN/api/telegram/backup/webhook",
    "secret_token": "YOUR_TELEGRAM_WEBHOOK_SECRET",
    "allowed_updates": ["message"]
  }'
```

Check the webhook:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

Then send this command to the bot from the allowed chat:

```text
/backup
```

The bot should reply that the GitHub backup workflow was started. The workflow result is visible in:

```text
GitHub -> Actions -> Backup production database
```

## Manual local run

Install `pg_dump` first. On Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y postgresql-client openssl
```

Run with personal Google Drive:

```bash
cd backend
BACKUP_DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DBNAME" \
GOOGLE_DRIVE_FOLDER_ID="..." \
GOOGLE_DRIVE_CLIENT_ID="..." \
GOOGLE_DRIVE_CLIENT_SECRET="..." \
GOOGLE_DRIVE_REFRESH_TOKEN="..." \
BACKUP_RETENTION_DAYS="30" \
BACKUP_PREFIX="edu-pos-prod" \
BACKUP_PGSSLMODE="require" \
npm run backup:prod
```

Service account local run remains supported:

```bash
cd backend
BACKUP_DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DBNAME" \
GOOGLE_DRIVE_FOLDER_ID="..." \
GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' \
BACKUP_RETENTION_DAYS="30" \
BACKUP_PREFIX="edu-pos-prod" \
BACKUP_PGSSLMODE="require" \
npm run backup:prod
```

## Restore from backup

Always restore into a temporary database first. Do not restore directly into production until the backup has been validated.

Download the backup from Google Drive.

If the file is encrypted:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in edu-pos-prod-YYYY-MM-DDTHH-mm-ssZ.dump.enc \
  -out edu-pos-prod-YYYY-MM-DDTHH-mm-ssZ.dump \
  -pass env:BACKUP_ENCRYPTION_PASSWORD
```

Check that the dump is readable:

```bash
pg_restore --list edu-pos-prod-YYYY-MM-DDTHH-mm-ssZ.dump | head
```

Restore to a temporary database:

```bash
export PGPASSWORD="TARGET_PASSWORD"
export PGSSLMODE="require"

createdb \
  --host TARGET_HOST \
  --port TARGET_PORT \
  --username TARGET_USER \
  edu_pos_restore_check

pg_restore \
  --host TARGET_HOST \
  --port TARGET_PORT \
  --username TARGET_USER \
  --dbname edu_pos_restore_check \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  edu-pos-prod-YYYY-MM-DDTHH-mm-ssZ.dump
```

After validation, restore to production only during a maintenance window:

```bash
export PGPASSWORD="PROD_PASSWORD"
export PGSSLMODE="require"

pg_restore \
  --host PROD_HOST \
  --port PROD_PORT \
  --username PROD_USER \
  --dbname PROD_DB \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  edu-pos-prod-YYYY-MM-DDTHH-mm-ssZ.dump
```

## Verification checklist

1. Run the workflow manually.
2. Confirm the GitHub Actions job is green.
3. Confirm the log artifact exists.
4. Confirm a new file appears in the Google Drive folder.
5. Confirm the file name includes the current date/time.
6. Run `pg_restore --list` on the downloaded file.
7. Restore the file into a temporary database.
8. Run basic checks on the temporary database:

```sql
select count(*) from users;
select count(*) from orders;
select count(*) from order_items;
select count(*) from payments;
```

## Risks and mitigations

`pg_dump` is a logical backup, not point-in-time recovery. Enable Railway native backups/PITR for faster recovery from accidental writes between daily backups.

Google Drive is external storage. Restrict access to one dedicated backup folder and use a dedicated OAuth app for backups.

Backups contain production data. Use `BACKUP_ENCRYPTION_PASSWORD`, restrict Drive folder permissions, and keep GitHub Secrets limited to admins.

GitHub scheduled workflows can be delayed. The workflow avoids the top of the hour and can be run manually. Keep Railway native backups enabled as a second layer.

A backup that was never restored is not proven. Schedule a monthly restore drill into a temporary database.

Database growth will increase dump time and file size. Monitor workflow runtime and Drive storage usage.

## Scaling

For moderate growth, keep this workflow and increase retention or move older backups to cheaper storage.

For larger databases, add weekly/monthly archival tiers and keep daily backups short-retention.

For high recovery requirements, use Railway PITR or another managed PostgreSQL provider with continuous WAL archiving.

For very large databases, prefer provider-level physical backups plus WAL archiving. Keep logical `pg_dump` for selected tables or periodic compliance snapshots.

For stricter security, replace Google Drive with object storage that supports lifecycle policies, immutable retention, and separate encryption keys.
