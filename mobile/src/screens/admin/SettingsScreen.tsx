import { AdminLoadingSkeleton } from './AdminLoadingSkeleton';
import { ScrollView, View, PaperView } from '@/components/themed';
import React, { useEffect, useState } from 'react';
import { BackHandler, Image, Linking, Share, StyleSheet, useWindowDimensions } from 'react-native';
import { Alert, Text, TextInput } from '@/components/typography';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';
import * as Print from 'expo-print';
import { Button, Card, Toggle } from '@/components/ui';
import { AnchoredSelectScope, Select } from '@/components/Select';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { colors, fontSize, radius, spacing } from '@/theme';
import { API_BASE, WEB_URL } from '@/config/env';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { useLocale, type Locale } from '@/store/locale';
import {
  useAdminSettings,
  useTestFiscalConnection,
  useUpdateSettings,
  useGenerateDeliveryApiKey,
  resolveQrSrc,
  type Settings,
  type SettingsInput,
} from '@/services/api/settings';
import { useAuth } from '@/store/auth';
import { changedSettingsFields, mergeSavedSettingsDraft } from '@/utils/settingsDraft';
import { DEFAULT_WAITER_PERMISSIONS, type WaiterOrderPermissions } from '@/lib/order-permissions';
import { OrderPermissionsSettings } from './OrderPermissionsSettings';
import { WarehouseAccountingSettings } from './WarehouseAccountingSettings';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { CashShiftSettings } from '@/features/cash-shifts/CashShiftControls';
import { usePermissions } from '@/hooks/usePermissions';
import { useT } from '@/lib/i18n';
import type { SettingsView } from '@/navigation/adminWorkspaceNavigation';
import type { ReceiptPrintSettings } from '@/types';
import { waitForNativePrintReturn } from './nativePrintLifecycle';

type FiscalProvider = '' | 'ekassa' | 'yakassa' | 'mock';
type QueueMode = 'table' | 'number';

type Form = ReceiptPrintSettings & {
  receiptLogoData: string;
  receiptPrintRequestsOnly: boolean;
  roundOrderTotal: boolean;
  taxesEnabled: boolean;
  waiterOrderPermissions: WaiterOrderPermissions;
  cafeName: string;
  address: string;
  phone: string;
  phone2: string;
  instagram: string;
  website: string;
  receiptText: string;
  language: Locale;
  payQr: boolean;
  payCash: boolean;
  payCard: boolean;
  deliveryEnabled: boolean;
  qrImageUrl: string | null;
  qrGeoEnabled: boolean;
  qrGeoLat: string;
  qrGeoLng: string;
  qrGeoRadius: string;
  queueDisplayEnabled: boolean;
  queueDisplayMode: QueueMode;
  fiscalProvider: FiscalProvider;
};

const RECEIPT_LIMIT = 120;
const LANG_OPTIONS: { value: Locale; label: string }[] = [
  { value: 'ru', label: 'Русский' },
  { value: 'ky', label: 'Кыргызча' },
];
const QUEUE_OPTIONS: { value: QueueMode; label: string }[] = [
  { value: 'table', label: 'Номера столов' },
  { value: 'number', label: 'Номера заказов' },
];
const FISCAL_OPTIONS: { value: FiscalProvider; label: string }[] = [
  { value: '', label: 'Выключено' },
  { value: 'mock', label: 'Эмуляция' },
];

