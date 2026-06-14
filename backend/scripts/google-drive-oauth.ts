import { google } from 'googleapis';

const redirectUri = process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI ?? 'http://localhost';
const mode = process.argv[2];

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function createClient() {
  return new google.auth.OAuth2(
    requiredEnv('GOOGLE_DRIVE_CLIENT_ID'),
    requiredEnv('GOOGLE_DRIVE_CLIENT_SECRET'),
    redirectUri,
  );
}

async function printAuthorizeUrl() {
  const client = createClient();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive.file'],
  });

  // eslint-disable-next-line no-console
  console.log(url);
}

async function exchangeCode() {
  const client = createClient();
  const code = requiredEnv('GOOGLE_DRIVE_OAUTH_CODE');
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error('No refresh_token returned. Re-run authorize step with prompt=consent and use a fresh code.');
  }

  // eslint-disable-next-line no-console
  console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
}

async function main() {
  if (mode === 'url') {
    await printAuthorizeUrl();
    return;
  }

  if (mode === 'token') {
    await exchangeCode();
    return;
  }

  throw new Error('Usage: ts-node scripts/google-drive-oauth.ts <url|token>');
}

void main();
