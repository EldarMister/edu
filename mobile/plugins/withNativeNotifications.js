const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');

function validateFirebaseConfig(contents, applicationId) {
  let value;
  try { value = JSON.parse(contents); } catch { throw new Error('Invalid Android Firebase configuration.'); }
  const project = value?.project_info;
  const client = value?.client?.find((entry) => entry?.client_info?.android_client_info?.package_name === applicationId);
  if (!project?.project_id || !/^\d+$/.test(project?.project_number || '') ||
      !client?.client_info?.mobilesdk_app_id?.startsWith(`1:${project.project_number}:android:`) ||
      !client?.api_key?.some((key) => typeof key.current_key === 'string' && key.current_key.length > 0)) {
    throw new Error('Android Firebase configuration must match this app package and Firebase project.');
  }
}

function withNativeNotifications(config) {
  config = withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    // SDK 52 supports a branded large icon through manifest metadata; the small
    // status-bar icon remains the monochrome drawable created by expo-notifications.
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app,
      'expo.modules.notifications.large_notification_icon', '@drawable/notification_brand', 'resource');
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    const root = mod.modRequest.projectRoot;
    const firebase = mod.android?.googleServicesFile;
    if (!firebase || !fs.existsSync(path.resolve(root, firebase))) {
      throw new Error('Android push requires GOOGLE_SERVICES_JSON or mobile/google-services.json before prebuild.');
    }
    validateFirebaseConfig(fs.readFileSync(path.resolve(root, firebase), 'utf8'), mod.android.package);
    const target = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/drawable-nodpi');
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(path.join(root, 'assets/ep-mark.png'), path.join(target, 'notification_brand.png'));
    return mod;
  }]);
}

module.exports = withNativeNotifications;
module.exports.validateFirebaseConfig = validateFirebaseConfig;
