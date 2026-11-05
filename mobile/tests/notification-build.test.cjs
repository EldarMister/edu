const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFirebaseConfig } = require('../plugins/withNativeNotifications');

function credentials(packageName = 'com.edupos.mobile') {
  return { project_info: { project_id: 'test-project', project_number: '123' },
    client: [{ client_info: { mobilesdk_app_id: '1:123:android:test', android_client_info: { package_name: packageName } }, api_key: [{ current_key: 'test-key' }] }] };
}

test('Android push build config requires the correct package and a consistent sender', () => {
  assert.doesNotThrow(() => validateFirebaseConfig(JSON.stringify(credentials()), 'com.edupos.mobile'));
  assert.throws(() => validateFirebaseConfig(JSON.stringify(credentials('com.unrelated.app')), 'com.edupos.mobile'), /must match/);
  const wrongSender = credentials(); wrongSender.project_info.project_number = '456';
  assert.throws(() => validateFirebaseConfig(JSON.stringify(wrongSender), 'com.edupos.mobile'), /must match/);
  assert.throws(() => validateFirebaseConfig('{}', 'com.edupos.mobile'), /must match/);
  assert.throws(() => validateFirebaseConfig('{"private-fragment":', 'com.edupos.mobile'), error => error.message === 'Invalid Android Firebase configuration.');
});
