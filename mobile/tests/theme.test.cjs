const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, dependencies = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, require(name) {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  return module.exports;
}
const palette = load('theme/palette.ts');
const { darkPalette, themeColor, themeStyle } = palette;
const color = (value, property = 'color') => themeColor(value, property, 'dark');
function luminance(hex) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(foreground, background) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + .05) / (dark + .05);
}

test('dark surfaces remain neutral while text and filled action/status controls keep readable contrast', () => {
  assert.equal(color('#F8FAFC', 'backgroundColor'), '#101010');
  assert.equal(color('#FFFFFF', 'backgroundColor'), '#191919');
  for (const token of ['#0F172A', '#475569', '#64748B', '#94A3B8']) {
    assert.ok(contrast(color(token), darkPalette.card) >= 4.5, token);
  }
  for (const token of ['#005BFF', '#EF4444', '#16A34A']) {
    const fill = color(token, 'backgroundColor');
    assert.ok(contrast(color('#FFFFFF'), fill) >= 4.5, token);
    assert.notEqual(fill, darkPalette.card);
    assert.ok(contrast(color(token), darkPalette.card) >= 4.5, `${token} foreground`);
  }
  assert.equal(color('#fff'), '#FFFFFF');
  assert.equal(color('#000000'), '#000000');
  assert.equal(color('#12ABCD'), '#12ABCD', 'custom artwork is not inverted');
});

test('soft status backgrounds preserve their alpha and full-opacity fills do not become pale text colors', () => {
  assert.equal(color('rgba(0, 91, 255, 0.10)', 'backgroundColor'), 'rgba(138, 182, 255, 0.10)');
  assert.equal(color('rgba(239, 68, 68, 0.10)', 'backgroundColor'), 'rgba(255, 139, 144, 0.10)');
  assert.equal(color('rgba(22, 163, 74, 0.10)', 'backgroundColor'), 'rgba(92, 211, 149, 0.10)');
  assert.notEqual(color('#005BFF', 'backgroundColor'), color('#005BFF'));
  assert.equal(color('rgba(0,91,255,0.90)', 'backgroundColor'), 'rgba(38, 100, 216, 0.90)');
  assert.equal(color('rgba(255,255,255,0.96)', 'backgroundColor'), 'rgba(25, 25, 25, 0.96)');
  assert.equal(color('rgba(255,255,255,0.25)', 'backgroundColor'), 'rgba(255,255,255,0.25)');
});

test('theme switching does not mutate shared styles or animated/transform state; light and paper styles remain exact', () => {
  const animation = Object.freeze({ value: .75 });
  const transforms = Object.freeze([{ translateX: animation }]);
  const style = Object.freeze({ backgroundColor: '#FFFFFF', color: '#0F172A', opacity: animation, transform: transforms });
  const input = Object.freeze([style, false, null, Object.freeze({ borderColor: '#E2E8F0' })]);
  const dark = themeStyle(input, 'dark');
  assert.equal(dark[0].backgroundColor, darkPalette.card);
  assert.equal(dark[0].opacity, animation);
  assert.equal(dark[0].transform, transforms);
  assert.equal(style.backgroundColor, '#FFFFFF');
  assert.equal(themeStyle(input, 'light'), input);
  assert.equal(themeColor('#FFFFFF', 'backgroundColor', 'light'), '#FFFFFF');
});

