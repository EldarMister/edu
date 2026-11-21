const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withAppBuildGradle, withProjectBuildGradle, withMainApplication } = require('@expo/config-plugins');

module.exports = function withPttBackgroundService(config) {
  config = withAppBuildGradle(config, (configWithGradle) => {
    const dependency = 'implementation("androidx.core:core:1.12.0")';
    if (!configWithGradle.modResults.contents.includes(dependency)) {
      configWithGradle.modResults.contents = configWithGradle.modResults.contents.replace(
        'dependencies {',
        `dependencies {\n    // Required by react-native-background-actions for ServiceCompat.startForeground.\n    ${dependency}`,
      );
    }
    return configWithGradle;
  });

  config = withProjectBuildGradle(config, (configWithGradle) => {
    const rule = 'resolutionStrategy.force "androidx.core:core:1.12.0"';
    if (!configWithGradle.modResults.contents.includes(rule)) {
      configWithGradle.modResults.contents += `\n\n// Keep every native module on the AndroidX Core API required by the PTT service.\nallprojects {\n    configurations.all {\n        ${rule}\n    }\n}\n`;
    }
    const radioCmakeMarker = '// Keep native radio object paths short on Windows.';
    if (!configWithGradle.modResults.contents.includes(radioCmakeMarker)) {
      configWithGradle.modResults.contents += `
${radioCmakeMarker}
if (org.apache.tools.ant.taskdefs.condition.Os.isFamily('windows')) {
    subprojects { nativeProject ->
        if (nativeProject.name == 'react-native-audio-api') {
            nativeProject.pluginManager.withPlugin('com.android.library') {
                nativeProject.androidComponents.finalizeDsl { androidDsl ->
                    def projectKey = Integer.toHexString(nativeProject.projectDir.canonicalPath.hashCode())
                    def stagingDir = new File(System.getProperty('java.io.tmpdir'), 'edu-ptt-' + projectKey)
                    androidDsl.externalNativeBuild.cmake.buildStagingDirectory(stagingDir)
                }
            }
        }
    }
}
`;
    }
    return configWithGradle;
  });

  config = withMainApplication(config, (mod) => {
    const registration = 'packages.add(PttMicrophonePackage())';
    const file = mod.modResults;
    if (!file.contents.includes(registration)) {
      const packages = 'val packages = PackageList(this).packages';
      if (!file.contents.includes(packages)) throw new Error('Cannot register PTT microphone in MainApplication');
      file.contents = file.contents.replace(packages, packages + '\n            ' + registration);
    }
    fs.copyFileSync(path.join(__dirname, 'android/PttMicrophoneModule.kt'),
      path.join(path.dirname(file.path), 'PttMicrophoneModule.kt'));
    return mod;
  });

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