const toNumberOrNull = (value: string) => {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

function settingsForm(data: Settings): Form {
  return {
    waiterOrderPermissions: data.waiterOrderPermissions ?? DEFAULT_WAITER_PERMISSIONS,
    cafeName: data.cafeName, address: data.address, phone: data.phone, phone2: data.phone2,
    instagram: data.instagram ?? '', website: data.website ?? '', receiptText: data.receiptText,
    language: data.language, payQr: data.payQr, payCash: data.payCash, payCard: data.payCard,
    deliveryEnabled: data.deliveryEnabled, qrImageUrl: data.qrImageUrl,
    qrGeoEnabled: data.qrGeoEnabled, qrGeoLat: data.qrGeoLat != null ? String(data.qrGeoLat) : '',
    qrGeoLng: data.qrGeoLng != null ? String(data.qrGeoLng) : '', qrGeoRadius: String(data.qrGeoRadius),
    queueDisplayEnabled: data.queueDisplayEnabled, queueDisplayMode: data.queueDisplayMode,
    fiscalProvider: (data.fiscalProvider ?? '') as FiscalProvider,
    receiptLanguage: data.receiptLanguage === 'ky' ? 'ky' : 'ru',
    receiptPrintCafeName: data.receiptPrintCafeName ?? true,
    receiptPrintAddress: data.receiptPrintAddress ?? true,
    receiptPrintPhone: data.receiptPrintPhone ?? true,
    receiptLogoData: data.receiptLogoData ?? '',
    receiptPrintRequestsOnly: data.receiptPrintRequestsOnly ?? false,
    taxesEnabled: data.taxesEnabled ?? false,
    roundOrderTotal: data.roundOrderTotal ?? false,
  };
}

/** Настройки владельца — порт PWA SettingsPage для mobile. */
export type SettingsNavigationGuard = (next: () => void) => void;
type SettingsProps = {
  view: SettingsView;
  navigationGuard: React.MutableRefObject<SettingsNavigationGuard | null>;
};

export function SettingsScreen(props: SettingsProps) {
  const { canSection } = usePermissions();
  return canSection('settings') ? <CafeSettingsScreen {...props} /> : <AppearanceSettings />;
}

function AppearanceSettings() {
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm }}><Card><ThemeSwitch /></Card></View>
  </View>;
}

