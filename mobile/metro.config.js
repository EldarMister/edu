const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// An offline, self-contained MediaPipe camera worker loaded only on explicit opt-in.
if (!config.resolver.assetExts.includes('html')) config.resolver.assetExts.push('html');
module.exports = config;
