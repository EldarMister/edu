const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_API_URL = 'https://edu-production-2395.up.railway.app';
const DEFAULT_WEB_URL = 'https://edu-pos.up.railway.app';

function isLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host.startsWith('::ffff:')) {
    const parts = host.slice(7).split(':');
    if (parts.length === 2) {
      const high = parseInt(parts[0], 16);
      const low = parseInt(parts[1], 16);
      return isLocalHost(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host === '::' || (host.includes(':') && /^(?:fc|fd|fe[89ab])/i.test(host))) return true;
  return /^(?:127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
}

function releaseUrl(value, label, qa) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a valid base URL.`); }
  if (url.username || url.password || url.search || url.hash || (!qa && (url.protocol !== 'https:' || isLocalHost(url.hostname))) || (qa && !['http:', 'https:'].includes(url.protocol))) {
    throw new Error(`${label} must use nonlocal HTTPS; local HTTP is allowed only with test-certificate --qa.`);
  }
  return url.toString().replace(/\/$/, '');
}

function parseArgs(args) {
  let signingFile;
  let qa = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--qa' && !qa) qa = true;
    else if (args[index] === '--signing-file' && !signingFile && args[index + 1] && !args[index + 1].startsWith('--')) signingFile = args[++index];
    else throw new Error('Usage: node scripts/build-apk.cjs [--signing-file /secure/signing.json] [--qa]');
  }
  if (qa && signingFile) throw new Error('QA builds must use the test certificate, not the release signing file.');
  return { signingFile, qa };
}

function releaseManifest(manifest, qa) {
  if (!/<application\b[^>]*>/.test(manifest)) throw new Error('Android application manifest is missing. Run Expo prebuild.');
  return manifest.replace(/<application\b[^>]*>/, (application) => {
    if (!qa && /android:networkSecurityConfig\s*=/.test(application)) throw new Error('Review the native network security config before a release build.');
    const cleartext = `android:usesCleartextTraffic="${qa ? 'true' : 'false'}"`;
    return /android:usesCleartextTraffic\s*=\s*"[^"]*"/.test(application)
      ? application.replace(/android:usesCleartextTraffic\s*=\s*"[^"]*"/, cleartext)
      : application.replace('<application', `<application ${cleartext}`);
  });
}

// Run expo prebuild first. Credentials stay outside the source archive and stdout.
function buildApk() {
const mobile = path.resolve(__dirname, '..');
const android = path.join(mobile, 'android');
const gradleFile = path.join(android, 'app', 'build.gradle');
if (!fs.existsSync(gradleFile)) throw new Error('Run expo prebuild --platform android --no-install first.');
const { signingFile, qa } = parseArgs(process.argv.slice(2));
const env = {
  ...process.env, NODE_ENV: 'production', EXPO_NO_DOTENV: '1',
  EXPO_PUBLIC_API_URL: releaseUrl(process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL, 'EXPO_PUBLIC_API_URL', qa),
  EXPO_PUBLIC_WEB_URL: releaseUrl(process.env.EXPO_PUBLIC_WEB_URL || DEFAULT_WEB_URL, 'EXPO_PUBLIC_WEB_URL', qa),
};
for (const key of ['EDU_POS_KEYSTORE_PATH', 'EDU_POS_KEYSTORE_PASSWORD', 'EDU_POS_KEY_ALIAS', 'EDU_POS_KEY_PASSWORD']) delete env[key];
if (signingFile) {
  const absoluteSigningFile = path.resolve(signingFile);
  let credentials;
  try { credentials = JSON.parse(fs.readFileSync(absoluteSigningFile, 'utf8')); }
  catch { throw new Error('Unable to read signing credentials JSON.'); }
  if (!credentials || credentials.applicationIdentifier !== 'com.edupos.mobile' || typeof credentials.keystorePath !== 'string') throw new Error('Signing credentials do not match this app.');
  const keystorePath = path.resolve(path.dirname(absoluteSigningFile), credentials.keystorePath);
  if (!fs.existsSync(keystorePath)) throw new Error('Signing keystore does not exist.');
  for (const key of ['keystorePassword', 'keyAlias', 'keyPassword']) if (typeof credentials[key] !== 'string' || !credentials[key]) throw new Error('Incomplete signing credentials.');
  Object.assign(env, { EDU_POS_KEYSTORE_PATH: keystorePath, EDU_POS_KEYSTORE_PASSWORD: credentials.keystorePassword, EDU_POS_KEY_ALIAS: credentials.keyAlias, EDU_POS_KEY_PASSWORD: credentials.keyPassword });
}
const marker = '// EDU POS local release signing';
let gradle = fs.readFileSync(gradleFile, 'utf8').split(marker)[0].trimEnd();
const app = JSON.parse(fs.readFileSync(path.join(mobile, 'app.json'), 'utf8')).expo;
const version = JSON.parse(fs.readFileSync(path.join(mobile, 'package.json'), 'utf8')).version;
if (app.android.package !== 'com.edupos.mobile' || app.version !== version || !Number.isSafeInteger(app.android.versionCode) || app.android.versionCode < 1) throw new Error('App package/version configuration is inconsistent.');
if (!gradle.includes(`applicationId '${app.android.package}'`) || !new RegExp(`versionCode\\s+${app.android.versionCode}\\b`).test(gradle) || !gradle.includes(`versionName "${version}"`)) throw new Error('Native app version is stale. Run Expo prebuild.');
const assets = [app.icon, app.splash.image, app.android.adaptiveIcon.foregroundImage];
for (const plugin of app.plugins || []) if (Array.isArray(plugin) && plugin[0] === 'expo-notifications') assets.push(plugin[1].icon, ...(plugin[1].sounds || []));
for (const asset of assets) if (!asset || !fs.existsSync(path.resolve(mobile, asset))) throw new Error('Required app/notification asset is missing.');
const manifestFile = path.join(android, 'app', 'src', 'main', 'AndroidManifest.xml');
const manifest = releaseManifest(fs.readFileSync(manifestFile, 'utf8'), qa);
gradle += `\n\n${marker}\nif (System.getenv('EDU_POS_KEYSTORE_PATH')) {\n    android {\n        signingConfigs {\n            release {\n                storeFile file(System.getenv('EDU_POS_KEYSTORE_PATH'))\n                storePassword System.getenv('EDU_POS_KEYSTORE_PASSWORD')\n                keyAlias System.getenv('EDU_POS_KEY_ALIAS')\n                keyPassword System.getenv('EDU_POS_KEY_PASSWORD')\n            }\n        }\n        buildTypes { release { signingConfig signingConfigs.release } }\n    }\n}\n`;
fs.writeFileSync(manifestFile, manifest);
fs.writeFileSync(gradleFile, gradle);
function run(tasks) {
  const result = spawnSync(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [...tasks, '--console=plain'], { cwd: android, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
// Gradle does not track EXPO_PUBLIC_* as source inputs: always embed this environment.
run([':app:createBundleReleaseJsAndAssets', '--rerun']);
run([':app:assembleRelease']);
const destination = path.join(mobile, 'releases', `edu-pos-${version}${qa ? '-qa' : ''}.apk`);
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(path.join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), destination);
console.log(`APK: ${destination} (${signingFile ? 'existing release certificate' : 'test certificate'}${qa ? ', QA' : ''})`);
}

module.exports = { isLocalHost, releaseUrl, parseArgs, releaseManifest };
if (require.main === module) buildApk();
