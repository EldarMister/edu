const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  const openShift = { id: 'shift', startedAt: '2026-11-21T09:10:00Z', endedAt: null };
  const auth = { user: { id: 'employee', role: 'KITCHEN' }, workspace: 'production' };
  const changes = [];
  let data = openShift;
  let summary = null;
  let options;
  const request = { isPending: false, variables: null, mutate(action) { changes.push(action); this.variables = action; this.isPending = true; } };
  const client = { cancelQueries: async () => {}, invalidateQueries: async () => {}, setQueryData: (_, value) => { data = value; } };
  const modules = {
    react: {
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      createContext: () => ({ Provider: 'StaffShiftProvider' }),
      useState: () => [summary, (value) => { summary = value; }],
      useRef: (() => { const ref = { current: false }; return () => ref; })(),
    },
    '@tanstack/react-query': {
      useQuery: () => ({ data }), useQueryClient: () => client,
      useMutation: (handlers) => { options = handlers; return request; },
    },
    '@/components/themed': { SafeAreaView: 'SafeAreaView', View: 'View' },
    '@/components/typography': { Text: 'Text' },
    '@/components/AppHeader': { AppHeader: 'AppHeader' },
    '@/components/BrandLogo': { BrandLogo: 'BrandLogo' },
    '@/components/ui': { Button: 'Button', Card: 'Card', Loading: 'Loading' },
    '@/components/ShiftSummarySheet': { ShiftSummarySheet: 'ShiftSummarySheet' },
    '@/components/WorkspaceSwitcher': { WorkspaceSwitcher: 'WorkspaceSwitcher' },
    '@/lib/api': { api: {}, apiError: String },
    '@/services/push': {},
    '@/services/socket': { useSocketEvent() {} },
    '@/store/auth': { useAuth: Object.assign((select) => select(auth), { getState: () => auth }) },
    '@/store/notifications': { useNotifications: (select) => select({ push() {} }) },
    '@/theme': { colors: {}, spacing: {} },
    '@/utils/format': { timeHM: String },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/components/StaffShiftGate.tsx'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, require: (name) => modules[name] });
  return {
    changes, auth,
    render: () => module.exports.StaffShiftGate({ children: 'Kitchen board' }),
    refetchedClosed: () => { data = null; },
    async finish() {
      const closed = { ...openShift, endedAt: '2026-11-21T11:20:00Z', stats: { ordersCount: 3, totalAmount: '500' } };
      await options.onSuccess(closed, 'end');
      request.isPending = false;
      options.onSettled();
      return closed;
    },
  };
}

test('closing a staff shift keeps the board open until the employee dismisses the summary', async () => {
  const env = harness();
  const gate = env.render();
  gate.props.value.end();
  gate.props.value.end();
  assert.deepEqual(env.changes, ['end']);
  env.refetchedClosed();
  assert.equal(env.render().props.children[0], 'Kitchen board');
  const closed = await env.finish();
  const sheet = env.render().props.children[1];
  assert.equal(sheet.type, 'ShiftSummarySheet');
  assert.equal(sheet.props.shift, closed);
  assert.equal(sheet.props.visible, true);
  sheet.props.onClose();
  assert.equal(env.render().type, 'SafeAreaView');
});

test('finishing a shift in a previous workspace does not open its summary in the current workspace', async () => {
  const env = harness();
  env.render().props.value.end();
  env.auth.workspace = 'admin';
  await env.finish();
  assert.equal(env.render().props.children[1].props.visible, false);
});