function createStore(initialize) {
  let state;
  const store = selector => selector(state);
  store.setState = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  store.getState = () => state;
  state = initialize(store.setState, store.getState);
  return store;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function storeHarness(read, systemTheme = 'light') {
  const writes = [];
  const pending = [];
  const storage = { getItem: () => read, setItem: (key, value) => {
    writes.push({ key, value });
    return new Promise(resolve => pending.push(resolve));
  } };
  let onAppearanceChange;
  const Appearance = {
    getColorScheme: () => systemTheme,
    addChangeListener: listener => { onAppearanceChange = listener; },
    setColorScheme: colorScheme => onAppearanceChange({ colorScheme }),
  };
  const { useTheme } = load('store/theme.ts', {
    '@react-native-async-storage/async-storage': storage, 'react-native': { Appearance }, zustand: { create: createStore },
  });
  return { store: useTheme, writes, pending, changeSystemTheme: colorScheme => onAppearanceChange({ colorScheme }) };
}

test('saved dark mode hydrates offline; invalid or failed storage reads still unblock startup', async () => {
  const saved = storeHarness(Promise.resolve('dark'));
  const invalid = storeHarness(Promise.resolve('unexpected'), 'dark');
  const failed = storeHarness(Promise.reject(new Error('storage unavailable')), 'dark');
  await tick();
  assert.equal(saved.store.getState().theme, 'dark');
  for (const harness of [saved, invalid, failed]) assert.equal(harness.store.getState().hydrated, true);
  assert.equal(invalid.store.getState().theme, 'dark');
  assert.equal(failed.store.getState().theme, 'dark');
});

test('Android follows the system on a fresh install and preserves a saved or newly selected override', async () => {
  const fresh = storeHarness(Promise.resolve(null), 'dark');
  const saved = storeHarness(Promise.resolve('light'), 'dark');
  assert.equal(fresh.store.getState().theme, 'dark');
  await tick();
  assert.equal(fresh.store.getState().theme, 'dark');
  assert.equal(saved.store.getState().theme, 'light');
  fresh.changeSystemTheme('light');
  assert.equal(fresh.store.getState().theme, 'light');
  fresh.changeSystemTheme('dark');
  assert.equal(fresh.store.getState().theme, 'dark');
  fresh.store.getState().setTheme('light');
  fresh.changeSystemTheme('dark');
  saved.changeSystemTheme('dark');
  assert.equal(fresh.store.getState().theme, 'light');
  assert.equal(saved.store.getState().theme, 'light');
});

test('late storage hydration cannot override a tap and rapid toggles persist in selection order', async () => {
  let resolveRead;
  const harness = storeHarness(new Promise(resolve => { resolveRead = resolve; }));
  harness.store.getState().setTheme('dark');
  resolveRead('light');
  await tick();
  assert.equal(harness.store.getState().theme, 'dark');
  harness.store.getState().setTheme('light');
  harness.store.getState().setTheme('dark');
  await tick();
  assert.deepEqual(harness.writes.map(x => x.value), ['dark']);
  harness.pending.shift()(); await tick();
  assert.deepEqual(harness.writes.map(x => x.value), ['dark', 'light']);
  harness.pending.shift()(); await tick();
  assert.deepEqual(harness.writes.map(x => x.value), ['dark', 'light', 'dark']);
  harness.pending.shift()(); await tick();
  assert.ok(harness.writes.every(x => x.key === 'edu-pos-theme'));
});

test('runtime resolves nested registered styles and a light scope overrides a saved dark preference', () => {
  let selected = 'dark';
  let context;
  const react = {
    createContext: value => (context = { value }),
    useContext: value => value.value,
    useMemo: fn => fn(), useCallback: fn => fn,
  };
  const runtime = load('theme/runtime.tsx', {
    react,
    'react-native': { StyleSheet: { flatten: id => ({ backgroundColor: '#FFFFFF', borderWidth: id }) } },
    '@/store/theme': { useTheme: selector => selector({ theme: selected }) },
    './palette': palette,
  });
  assert.equal(runtime.useThemedStyle([5, [7]])[1][0].backgroundColor, darkPalette.card);
  assert.equal(runtime.useThemeMode(), 'dark');
  context.value = 'light';
  assert.equal(runtime.useThemeMode(), 'light');
  assert.equal(runtime.useThemeColor()('#FFFFFF', 'backgroundColor'), '#FFFFFF');
  context.value = undefined;
  selected = 'light';
  assert.equal(runtime.useThemeMode(), 'light');
});
