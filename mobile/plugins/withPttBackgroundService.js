const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withPttBackgroundService(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults.manifest;
    manifest.$ = manifest.$ ?? {};
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';

    const application = manifest.application?.[0];
    if (!application) return configWithManifest;

    application.service = application.service ?? [];
    const serviceName = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
    let service = application.service.find((item) => item.$?.['android:name'] === serviceName);

    if (!service) {
      service = { $: { 'android:name': serviceName } };
      application.service.push(service);
    }

    service.$ = service.$ ?? {};
    service.$['android:exported'] = 'false';
    service.$['android:foregroundServiceType'] = 'mediaPlayback';
    service.$['tools:node'] = 'merge';

    return configWithManifest;
  });
};
