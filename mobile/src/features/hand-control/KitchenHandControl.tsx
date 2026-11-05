import React from 'react';
import { AppState, PermissionsAndroid, Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import { Text } from '@/components/typography';
import { Toggle } from '@/components/ui';
import { colors, fontSize, spacing } from '@/theme';
import { handMetrics, PinchGesture, type HandSample, type Point } from './gesture';
import { HandTargetContext, HandTargetRegistry, type TargetHit } from './targets';
import { HandControlContext, type HandStatus as Status } from './context';
import { HandPointer } from './HandPointer';
import { waitForCameraForeground } from './cameraLifecycle';

const STATUS: Record<Status, string> = {
  off: 'Управление выключено', loading: 'Подключаем камеру и модель…', searching: 'Покажите руку камере',
  found: 'Рука обнаружена', paused: 'Камера остановлена. Включите тумблер для продолжения.', error: 'Управление выключено',
};
const CameraWebView = React.memo(WebView);
const TRACKER_ORIGINS = ['file://*'];
let assetPromise: Promise<string> | null = null;
function loadTracker() {
  if (!assetPromise) assetPromise = (async () => {
    const asset = Asset.fromModule(require('../../../assets/hand-control/tracker.html'));
    await asset.downloadAsync();
    if (!asset.localUri) throw new Error('Не удалось загрузить модель управления рукой.');
    return asset.localUri;
  })().finally(() => { assetPromise = null; });
  return assetPromise;
}

/** Camera frames stay inside the local WebView worker; only landmarks reach native UI. */
export function KitchenHandControlProvider({ activeLayer, children }: { activeLayer: string; children: React.ReactNode }) {
  const [registry] = React.useState(() => new HandTargetRegistry());
  registry.activeLayer = activeLayer;
  const targets = React.useMemo(() => ({ registry, layer: 'board' }), [registry]);
  const [status, setStatus] = React.useState<Status>('off');
  const [error, setError] = React.useState('');
  const [trackerUri, setTrackerUri] = React.useState<string | null>(null);
  const [cursor, setCursor] = React.useState<(Point & { locked: boolean }) | null>(null);
  const [highlight, setHighlight] = React.useState<TargetHit | null>(null);
  const surface = React.useRef<View>(null);
  const web = React.useRef<WebView>(null);
  const generation = React.useRef(0);
  const requested = React.useRef(false);
  const requestingPermission = React.useRef(false);
  const gesture = React.useRef(new PinchGesture<TargetHit>());
  const position = React.useRef<Point | null>(null);
  const lastSample = React.useRef(0);
  const sampleVersion = React.useRef(0);
  const layerChangedAt = React.useRef(0);
  const geometry = React.useRef({ x: 0, y: 0, width: 0, height: 0 });

  const clearPointer = React.useCallback(() => {
    sampleVersion.current++;
    gesture.current.reset(); position.current = null;
    setCursor(null); setHighlight(null);
  }, []);
  const stop = React.useCallback((next: Status = 'off') => {
    generation.current++; requested.current = false;
    web.current?.injectJavaScript('window.stopHandTracking?.();true;');
    setTrackerUri(null); setStatus(next); clearPointer();
  }, [clearPointer]);
  const start = async () => {
    const epoch = ++generation.current;
    requested.current = true; setError(''); setStatus('loading');
    try {
      if (Platform.OS === 'android') {
        // Android's own permission activity temporarily backgrounds our activity.
        // Keep that request alive, but never open the camera while still outside it.
        requestingPermission.current = true;
        try {
          const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
          if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Нет доступа к камере. Разрешите камеру в настройках приложения.');
          if (!await waitForCameraForeground(AppState)) {
            if (epoch === generation.current) stop('paused');
            return;
          }
        } finally { requestingPermission.current = false; }
      }
      if (epoch !== generation.current || !requested.current) return;
      const source = await loadTracker();
      if (epoch !== generation.current || !requested.current) return;
      surface.current?.measureInWindow((x, y, width, height) => { geometry.current = { x, y, width, height }; });
      setTrackerUri(source);
    } catch (cause) {
      if (epoch !== generation.current) return;
      stop('error'); setError(cause instanceof Error ? cause.message : 'Не удалось включить управление рукой.');
    }
  };
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state !== 'active' && requested.current && !requestingPermission.current) stop('paused'); });
    const timer = setInterval(() => { if (lastSample.current && Date.now() - lastSample.current > 450) clearPointer(); }, 150);
    return () => { sub.remove(); clearInterval(timer); generation.current++; requested.current = false; web.current?.injectJavaScript('window.stopHandTracking?.();true;'); };
  }, [stop, clearPointer]);
  React.useEffect(() => { layerChangedAt.current = Date.now(); clearPointer(); }, [activeLayer, clearPointer]);

  const onSample = React.useCallback(async (sample: HandSample | null) => {
    if (!requested.current) return;
    if (Date.now() - layerChangedAt.current < 400) { clearPointer(); return; }
    if (sample && (!Array.isArray(sample.landmarks) || typeof sample.confidence !== 'number' || !Number.isFinite(sample.aspect))) sample = null;
    const metrics = handMetrics(sample);
    if (!metrics) { clearPointer(); setStatus('searching'); return; }
    const now = Date.now();
    const elapsed = Math.min(100, now - lastSample.current);
    lastSample.current = now;
    setStatus('found');
    const bounds = geometry.current;
    const desired = { x: bounds.x + metrics.point.x * Math.max(0, bounds.width - 1), y: bounds.y + metrics.point.y * Math.max(0, bounds.height - 1) };
    if (!position.current) position.current = desired;
    if (!gesture.current.locked) {
      const alpha = 1 - Math.exp(-elapsed / 65);
      position.current = { x: position.current.x + (desired.x - position.current.x) * alpha, y: position.current.y + (desired.y - position.current.y) * alpha };
    }
    const point = { ...position.current };
    const version = ++sampleVersion.current;
    const hit = gesture.current.lockedTarget ?? await registry.hit(point);
    if (version !== sampleVersion.current || !requested.current || Date.now() - now > 450) return;
    const clicked = gesture.current.update(metrics.pinch, now, hit);
    setCursor({ ...point, locked: gesture.current.locked });
    setHighlight(hit);
    if (clicked) {
      await registry.activate(clicked, () => requested.current && version === sampleVersion.current && Date.now() - now <= 450);
      clearPointer();
    }
  }, [registry, clearPointer]);
  // Loading the file avoids three large string/base64 copies across JS, Java and
  // WebView, which exhaust the standard Android heap on lower-memory devices.
  const source = React.useMemo(() => trackerUri ? { uri: trackerUri } : undefined, [trackerUri]);
  const allowTrackerNavigation = React.useCallback((request: { url: string }) => request.url === 'about:blank' || request.url === trackerUri, [trackerUri]);
  const onCameraError = React.useCallback(() => { stop('error'); setError('Не удалось открыть камеру. Включите управление снова.'); }, [stop]);
  const onCameraMessage = React.useCallback((event: { nativeEvent: { data: string } }) => {
    if (!requested.current || event.nativeEvent.data.length > 20_000) return;
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'ready') setStatus('searching');
      else if (data.type === 'sample') void onSample(data.sample);
      else if (data.type === 'paused') stop('paused');
      else if (data.type === 'error') { stop('error'); setError(String(data.message || 'Не удалось распознать руку.')); }
    } catch { /* Ignore malformed messages; they cannot activate a native control. */ }
  }, [onSample, stop]);
  const enabled = status === 'loading' || status === 'searching' || status === 'found';
  return (
    <HandTargetContext.Provider value={targets}>
      <HandControlContext.Provider value={{ enabled, status, error, cursor, highlight, toggle: () => { if (requested.current) stop(); else void start(); } }}>
        <View ref={surface} collapsable={false} style={styles.surface} onLayout={() => {
          clearPointer(); surface.current?.measureInWindow((x, y, width, height) => { geometry.current = { x, y, width, height }; });
        }}>
          {children}
          {trackerUri && <View pointerEvents="none" style={styles.tracker}>
            <CameraWebView ref={web} source={source}
              originWhitelist={TRACKER_ORIGINS} javaScriptEnabled domStorageEnabled={false} allowFileAccess
              allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
              allowingReadAccessToURL={trackerUri}
              allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
              onShouldStartLoadWithRequest={allowTrackerNavigation}
              onError={onCameraError} onMessage={onCameraMessage} />
          </View>}
          <HandPointer />
        </View>
      </HandControlContext.Provider>
    </HandTargetContext.Provider>
  );
}

export function KitchenHandControlSetting() {
  const control = React.useContext(HandControlContext);
  if (!control) return null;
  return <View style={styles.setting}>
    <View style={styles.row}>
      <Text style={styles.label} translate>Управление рукой</Text>
      <Toggle checked={control.enabled} onChange={control.toggle} />
    </View>
    {(control.enabled || control.status === 'paused') && <Text style={styles.status} translate>{STATUS[control.status]}</Text>}
    {!!control.error && <Text style={[styles.status, { color: colors.danger }]}>{control.error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  surface: { flex: 1 }, tracker: { position: 'absolute', bottom: 0, left: 0, width: 1, height: 1, opacity: 0 },
  setting: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, marginTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.sm },
  label: { fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary },
  status: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 },
});
