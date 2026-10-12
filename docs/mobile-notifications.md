# Native notification delivery and verification

The mobile client is Expo SDK 52. Remote notifications use Expo Push Service, with
FCM on Android and APNs on iOS. They do not depend on a running Socket.IO connection
or the Android radio service. The backend remains compatible with the main PWA's
Web Push subscriptions and with existing direct FCM clients.

## Build credentials

Android EDU POS is connected to Firebase project `edu-pos-eldarchkk-20261011`
(project number `328929061435`) and Android app
`1:328929061435:android:ace62885e072d690c94a1e` for `com.edupos.mobile`.
Its FCM v1 sender is `expo-fcm-sender@edu-pos-eldarchkk-20261011.iam.gserviceaccount.com`,
with only `roles/firebasecloudmessaging.admin`. The matching key is assigned to
EAS `@eldarchkk/edu-pos-mobile`, project `e4170c03-bd0d-430d-b7e4-0fdf300c561f`.
Existing signing credentials were preserved. IAM and FCM APIs are enabled;
a real FCM `validate_only` request succeeded without sending notifications.
Actual delivery was subsequently verified on a Google Play Android emulator in
the scenarios recorded below. Credential validation and device delivery are
separate checks.
The matching Google services config is also stored as the project-only EAS file
secret `GOOGLE_SERVICES_JSON` in `development`, `preview`, and `production`, so
cloud builds can read the file even though the local JSON is ignored by Git.

For Android, create/select the Firebase Android app with package
`com.edupos.mobile`. Supply its `google-services.json` as the EAS file environment
variable `GOOGLE_SERVICES_JSON`, or place it at `mobile/google-services.json` for a
local native build. The local file is ignored by Git. Upload the corresponding
FCM v1 service account to this EAS project's Android push credentials. The Firebase
project in the file and uploaded credentials must match. A file alone does not
authorize Expo's server to send messages.

Configure the Android EAS push credentials with `eas credentials --platform android`
for the project ID in `mobile/app.json` (`extra.eas.projectId`). Select the Android
application identifier `com.edupos.mobile` and upload its Firebase FCM v1 service
account key. Keep that key outside Git. The Google services file is build input;
the service account key is the credential held by EAS. Neither is an Expo backend
environment variable. Without a dedicated matching Firebase project and these
credentials, an APK can be built and local sound tested, but background remote
delivery is not configured or device-verified.

The client builds against `EXPO_PUBLIC_API_URL` (REST and socket backend) and
`EXPO_PUBLIC_WEB_URL` (PWA origin and Android HTTPS intent-filter host). Set these
to the intended environment before prebuild and building. The current production
API is `https://edu-production-2395.up.railway.app`; the PWA is
`https://edu-pos.up.railway.app`. The backend stores Expo device tokens
and forwards notification payloads; it needs `EXPO_ACCESS_TOKEN` only when enhanced
Expo push security is enabled. Avoid copying an unrelated app's Firebase file.

For iOS, provision APNs push credentials for `com.edupos.mobile` in the same EAS
project. Use a physical device and a native development/release build to verify
push. The UI reports `unavailable` in Expo Go or without an EAS project ID, and
`subscribed` only after the backend confirms the device registration.

The backend needs outbound HTTPS access to `exp.host`. If Expo enhanced push
security is enabled, set `EXPO_ACCESS_TOKEN` on the backend. `VAPID_*` configures
the PWA, separately. `FIREBASE_SERVICE_ACCOUNT_JSON`/`BASE64` configures direct
FCM clients; the Expo client still uses the credentials attached to EAS.

