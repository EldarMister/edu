const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const identity = (value) => value;
const runtime = {
  ThemeScope: 'ThemeScope',
  useThemeMode: () => 'light',
  useThemeColor: () => identity,
  useThemeColors: () => theme.colors,
  useThemedStyle: identity,
};

const moduleValue = { exports: {} };
const source = fs.readFileSync(path.join(__dirname, '../../src/theme/index.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
vm.runInNewContext(outputText, {
  module: moduleValue,
  exports: moduleValue.exports,
  require(name) {
    if (name === './runtime') return runtime;
    throw new Error(`Unexpected theme dependency: ${name}`);
  },
});
const theme = moduleValue.exports;

// Component-level tests leave native views opaque. The themed wrappers use
// those same primitives so existing assertions still inspect the native slots.
function nativeThemeModules(native, safeArea = {}) {
  const elements = ['View', 'ScrollView', 'FlatList', 'ActivityIndicator', 'RefreshControl'];
  return {
    '@/theme': theme,
    '@/theme/runtime': runtime,
    '@/components/themed': {
      ...Object.fromEntries(elements.map((name) => [name, native[name] ?? name])),
      SafeAreaView: safeArea.SafeAreaView ?? 'SafeAreaView',
      PaperView: native.View ?? 'View',
    },
  };
}

module.exports = { nativeThemeModules };
