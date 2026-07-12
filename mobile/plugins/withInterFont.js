const { withAndroidStyles, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs/promises');
const path = require('path');

/** Apply the same Inter family as the PWA to every native Android TextView. */
module.exports = function withInterFont(config) {
  config = withAndroidStyles(config, (configWithStyles) => {
    const styles = configWithStyles.modResults.resources.style ?? [];
    const appTheme = styles.find((style) => style.$?.name === 'AppTheme');
    if (!appTheme) return configWithStyles;

    appTheme.item = appTheme.item ?? [];
    const fontItem = appTheme.item.find((item) => item.$?.name === 'android:fontFamily');
    if (fontItem) fontItem._ = '@font/inter';
    else appTheme.item.push({ $: { name: 'android:fontFamily' }, _: '@font/inter' });
    return configWithStyles;
  });
  return withDangerousMod(config, [
    'android',
    async (configWithFonts) => {
      const projectRoot = configWithFonts.modRequest.projectRoot;
      const fontDir = path.join(configWithFonts.modRequest.platformProjectRoot, 'app/src/main/res/font');
      await fs.mkdir(fontDir, { recursive: true });
      await Promise.all([
        ['Inter-Regular.ttf', 'inter_regular.ttf'],
        ['Inter-Medium.ttf', 'inter_medium.ttf'],
        ['Inter-SemiBold.ttf', 'inter_semibold.ttf'],
      ].map(([source, target]) => fs.copyFile(path.join(projectRoot, 'assets/fonts', source), path.join(fontDir, target))));
      await fs.writeFile(
        path.join(fontDir, 'inter.xml'),
        `<?xml version="1.0" encoding="utf-8"?>\n<font-family xmlns:android="http://schemas.android.com/apk/res/android">\n  <font android:fontStyle="normal" android:fontWeight="400" android:font="@font/inter_regular" />\n  <font android:fontStyle="normal" android:fontWeight="500" android:font="@font/inter_medium" />\n  <font android:fontStyle="normal" android:fontWeight="600" android:font="@font/inter_semibold" />\n</font-family>\n`,
      );
      return configWithFonts;
    },
  ]);
};