Official references: [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/),
[FCM credentials](https://docs.expo.dev/push-notifications/fcm-credentials/),
[Expo send/ticket/receipt semantics](https://docs.expo.dev/push-notifications/sending-notifications/),
[SDK 52 notification APIs](https://github.com/expo/expo/tree/sdk-52/packages/expo-notifications/src).

## Android HTTPS app links

`mobile/app.config.js` declares HTTPS view intents on the configured PWA host for
`/menu/`, `/q/`, `/queue`, and `/platform`. `edupos://` links are also supported by
the navigator. Set `ANDROID_APP_LINKS_AUTOVERIFY=true` only when the PWA server
serves a valid `/.well-known/assetlinks.json` association for `com.edupos.mobile`
and the genuine release signing certificate's SHA-256 fingerprint. A locally
signed APK and an EAS/store release can have different certificates; the server
must include the relevant actual fingerprints. Serving an invented fingerprint
does not establish ownership. HTTPS verification and link routing must be tested
on the signed build and the real host. No association file is fabricated by this
change. [Expo Android app links](https://docs.expo.dev/linking/android-app-links/).

## Implemented behavior

This section describes the source in this branch. Production health and read-only
Railway status confirm backend `main` commit `4b24251`, database `ok`, and 49/49
migrations. The new push enhancements, background receipt events, and tenant QR
fix are not deployed there yet. No production transactions were performed.

- Persistent installation binding and pending logout revocations use SecureStore.
  Logout captures the departing account's access token, so account switching
  cannot unregister with another account's credentials. Failed cleanup retries
  while active and on resume. A successful new registration atomically replaces
  the previous installation token/account on the server.
- Token rotation, auth refresh, app resume, permission revocation, and temporary
  registration failures reconcile through one serialized lifecycle. Registration
  errors retry with bounded exponential delay. A revoked OS permission removes
  the server binding.
- Foreground socket/push notifications share event IDs and a bounded dedup cache.
  SDK 52's raw Android handler `dataString` is normalized before matching IDs;
  response listeners already supply mapped `data`.
  Repeated equal text with different IDs remains a distinct event. Live background
  radio handling avoids adding a second system notification when remote push is
  already registered.
- Taps wait for auth hydration and navigation readiness. Only role-appropriate
  internal destinations are accepted; recipient IDs prevent an old account's
  notification from opening the current account. Order details and the admin
  receipt section can be opened from notifications.
- Server messages specify high priority, a one-hour TTL, sound and Android channel.
  Expo batches contain at most 100 messages. Ticket/receipt errors are logged;
  transient network, HTTP 429 and HTTP 5xx errors retry with exponential delay;
  `DeviceNotRegistered` removes obsolete tokens. Receipt polling is in memory and
  outstanding receipt IDs are lost if the backend process restarts.
- Remote events cover new kitchen/bar orders and station cancellation announcements,
  waiter order notifications, receipt
  requests to admins, and printed/rejected receipt results to the waiter.

## Automated verification

```powershell
cd mobile
npm run lint
node --test tests/push.test.cjs
cd ../backend
npm run build
node --test tests/push.test.cjs
```

The mobile tests exercise failed registration, missing runtime configuration,
persisted offline logout, account switching, logout/token and logout/register
races, token rotation, permission revocation, event deduplication, and safe taps.
The dedup regression includes SDK 52's raw Android `dataString` form in both
push/socket arrival orders, plus malformed transport metadata.
The backend tests exercise channel/sound/priority, user/cafe targeting, batching,
invalid token cleanup, receipts, installation replacement, and token validation.
These tests use local fakes. They do not connect to a database or send notifications.

For the local Android QA fixture, `.parity-reference/qa/server.cjs` captures native
registrations in memory. Its token lookup requires loopback access and a random
local secret; fixture state and request logs omit device tokens. After rebuilding
with the Firebase config, restart the fixture and log in on the emulator. The
ignored QA helper can check registration or send to that synthetic user's latest
device without printing the raw token:

```powershell
node .parity-reference/qa/push-device.cjs --role WAITER --check
node .parity-reference/qa/push-device.cjs --role WAITER --mode background
node .parity-reference/qa/push-device.cjs --role WAITER --mode cold
node .parity-reference/qa/push-device.cjs --role WAITER --mode foreground --realtime
node .parity-reference/qa/push-device.cjs --receipt <ticket-id>
```

The send commands call Expo's real push endpoint only for the selected fixture
device and poll its receipt. Output contains a masked token and ticket/receipt
statuses. A successful receipt means handoff to FCM, so OS display/sound and tap
navigation still require device inspection. Android emulators need Google Play
services; ordinary process termination is different from Android force-stop.
The helper labels the payload with the selected mode; the operator must put the
device in that state first. Its default receipt polling window is three minutes.
If still pending, poll the same ticket with `--receipt` rather than sending again;
`QA_PUSH_RECEIPT_TIMEOUT_MS=900000` allows the fifteen-minute window recommended
by Expo. For foreground dedup, keep the waiter screen active and use `--realtime`;
both transports carry one event ID, so the expected result is one toast and sound.

For a cold process test, background the app, run `adb shell am kill --user current
com.edupos.mobile`, and verify `adb shell pidof com.edupos.mobile` is empty before
sending. A foreground radio service may keep it alive; on Android 13+, the
documented `adb shell cmd activity stop-app --user current com.edupos.mobile`
stops the app and services while preserving scheduled jobs/alarms. Verify the
process has exited, send, then tap the OS notification to test cold navigation.
Do not use `am force-stop` or the `am start -S` flag for this scenario.
[Android foreground-service stop testing](https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping).

## Device acceptance

On 11 October 2026 (Asia/Bishkek), a native Android build with the EDU POS Firebase
configuration was tested on a Google Play emulator using real Expo/FCM delivery:

- Foreground remote push and Socket.IO carrying one event produced one history
  entry after SDK 52 `dataString` normalization.
- Background delivery produced an OS notification.
- With the process closed using Android `stop-app`, an empty PID was confirmed
  before sending. The OS notification arrived; tapping launched the app and
  opened order 101 as WAITER, then as OWNER in Admin in separate checks.
- A repeated cold WAITER delivery had a successful Expo receipt, opened order
  101, and Android Back returned to Active Orders with order 101 visible.

These messages used synthetic accounts bound to the loopback QA fixture on port
`3009`; they did not create production business events. A separate native QA pass
confirmed serving order 102, mixed payment (cash 300 + QR 120), removal from active
orders, and a stable payment-success screen showing the receipt items and total
420. The receipt request returned 200 and showed the waiting-admin panel. ADMIN
approved a preliminary bill; Android system print rendered one page with Cyrillic,
total 420, and the non-fiscal label. The dialog was cancelled with Back. BAR board,
statistics, and drink-only stop-list updates also passed against the fixture.
Latest source checks passed mobile typecheck, 74 mobile tests, backend build, and
10 backend tests. Physical printer/KKM, phone audio, GPS, and iOS were not tested.
The consolidated report is
[android-verification.md](android-verification.md).

The remaining device acceptance checks are:

On credentialed Android and iOS builds, verify granted and denied permissions,
foreground and locked-screen receipt/order events, app backgrounding and normal
process termination, cold-start taps, token rotation after reinstall, account
switching, offline logout followed by reconnect, and disabled notification
channels. Verify one sound/banner for an event delivered through both transports.

OS delivery depends on credentials, network, system permissions, channel settings,
and device power-management rules. Android force-stop disables remote delivery
until the app is launched again. Offline logout cannot immediately remove a
remote server binding; cleanup awaits connectivity and valid captured credentials,
or a later successful installation registration. In-flight notifications may
already have reached the OS before logout.

The Android foreground radio service provides live socket audio while permitted
by the OS. It cannot promise continuous playback after force-stop or termination.
iOS background audio mode does not keep a JavaScript socket/radio permanently
alive. Remote notification delivery and continuous radio/TTS audio are separate
capabilities; neither is considered device-verified by unit tests.