function PrinterSettings({ narrow }: { narrow: boolean }) {
  const t = useT();
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState(false);

  async function testPrint() {
    setPrinting(true);
    setPrintError(false);
    try {
      const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><p style="width:48mm;margin:5mm;font:14px sans-serif">EDU POS · ${t('Пробная печать')}</p></body></html>`;
      await waitForNativePrintReturn(() => Print.printAsync({ html }));
    } catch {
      setPrintError(true);
    } finally {
      setPrinting(false);
    }
  }

  return <View style={[styles.settingBlock, !narrow && styles.col]}>
    <View style={styles.inlineTitle}>
      <PwaIcon name="adminPrinter" size={20} color={colors.textSecondary} />
      <Text style={styles.sectionTitle} translate>Принтер чеков</Text>
    </View>
    <View style={styles.printerPanel}>
      <Text style={styles.helper} translate>Выберите принтер в системном окне печати.</Text>
      <Button icon="adminPrinter" title="Пробная печать" size="md" variant="secondary" loading={printing} onPress={() => void testPrint()} />
      {printError && <Text accessibilityRole="alert" style={styles.errorText} translate>Пробная печать не выполнена.</Text>}
      <View style={styles.nested}><ThemeSwitch /></View>
    </View>
  </View>;
}

function CafeSettingsScreen({ view, navigationGuard }: SettingsProps) {
  const { canAction, canEditSection, canSection } = usePermissions();
  const { width } = useWindowDimensions();
  const narrow = width < 640;
  const desktop = width >= 1024;
  const [gridWidth, setGridWidth] = useState(0);
  const { data, isLoading, isError, error } = useAdminSettings();
  const update = useUpdateSettings();
  const testFiscal = useTestFiscalConnection();
  const deliveryKey = useGenerateDeliveryApiKey();
  const isOwner = useAuth((s) => s.user?.role === 'OWNER');
  const editable = canEditSection('settings');
  const userId = useAuth((s) => s.user?.id);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const push = useNotifications((state) => state.push);
  const setLocale = useLocale((state) => state.setLocale);
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [fiscalCheck, setFiscalCheck] = useState<'ok' | 'fail' | null>(null);
  const baseline = React.useRef<{ settingsId: string; userId?: string; form: Form } | null>(null);
  const formRef = React.useRef(form);
  formRef.current = form;

  useEffect(() => {
    if (!data) return;
    const contextChanged = baseline.current?.settingsId !== data.id || baseline.current?.userId !== userId;
    if (dirty && !contextChanged) return;
    const next = settingsForm(data);
    baseline.current = { settingsId: data.id, userId, form: next };
    formRef.current = next;
    setForm(next);
    setDirty(false);
    setFiscalCheck(null);
    if (contextChanged) setGeneratedKey(null);
  }, [data, dirty, userId]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    if (!editable) return;
    setForm((current) => {
      if (!current) return current;
      const next = { ...current, [key]: value };
      if (!next.payQr && !next.payCash && !next.payCard) {
        push({
          message: 'Должен быть включён хотя бы один способ оплаты',
          type: 'error',
          at: new Date().toISOString(),
        });
        return current;
      }
      setDirty(true);
      if (key === 'fiscalProvider') setFiscalCheck(null);
      return next;
    });
  };

  const toSettingsInput = (source: Form): SettingsInput => ({
    waiterOrderPermissions: source.waiterOrderPermissions,
    cafeName: source.cafeName,
    address: source.address,
    phone: source.phone,
    phone2: source.phone2,
    instagram: source.instagram,
    website: source.website,
    receiptText: source.receiptText,
    receiptLanguage: source.receiptLanguage,
    receiptPrintCafeName: source.receiptPrintCafeName,
    receiptPrintAddress: source.receiptPrintAddress,
    receiptPrintPhone: source.receiptPrintPhone,
    receiptLogoData: source.receiptLogoData,
    ...(isOwner ? { receiptPrintRequestsOnly: source.receiptPrintRequestsOnly } : {}),
    taxesEnabled: source.taxesEnabled,
    roundOrderTotal: source.roundOrderTotal,
    language: source.language,
    payQr: source.payQr,
    payCash: source.payCash,
    payCard: source.payCard,
    deliveryEnabled: source.deliveryEnabled,
    qrImageUrl: source.qrImageUrl ?? '',
    qrGeoEnabled: source.qrGeoEnabled,
    qrGeoLat: toNumberOrNull(source.qrGeoLat),
    qrGeoLng: toNumberOrNull(source.qrGeoLng),
    qrGeoRadius: Math.max(20, Number(source.qrGeoRadius) || 150),
    queueDisplayEnabled: source.queueDisplayEnabled,
    queueDisplayMode: source.queueDisplayMode,
    fiscalProvider: source.fiscalProvider,
  });

  async function createDeliveryKey() {
    try { const result = await deliveryKey.mutateAsync(); setGeneratedKey(result.apiKey); push({ message: 'Новый API-ключ создан. Сохраните его сейчас.', type: 'success', at: new Date().toISOString() }); }
    catch (err) { push({ message: apiError(err), type: 'error', at: new Date().toISOString() }); }
  }
  async function pickQrImage() {
    setUploading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['image/png', 'image/jpeg', 'image/webp'], copyToCacheDirectory: true });
      if (result.canceled) return;
      const file = result.assets[0];
      if (file.size && file.size > 2 * 1024 * 1024) throw new Error('Размер QR-кода не должен превышать 2 МБ');
      const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
      set('qrImageUrl', `data:${file.mimeType || 'image/png'};base64,${base64}`);
    } catch (err) { push({ message: apiError(err), type: 'error', at: new Date().toISOString() }); }
    finally { setUploading(false); }
  }
  async function pickReceiptLogo() {
    setUploading(true);
    try {
      const types = ['image/png', 'image/jpeg', 'image/webp'];
      const result = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true });
      if (result.canceled) return;
      const file = result.assets[0];
      const mime = file.mimeType || 'image/png';
      if (!types.includes(mime)) throw new Error('Выберите PNG, JPG или WEBP.');
      const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
      if (base64.length > 667_000) throw new Error('Размер логотипа не должен превышать 500 КБ.');
      set('receiptLogoData', `data:${mime};base64,${base64}`);
    } catch (err) {
      push({ message: err instanceof Error ? err.message : apiError(err), type: 'error', at: new Date().toISOString() });
    } finally {
      setUploading(false);
    }
  }

  async function locate() {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Разрешите доступ к геолокации');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setForm((current) => current ? { ...current, qrGeoLat: String(position.coords.latitude), qrGeoLng: String(position.coords.longitude) } : current);
      setDirty(true);
    } catch (err) { push({ message: apiError(err), type: 'error', at: new Date().toISOString() }); }
    finally { setLocating(false); }
  }

  const saveSettings = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!form || !editable || update.isPending) return false;
    const submitted = form;
    const settingsId = data?.id;
    try {
      const body = toSettingsInput(submitted);
      const patch = baseline.current ? changedSettingsFields(body, toSettingsInput(baseline.current.form)) : body;
      const saved = await update.mutateAsync(patch);
      if (useAuth.getState().user?.id !== userId || baseline.current?.settingsId !== settingsId) return false;
      const savedForm = settingsForm(saved);
      const next = mergeSavedSettingsDraft(submitted, formRef.current ?? submitted, savedForm);
      baseline.current = { settingsId: saved.id, userId, form: savedForm };
      formRef.current = next.form;
      setForm(next.form);
      setLocale(saved.language as Locale);
      setDirty(next.dirty);
      if (!silent) {
        push({ message: 'Настройки сохранены', type: 'success', at: new Date().toISOString() });
      }
      return true;
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
      return false;
    }
  };

  const runFiscalCheck = async () => {
    setFiscalCheck(null);
    try {
      const res = await testFiscal.mutateAsync();
      setFiscalCheck(res.ok ? 'ok' : 'fail');
      if (!res.ok) {
        push({
          message: 'ККМ не ответила. Проверьте провайдера, URL и ключ.',
          type: 'error',
          at: new Date().toISOString(),
        });
      }
    } catch (err) {
      setFiscalCheck('fail');
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  };

  React.useEffect(() => {
    if (!dirty || !editable) return;
    const guard: SettingsNavigationGuard = (next) => {
      if (update.isPending) return;
      Alert.alert('Несохранённые изменения', 'Сохранить изменения перед выходом?', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Выйти без сохранения', style: 'destructive', onPress: next },
        { text: 'Сохранить и выйти', onPress: () => { void saveSettings().then((ok) => { if (ok) next(); }); } },
      ], { cancelable: true });
    };
    navigationGuard.current = guard;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      guard(() => {
        navigationGuard.current = null;
        setDirty(false);
        if (baseline.current) setForm(baseline.current.form);
      });
      return true;
    });
    return () => {
      if (navigationGuard.current === guard) navigationGuard.current = null;
      back.remove();
    };
  });

  if (isLoading) return <AdminLoadingSkeleton layout="form" />;

  if (isError || !data) {
    return (
      <View style={{ flex: 1 }}>
        <View style={styles.errorBox}><Text style={styles.errorText}>{apiError(error)}</Text></View>
        <AppearanceSettings />
      </View>
    );
  }

  if (!form) return <AdminLoadingSkeleton layout="form" />;

  const noMethod = !form.payQr && !form.payCash && !form.payCard;
  const queueUrl = data.queueDisplayCode ? `${WEB_URL}/q/${data.queueDisplayCode}` : '';

  return (
    <AnchoredSelectScope><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={{ gap: spacing.md }} pointerEvents={editable ? 'auto' : 'none'} accessibilityState={{ disabled: !editable }}>
      {view === 'general' ? <>
      <Card style={styles.card}>
        <Text style={styles.sectionTitle} translate>Настройки кассы</Text>
        <ToggleRow title="Округлять сумму заказа" desc="Итог округляется вниз до целого сома." checked={form.roundOrderTotal}
          onChange={(value) => set('roundOrderTotal', value)} />
        <ToggleRow title="Учитывать налоги" desc="Ставки задаются в разделе «Налоги»." checked={form.taxesEnabled}
          onChange={(value) => set('taxesEnabled', value)} />
      </Card>
      <OrderPermissionsSettings permissions={form.waiterOrderPermissions} disabled={update.isPending}
        onPermissions={(value) => set('waiterOrderPermissions', value)} />
      {canSection('warehouse') && canAction('warehouseSettings') ? <WarehouseAccountingSettings /> : null}
      <View style={[styles.settingsGrid, desktop && { flexDirection: 'row' }]} onLayout={event => setGridWidth(event.nativeEvent.layout.width)}>
      <Card style={{ ...styles.card, ...(desktop ? { width: gridWidth > 0 ? (gridWidth - 32) / 3 * 2 + 16 : undefined, flex: gridWidth > 0 ? undefined : 2, minWidth: 0 } : {}) }}>
        <Text style={styles.cardTitle} translate>Информация о кафе</Text>
        <Input label="Название кафе" value={form.cafeName} onChangeText={(v) => set('cafeName', v)} />
        <Input label="Адрес" value={form.address} onChangeText={(v) => set('address', v)} />
        <View style={[styles.twoCols, narrow && styles.singleCol]}>
          <Input label="Номер телефона" value={form.phone} onChangeText={(v) => set('phone', v)} style={narrow ? undefined : styles.col} />
          <Input label="Доп. номер" value={form.phone2} onChangeText={(v) => set('phone2', v)} style={narrow ? undefined : styles.col} />
        </View>
        <View style={[styles.twoCols, narrow && styles.singleCol]}>
          <Input label="Instagram" value={form.instagram} onChangeText={(v) => set('instagram', v)} style={narrow ? undefined : styles.col} />
          <Input label="Сайт" value={form.website} onChangeText={(v) => set('website', v)} style={narrow ? undefined : styles.col} />
        </View>
        <View style={[styles.settingBlock, !narrow && styles.col]}>
          <View style={styles.inlineTitle}><Text style={[styles.sectionTitle, { flex: 1 }]} translate>Гео-проверка QR-заказа</Text><Toggle checked={form.qrGeoEnabled} onChange={(value) => set('qrGeoEnabled', value)} /></View>
          {form.qrGeoEnabled ? <View style={styles.geoBox}><View style={styles.geoRow}><View style={{ flex: 1 }}><Text style={styles.helper} translate>Координаты кафе</Text><Text style={styles.coordinates} numberOfLines={1} translate={!(form.qrGeoLat && form.qrGeoLng)}>{form.qrGeoLat && form.qrGeoLng ? `${form.qrGeoLat}, ${form.qrGeoLng}` : 'не заданы'}</Text></View><Button size="md" title={form.qrGeoLat && form.qrGeoLng ? 'Обновить' : 'Задать'} variant="secondary" loading={locating} style={styles.compactAction} onPress={() => void locate()} /></View><View style={styles.radiusRow}><Text style={styles.label} translate>Радиус</Text><TextInput style={[styles.input, styles.radiusInput]} value={form.qrGeoRadius} onChangeText={(value) => set('qrGeoRadius', value)} keyboardType="number-pad" /><Text style={styles.helper} translate>м</Text></View></View> : null}
        </View>
      </Card>

      <View style={[styles.settingsSide, desktop && { width: gridWidth > 0 ? (gridWidth - 32) / 3 : undefined, flex: gridWidth > 0 ? undefined : 1 }]}>
      {isOwner && <CashShiftSettings />}
      <Card style={styles.card}>
        <Text style={styles.sectionTitle} translate>Язык системы</Text>
        <View style={styles.segmented}>{LANG_OPTIONS.map(option => <FastPressable key={option.value} onPress={() => set('language', option.value)} style={[styles.segment, form.language === option.value && styles.segmentActive]}><Text style={[styles.segmentLabel, form.language === option.value && { color: colors.primary }]} translate>{option.label}</Text></FastPressable>)}</View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle} translate>Способы оплаты</Text>
        <ToggleRow title="QR-код" desc="Оплата через QR-код" checked={form.payQr} onChange={(v) => set('payQr', v)} />
        <ToggleRow title="Наличные" desc="Оплата наличными средствами" checked={form.payCash} onChange={(v) => set('payCash', v)} />
        <ToggleRow title="Карта" desc="Оплата банковской картой" checked={form.payCard} onChange={(v) => set('payCard', v)} />
        <Text style={[styles.helper, noMethod && { color: colors.danger }]} translate>
          {noMethod
            ? 'Должен быть включён хотя бы один способ оплаты'
            : 'Отключённые способы оплаты будут недоступны на экране оплаты'}
        </Text>
        {form.payQr && !form.qrImageUrl ? (
          <Text style={styles.warning} translate>QR-оплата включена, но QR-код не загружен.</Text>
        ) : null}
      </Card>

      <Card style={styles.card}>
        <View style={styles.inlineTitle}><PwaIcon name="qr" size={20} color={colors.textSecondary} /><Text style={[styles.sectionTitle, { flex: 1 }]} translate>QR-оплата</Text><View style={[styles.qrBadge, { backgroundColor: form.qrImageUrl ? colors.successSoft : colors.background }]}><Text style={[styles.qrBadgeText, { color: form.qrImageUrl ? colors.success : colors.textMuted }]} translate>{form.qrImageUrl ? 'QR-код загружен' : 'Не загружен'}</Text></View></View>
        {form.qrImageUrl ? <View style={styles.qrPreviewRow}><PaperView style={styles.qrPreview}><Image source={{ uri: resolveQrSrc(form.qrImageUrl) ?? undefined }} style={{ width: '100%', height: '100%' }} resizeMode="contain" /></PaperView><View style={{ flex: 1, gap: 8 }}><Text style={styles.helper} translate>Этот QR-код увидят официанты на экране оплаты.</Text><View style={styles.qrActions}><Button size="md" title="Заменить" variant="secondary" style={styles.compactAction} loading={uploading} onPress={() => void pickQrImage()} /><FastPressable style={styles.qrDelete} accessibilityLabel="Удалить QR-код" onPress={() => set('qrImageUrl', null)}><PwaIcon name="trash" size={16} color={colors.danger} /></FastPressable></View></View></View> : <View style={styles.qrEmpty}><Text style={[styles.helper, { textAlign: 'center' }]} translate>Загрузите QR-код для оплаты. PNG, JPG или WEBP до 2 МБ.</Text><Button size="md" title="Загрузить QR-код" loading={uploading} onPress={() => void pickQrImage()} style={{ alignSelf: 'center' }} /></View>}
      </Card>



      <Card style={styles.card}>
        <ToggleRow
          title="Экран очереди заказов"
          desc="Табло «Готовятся / Готовы» для монитора в зале"
          checked={form.queueDisplayEnabled}
          onChange={(v) => set('queueDisplayEnabled', v)}
        />
        {form.queueDisplayEnabled ? (
          <View style={styles.nested}>
            <Text style={styles.label} translate>Что показывать</Text>
            <View style={styles.segmented}>{QUEUE_OPTIONS.map(option => <FastPressable key={option.value} onPress={() => set('queueDisplayMode', option.value)} style={[styles.segment, form.queueDisplayMode === option.value && styles.segmentActive]}><Text style={[styles.segmentLabel, form.queueDisplayMode === option.value && { color: colors.primary }]} translate>{option.label}</Text></FastPressable>)}</View>
            {queueUrl ? (
              <View style={styles.noteBox}>
                <Text style={styles.noteText} translate>Откройте эту ссылку на мониторе/ТВ:</Text>
                <Text selectable style={styles.queueUrl} onPress={() => void Linking.openURL(queueUrl)}>{queueUrl}</Text>
              </View>
            ) : (
              <Text style={styles.helper} translate>Сохраните изменения — появится ссылка для монитора.</Text>
            )}
          </View>
        ) : null}
      </Card>

      <Card style={styles.card}><ToggleRow title="Онлайн-заказы / Доставка" desc="Заказы с сайта или приложения доставки" checked={form.deliveryEnabled} onChange={(v) => { setGeneratedKey(null); set('deliveryEnabled', v); }} />{form.deliveryEnabled ? <View style={styles.nested}><Text style={styles.label} translate>Адрес API</Text><Text selectable style={styles.queueUrl}>{API_BASE}/integration/v1</Text><Text style={styles.label} translate>API-ключ</Text><Text selectable style={styles.queueUrl} translate>{generatedKey ?? data.deliveryApiKeyPrefix ?? 'Ключ ещё не создан'}</Text>{generatedKey ? <><Text style={styles.warning} translate>Сохраните ключ сейчас: повторно полный ключ показан не будет.</Text><Button title="Сохранить ключ" variant="secondary" onPress={() => void Share.share({ message: generatedKey }).catch((err) => push({ message: apiError(err), type: 'error', at: new Date().toISOString() }))} /></> : null}{isOwner ? <Button title={data.deliveryApiKeyConfigured ? 'Перевыпустить ключ' : 'Создать API-ключ'} variant="secondary" loading={deliveryKey.isPending} disabled={dirty || !data.deliveryEnabled} onPress={() => void createDeliveryKey()} /> : <Text style={styles.helper} translate>Создавать и перевыпускать API-ключ может только владелец.</Text>}{isOwner && (dirty || !data.deliveryEnabled) ? <Text style={styles.helper} translate>Сначала сохраните включение доставки, затем создайте ключ.</Text> : null}</View> : null}</Card>

      </View>
      </View>
      </> : view === 'receipt' ? (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle} translate>Оформление чека</Text>
          <Text style={styles.label} translate>Язык чека</Text>
          <Select value={form.receiptLanguage} options={LANG_OPTIONS} onChange={(value) => set('receiptLanguage', value)} />
          <ToggleRow title="Печатать название заведения" desc={data.cafeName} checked={form.receiptPrintCafeName} onChange={(value) => set('receiptPrintCafeName', value)} />
          <ToggleRow title="Печатать адрес" desc={data.address} checked={form.receiptPrintAddress} onChange={(value) => set('receiptPrintAddress', value)} />
          <ToggleRow title="Печатать телефон для связи" desc={[data.phone, data.phone2].filter(Boolean).join(' · ')} checked={form.receiptPrintPhone} onChange={(value) => set('receiptPrintPhone', value)} />
          <Text style={styles.label} translate>Логотип на чеке</Text>
          {form.receiptLogoData ? <PaperView style={styles.qrPreview}>
            <Image accessibilityLabel="Логотип на чеке" source={{ uri: form.receiptLogoData }} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
          </PaperView> : null}
          <View style={styles.qrActions}>
            <Button size="md" title={form.receiptLogoData ? 'Заменить' : 'Загрузить логотип'} variant="secondary" loading={uploading} onPress={() => void pickReceiptLogo()} />
            {form.receiptLogoData ? <Button size="md" title="Удалить" variant="secondary" danger onPress={() => set('receiptLogoData', '')} /> : null}
          </View>
        <View style={styles.inputBlock}>
          <Text style={styles.label} translate>Текст в чеке</Text>
          <TextInput
            value={form.receiptText}
            onChangeText={(v) => set('receiptText', v.slice(0, RECEIPT_LIMIT))}
            multiline
            maxLength={RECEIPT_LIMIT}
            placeholder="Спасибо за покупку!"
            placeholderTextColor={colors.textLight}
            style={[styles.input, styles.textArea]}
          />
          <Text style={styles.counter}>{form.receiptText.length}/{RECEIPT_LIMIT}</Text>
        </View>
          {isOwner && <>
            <Text style={styles.label} translate>Список печати счетов и чеков</Text>
            <Select value={form.receiptPrintRequestsOnly ? 'requests' : 'all'} options={[
              { value: 'all', label: 'Все доступные счета и чеки' },
              { value: 'requests', label: 'Только по заявкам официантов' },
            ]} onChange={(value) => set('receiptPrintRequestsOnly', value === 'requests')} />
          </>}
          <PrinterSettings narrow={narrow} />
        </Card>
      ) : (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle} translate>Режим ККМ</Text>
          <Select value={form.fiscalProvider} options={FISCAL_OPTIONS} onChange={(value) => set('fiscalProvider', value)} />
          {['ekassa', 'yakassa'].includes(form.fiscalProvider) && <Text style={styles.helper} translate>Провайдер ожидает подключения.</Text>}
          {form.fiscalProvider === 'mock' && <Text style={styles.helper} translate>Эмуляция формирует тестовый чек для проверки печати.</Text>}
          {isOwner && data.fiscalProvider === 'mock' && !dirty && <Button size="md" title="Проверить эмуляцию"
            variant="secondary" loading={testFiscal.isPending} onPress={() => void runFiscalCheck()} />}
          {fiscalCheck ? <Text style={styles.helper} translate>{fiscalCheck === 'ok' ? 'Эмуляция работает' : 'Проверка эмуляции не прошла'}</Text> : null}
          <Text style={styles.sectionTitle} translate>Подключение кассы</Text>
          <Text style={styles.helper} translate>Для смарт-карты NewCas нужны модель считывателя и версия FiscalCore.</Text>
          <Button size="md" title="NewCas · Установка FiscalCore для Windows" variant="secondary"
            onPress={() => void Linking.openURL('https://support.goodoo.kg/knowledgebase.php?article=8')} />
        </Card>
      )}
      </View>
      {editable && (
      <View style={styles.savePanel}>
        <Text style={[styles.saveText, dirty && { color: colors.warning }]} translate>
          {dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}
        </Text>
        <Button
          title={update.isPending ? 'Сохраняем...' : 'Сохранить изменения'}
          size="md"
          disabled={!dirty || update.isPending}
          loading={update.isPending}
          onPress={() => void saveSettings()}
          style={styles.saveBtn}
        />
      </View>
      )}
    </ScrollView></AnchoredSelectScope>
  );
}

function Input({
  label,
  style,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string; style?: object }) {
  return (
    <View style={[styles.inputBlock, style]}>
      <Text style={styles.label} translate>{label}</Text>
      <TextInput placeholderTextColor={colors.textLight} style={styles.input} {...props} />
    </View>
  );
}

function ToggleRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.toggleTitle} translate>{title}</Text>
        <Text style={styles.helper}>{desc}</Text>
      </View>
      <Toggle checked={checked} onChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 960, alignSelf: 'center', padding: spacing.lg, gap: 16, paddingBottom: spacing.xl },
  settingsGrid: { gap: 16, alignItems: 'stretch' },
  settingsSide: { gap: 16, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  errorBox: { margin: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerSoft, padding: spacing.md },
  errorText: { fontSize: fontSize.sm, color: colors.danger },
  card: { gap: 16, padding: 20 },
  cardTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  inlineTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  settingBlock: { gap: 12, paddingTop: 8 },
  geoBox: { gap: 10, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  geoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coordinates: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  radiusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, borderTopWidth: 1, borderColor: colors.border },
  radiusInput: { width: 80, minHeight: 36, height: 36, paddingHorizontal: 10, paddingVertical: 0, textAlign: 'center' },
  compactAction: { height: 36, borderRadius: 8, paddingHorizontal: 12 },
  segmented: { flexDirection: 'row', borderRadius: 12, padding: 4, backgroundColor: colors.background },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  segmentActive: { backgroundColor: colors.white, elevation: 1 },
  segmentLabel: { fontSize: 14, fontWeight: '500', color: colors.textMuted },
  qrBadge: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999 },
  qrBadgeText: { fontSize: 12, fontWeight: '500' },
  qrPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  qrPreview: { width: 96, height: 96, padding: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  qrActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  qrDelete: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  qrEmpty: { alignItems: 'center', padding: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 12, gap: 12 },
  fiscalRadioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
  fiscalRadio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.textLight, alignItems: 'center', justifyContent: 'center' },
  fiscalRadioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  twoCols: { flexDirection: 'row', gap: 16 },
  singleCol: { flexDirection: 'column' },
  col: { flex: 1 },
  inputBlock: { gap: 6 },
  label: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: fontSize.base,
    color: colors.textPrimary,
  },
  textArea: { minHeight: 96, textAlignVertical: 'top' },
  counter: { textAlign: 'right', fontSize: fontSize.xs, color: colors.textMuted },
  noteBox: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, padding: spacing.md, gap: 4 },
  noteText: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 19 },
  helper: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 17 },
  warning: { fontSize: fontSize.xs, color: colors.warning, lineHeight: 17 },
  printerPanel: { gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  toggleTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  nested: { gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  queueUrl: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  fiscalActions: { gap: spacing.sm },
  fiscalResult: { fontSize: fontSize.sm, fontWeight: '600' },
  savePanel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing.md,
  },
  saveText: { flexGrow: 1, fontSize: 14, color: colors.textMuted },
  saveBtn: { height: 40, borderRadius: 8, paddingHorizontal: 20 },
});
