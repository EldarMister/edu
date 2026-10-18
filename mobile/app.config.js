const fs = require('fs');
const path = require('path');

// EAS file environment variables resolve to a temporary file during a build.
// Local native builds can use mobile/google-services.json from the Firebase project.
module.exports = ({ config }) => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  const localCredentials = path.join(__dirname, 'google-services.json');
  const webHost = new URL(process.env.EXPO_PUBLIC_WEB_URL || 'https://edu-pos.up.railway.app').hostname;
  return {
    ...config,
    android: {
      ...config.android,
      intentFilters: [
        ...(config.android.intentFilters || []),
        {
          action: 'VIEW',
          autoVerify: process.env.ANDROID_APP_LINKS_AUTOVERIFY === 'true',
          category: ['BROWSABLE', 'DEFAULT'],
          data: ['/menu/', '/q/', '/queue', '/platform'].map((pathPrefix) => ({ scheme: 'https', host: webHost, pathPrefix })),
        },
      ],
      ...(googleServicesFile ? { googleServicesFile } : fs.existsSync(localCredentials) ? { googleServicesFile: './google-services.json' } : {}),
    },
  };
};
