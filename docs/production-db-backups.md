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

Required repository secrets:

```text
PROD_DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME
GOOGLE_DRIVE_FOLDER_ID=...
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

`GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` can be either raw service account JSON or base64-encoded JSON. Base64 is easier to paste safely into GitHub Secrets.

## Google Drive setup

1. Open Google Cloud Console.
2. Create or select a project.
3. Enable Google Drive API.
4. Create a service account.
5. Create a JSON key for the service account.
6. Create a folder in Google Drive for database backups.
7. Share that folder with the service account `client_email` from the JSON key.
8. Give the service account `Editor` access to that folder.
9. Copy the folder ID from the Google Drive URL.
10. Add the folder ID to `GOOGLE_DRIVE_FOLDER_ID`.
11. Add the service account JSON to `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`.

Folder URL example:

```text
https://drive.google.com/drive/folders/<GOOGLE_DRIVE_FOLDER_ID>
```

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

Run:

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

Google Drive is external storage, but a service account with broad access can still delete backups. Share only one dedicated backup folder with the service account.

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
