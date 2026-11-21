const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// An offline, self-contained MediaPipe camera worker loaded only on explicit opt-in.
if (!config.resolver.assetExts.includes('html')) config.resolver.assetExts.push('html');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const fromOpus = /[/\\]opusscript[/\\]/.test(context.originModulePath);
  // Hermes uses the self-contained asm.js build. Its Node-only branches and
  // the unused WASM alternative don't need to be included in the native bundle.
  if (platform !== 'web' && fromOpus && ['fs', 'path', './build/opusscript_native_wasm.js'].includes(moduleName)) {
    return { type: 'empty' };
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
