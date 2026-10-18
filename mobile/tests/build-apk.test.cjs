const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../scripts/build-apk.cjs'), 'utf8');
const { isLocalHost, releaseUrl, parseArgs, releaseManifest } = require('../scripts/build-apk.cjs');

test('final APK URLs reject HTTP and local addresses while allowing explicit public HTTPS', () => {
  for (const value of ['http://example.com', 'https://127.0.0.1', 'https://localhost', 'https://localhost.', 'https://2130706433', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://10.0.2.2', 'https://192.168.1.10', 'https://172.16.1.10']) assert.throws(() => releaseUrl(value, 'API', false));
  assert.equal(releaseUrl('https://pos.example.com/', 'API', false), 'https://pos.example.com');
  assert.equal(releaseUrl('http://10.0.2.2:4000', 'API', true), 'http://10.0.2.2:4000');
  assert.equal(isLocalHost('localhost'), true);
  assert.equal(isLocalHost('fcm.googleapis.com'), false);
  assert.throws(() => releaseUrl('https://user:password@example.com', 'API', false));
});

test('QA cannot use production signing and final manifest clears QA cleartext flag', () => {
  assert.throws(() => parseArgs(['--qa', '--signing-file', 'secure.json']));
  assert.equal(parseArgs(['--qa']).qa, true);
  const original = '<manifest><application android:usesCleartextTraffic="true" android:name="App"></application></manifest>';
  assert.match(releaseManifest(original, false), /usesCleartextTraffic="false"/);
  assert.match(releaseManifest(original, true), /usesCleartextTraffic="true"/);
  assert.throws(() => releaseManifest('<manifest><application android:networkSecurityConfig="@xml/qa" /></manifest>', false));
});

function runFixture({ env = {}, args = [], credentials } = {}) {
  const mobile = path.resolve(__dirname, '../__build-fixture__');
  const secureFile = path.join(mobile, '../secure/signing.json');
  const keystore = path.resolve(path.dirname(secureFile), '../keys/release.jks');
  const files = new Map([
    [path.join(mobile, 'android/app/build.gradle'), "android { defaultConfig { applicationId 'com.edupos.mobile'; versionCode 6; versionName \"0.2.0\" } }"],
    [path.join(mobile, 'android/app/src/main/AndroidManifest.xml'), '<manifest><application android:usesCleartextTraffic="true"></application></manifest>'],
    [path.join(mobile, 'package.json'), JSON.stringify({ version: '0.2.0' })],
    [path.join(mobile, 'app.json'), JSON.stringify({ expo: { version: '0.2.0', icon: 'icon.png', splash: { image: 'splash.png' }, android: { package: 'com.edupos.mobile', versionCode: 6, adaptiveIcon: { foregroundImage: 'adaptive.png' } }, plugins: [] } })],
    ...['icon.png', 'splash.png', 'adaptive.png'].map(file => [path.join(mobile, file), 'asset']),
    [secureFile, credentials ?? JSON.stringify({ applicationIdentifier: 'com.edupos.mobile', keystorePath: '../keys/release.jks', keystorePassword: 'test-store-password', keyAlias: 'existing-key', keyPassword: 'test-key-password' })],
    [keystore, 'keystore'],
  ]);
  const requests = [];
  const logs = [];
  const moduleValue = { exports: {} };
  const requireValue = name => {
    if (name === 'node:fs') return { existsSync: file => files.has(file), readFileSync: file => { if (!files.has(file)) throw new Error('missing fixture'); return files.get(file); }, writeFileSync: (file, value) => files.set(file, value), mkdirSync() {}, copyFileSync() {} };
    if (name === 'node:path') return path;
    if (name === 'node:child_process') return { spawnSync: (command, tasks, options) => { requests.push({ command, tasks, options }); return { status: 0 }; } };
    throw new Error(`Unexpected module ${name}`);
  };
  requireValue.main = moduleValue;
  vm.runInNewContext(script, { module: moduleValue, exports: moduleValue.exports, require: requireValue, __dirname: path.join(mobile, 'scripts'), process: { argv: ['node', 'build-apk.cjs', ...args.map(arg => arg === 'SIGNING' ? secureFile : arg)], platform: process.platform, env, exit: status => { throw new Error(`Unexpected exit ${status}`); } }, console: { log: value => logs.push(value) }, URL });
  return { requests, logs, files, mobile, keystore };
}

test('signed build preserves certificate inputs, resolves relative keystore and never prints secrets', () => {
  const fixture = runFixture({ args: ['--signing-file', 'SIGNING'] });
  assert.equal(fixture.requests.length, 2);
  const env = fixture.requests[0].options.env;
  assert.equal(env.EDU_POS_KEYSTORE_PATH, fixture.keystore);
  assert.equal(env.EDU_POS_KEY_ALIAS, 'existing-key');
  assert.equal(env.EXPO_PUBLIC_API_URL, 'https://edu-production-2395.up.railway.app');
  assert.equal(env.EXPO_PUBLIC_WEB_URL, 'https://edu-pos.up.railway.app');
  assert.equal(env.EXPO_NO_DOTENV, '1');
  assert.match(fixture.files.get(path.join(fixture.mobile, 'android/app/src/main/AndroidManifest.xml')), /usesCleartextTraffic="false"/);
  assert.doesNotMatch(fixture.logs.join('\n'), /test-store-password|test-key-password|existing-key/);
  assert.doesNotMatch(fixture.files.get(path.join(fixture.mobile, 'android/app/build.gradle')), /test-store-password|test-key-password/);
});

test('QA build requires explicit override and cannot inherit release credentials', () => {
  assert.throws(() => runFixture({ env: { EXPO_PUBLIC_API_URL: 'http://10.0.2.2:4000' } }));
  const fixture = runFixture({ args: ['--qa'], env: { EXPO_PUBLIC_API_URL: 'http://10.0.2.2:4000', EDU_POS_KEYSTORE_PASSWORD: 'inherited-secret', EDU_POS_KEYSTORE_PATH: '/release.jks' } });
  assert.equal(fixture.requests[0].options.env.EDU_POS_KEYSTORE_PASSWORD, undefined);
  assert.equal(fixture.requests[0].options.env.EDU_POS_KEYSTORE_PATH, undefined);
  assert.match(fixture.logs.join('\n'), /-qa\.apk/);
});

test('malformed signing JSON never includes credential fragments in thrown errors', () => {
  assert.throws(() => runFixture({ args: ['--signing-file', 'SIGNING'], credentials: '{"password":"private-test-value",' }), error => error.message === 'Unable to read signing credentials JSON.');
});
