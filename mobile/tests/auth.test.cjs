const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup() {
  let request, failure;
  const retried = [];
  let refreshCalls = 0;
  let resolveRefresh, rejectRefresh;
  const refresh = new Promise((resolve, reject) => { resolveRefresh = resolve; rejectRefresh = reject; });
  const client = async config => { retried.push(config); return { data: 'retried' }; };
  client.interceptors = { request: { use: handler => request = handler }, response: { use: (_success, handler) => failure = handler } };
  const state = { user: { id: 'first' }, accessToken: 'old-access', refreshToken: 'old-refresh', setTokens: (access, token) => { state.accessToken = access; state.refreshToken = token; }, logout: () => { state.user = null; state.accessToken = null; state.refreshToken = null; } };
  const axios = { create: () => client, post: () => { refreshCalls++; return refresh; }, isAxiosError: () => true };
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/api.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require: name => ({ axios, '@/store/auth': { useAuth: { getState: () => state } }, '@/config/env': { API_URL: 'https://test.invalid', API_BASE: 'https://test.invalid/api' } })[name] });
  return { state, request: () => request({ headers: {} }), failure: config => failure({ response: { status: 401 }, config }), resolveRefresh, rejectRefresh, retried, refreshCalls: () => refreshCalls };
}
test('concurrent expired requests share one refresh and retry with renewed token', async () => {
  const env = setup();
  const first = env.failure(env.request()); const second = env.failure(env.request());
  env.resolveRefresh({ data: { accessToken: 'new-access', refreshToken: 'new-refresh' } });
  await Promise.all([first, second]);
  assert.equal(env.refreshCalls(), 1);
  assert.equal(env.retried.length, 2);
  assert.equal(env.state.accessToken, 'new-access');
});
test('late 401 from same session reuses refreshed access token without another refresh', async () => {
  const env = setup(); const config = env.request();
  env.state.accessToken = 'new-access';
  await env.failure(config);
  assert.equal(env.refreshCalls(), 0);
  assert.equal(env.retried[0].headers.Authorization, 'Bearer new-access');
});
test('refresh completion cannot replace a newly logged in account', async () => {
  const env = setup(); const pending = env.failure(env.request());
  env.state.user = { id: 'second' }; env.state.accessToken = 'second-access'; env.state.refreshToken = 'second-refresh';
  env.resolveRefresh({ data: { accessToken: 'first-access', refreshToken: 'first-refresh' } });
  await assert.rejects(pending);
  assert.equal(env.state.accessToken, 'second-access'); assert.equal(env.retried.length, 0);
});
test('refresh failure cannot log out a new account', async () => {
  const env = setup(); const pending = env.failure(env.request());
  env.state.user = { id: 'second' }; env.state.refreshToken = 'second-refresh';
  env.rejectRefresh(new Error('offline'));
  await assert.rejects(pending); assert.equal(env.state.user.id, 'second');
});
test('old account requests are never retried under a different account', async () => {
  const env = setup(); const config = env.request(); env.state.user = { id: 'second' };
  await assert.rejects(env.failure(config)); assert.equal(env.refreshCalls(), 0); assert.equal(env.retried.length, 0);
});
