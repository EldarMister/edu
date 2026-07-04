import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, Toggle } from '@/components/ui';
import { Select } from '@/components/Select';
import { colors, fontSize, radius, spacing } from '@/theme';
import { WEB_URL } from '@/config/env';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { useLocale, type Locale } from '@/store/locale';
import {
  useAdminSettings,
  useTestFiscalConnection,
  useUpdateSettings,
  type SettingsInput,
} from '@/services/api/settings';

type FiscalProvider = '' | 'ekassa' | 'yakassa' | 'mock';
type QueueMode = 'table' | 'number';

type Form = {
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
  qrGeoEnabled: boolean;
  qrGeoLat: string;
  qrGeoLng: string;
  qrGeoRadius: string;
  queueDisplayEnabled: boolean;
  queueDisplayMode: QueueMode;
  fiscalProvider: FiscalProvider;
  fiscalEkassaApiKey: string;
  fiscalEkassaUrl: string;
  fiscalEkassaInn: string;
  fiscalYakassaApiKey: string;
  fiscalYakassaUrl: string;
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
  { value: 'ekassa', label: 'eKassa (Telemedia Group)' },
  { value: 'yakassa', label: 'YaKassa' },
  { value: 'mock', label: 'Тест (эмуляция)' },
];

const toNumberOrNull = (value: string) => {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

/** Настройки владельца — порт PWA SettingsPage для mobile. */
export function SettingsScreen() {
  const { data, isLoading, isError, error } = useAdminSettings();
  const update = useUpdateSettings();
  const testFiscal = useTestFiscalConnection();
  const push = useNotifications((state) => state.push);
  const setLocale = useLocale((state) => state.setLocale);
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [fiscalCheck, setFiscalCheck] = useState<'ok' | 'fail' | null>(null);

  useEffect(() => {
    if (!data) return;
    setForm({
      cafeName: data.cafeName,
      address: data.address,
      phone: data.phone,
      phone2: data.phone2,
      instagram: data.instagram ?? '',
      website: data.website ?? '',
      receiptText: data.receiptText,
      language: data.language,
      payQr: data.payQr,
      payCash: data.payCash,
      payCard: data.payCard,
      qrGeoEnabled: data.qrGeoEnabled,
      qrGeoLat: data.qrGeoLat != null ? String(data.qrGeoLat) : '',
      qrGeoLng: data.qrGeoLng != null ? String(data.qrGeoLng) : '',
      qrGeoRadius: String(data.qrGeoRadius),
      queueDisplayEnabled: data.queueDisplayEnabled,
      queueDisplayMode: data.queueDisplayMode,
      fiscalProvider: (data.fiscalProvider ?? '') as FiscalProvider,
      fiscalEkassaApiKey: data.fiscalEkassaApiKey ?? '',
      fiscalEkassaUrl: data.fiscalEkassaUrl ?? '',
      fiscalEkassaInn: data.fiscalEkassaInn ?? '',
      fiscalYakassaApiKey: data.fiscalYakassaApiKey ?? '',
      fiscalYakassaUrl: data.fiscalYakassaUrl ?? '',
    });
    setDirty(false);
    setFiscalCheck(null);
  }, [data]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
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
    cafeName: source.cafeName,
    address: source.address,
    phone: source.phone,
    phone2: source.phone2,
    instagram: source.instagram,
    website: source.website,
    receiptText: source.receiptText,
    language: source.language,
    payQr: source.payQr,
    payCash: source.payCash,
    payCard: source.payCard,
    qrGeoEnabled: source.qrGeoEnabled,
    qrGeoLat: toNumberOrNull(source.qrGeoLat),
    qrGeoLng: toNumberOrNull(source.qrGeoLng),
    qrGeoRadius: Math.max(20, Number(source.qrGeoRadius) || 150),
    queueDisplayEnabled: source.queueDisplayEnabled,
    queueDisplayMode: source.queueDisplayMode,
    fiscalProvider: source.fiscalProvider,
    fiscalEkassaApiKey: source.fiscalEkassaApiKey,
    fiscalEkassaUrl: source.fiscalEkassaUrl,
    fiscalEkassaInn: source.fiscalEkassaInn,
    fiscalYakassaApiKey: source.fiscalYakassaApiKey,
    fiscalYakassaUrl: source.fiscalYakassaUrl,
  });

  const saveSettings = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!form) return false;
    try {
      const saved = await update.mutateAsync(toSettingsInput(form));
      setLocale(saved.language as Locale);
      setDirty(false);
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
      const saved = await saveSettings({ silent: true });
      if (!saved) return;
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

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError || !form || !data) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>{apiError(error)}</Text>
      </View>
    );
  }

  const noMethod = !form.payQr && !form.payCash && !form.payCard;
  const queueUrl = data.queueDisplayCode ? `${WEB_URL}/q/${data.queueDisplayCode}` : '';

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Информация о кафе</Text>
        <Input label="Название кафе" value={form.cafeName} onChangeText={(v) => set('cafeName', v)} />
        <Input label="Адрес" value={form.address} onChangeText={(v) => set('address', v)} />
        <View style={styles.twoCols}>
          <Input label="Номер телефона" value={form.phone} onChangeText={(v) => set('phone', v)} style={styles.col} />
          <Input label="Доп. номер" value={form.phone2} onChangeText={(v) => set('phone2', v)} style={styles.col} />
        </View>
        <View style={styles.twoCols}>
          <Input label="Instagram" value={form.instagram} onChangeText={(v) => set('instagram', v)} style={styles.col} />
          <Input label="Сайт" value={form.website} onChangeText={(v) => set('website', v)} style={styles.col} />
        </View>
        <View style={styles.inputBlock}>
          <Text style={styles.label}>Текст в чеке</Text>
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
        <View style={styles.noteBox}>
          <Text style={styles.noteText}>EDU POS печатает предчек / внутренний товарный чек.</Text>
          <Text style={styles.noteText}>Фискальный чек формируется только через подключенную ККМ или онлайн-кассу.</Text>
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Язык системы</Text>
        <Select value={form.language} options={LANG_OPTIONS} onChange={(v) => set('language', v)} title="Язык системы" />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Способы оплаты</Text>
        <ToggleRow title="QR-код" desc="Оплата через QR-код" checked={form.payQr} onChange={(v) => set('payQr', v)} />
        <ToggleRow title="Наличные" desc="Оплата наличными средствами" checked={form.payCash} onChange={(v) => set('payCash', v)} />
        <ToggleRow title="Карта" desc="Оплата банковской картой" checked={form.payCard} onChange={(v) => set('payCard', v)} />
        <Text style={[styles.helper, noMethod && { color: colors.danger }]}>
          {noMethod
            ? 'Должен быть включён хотя бы один способ оплаты'
            : 'Отключённые способы оплаты будут недоступны на экране оплаты'}
        </Text>
        {form.payQr && !data.qrImageUrl ? (
          <Text style={styles.warning}>QR-оплата включена, но QR-код не загружен.</Text>
        ) : null}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Статус принтера</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: data.printerConnected ? colors.success : colors.textLight }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusTitle, { color: data.printerConnected ? colors.success : colors.textMuted }]}>
              {data.printerConnected ? 'Подключен' : 'Не подключен'}
            </Text>
            <Text style={styles.helper}>
              {data.printerConnected ? 'Принтер чеков подключен и готов к печати' : 'Принтер чеков не подключен'}
            </Text>
          </View>
        </View>
      </Card>

      <Card style={styles.card}>
        <ToggleRow
          title="Гео-проверка QR-заказа"
          desc="Разрешает QR-заказ только рядом с кафе"
          checked={form.qrGeoEnabled}
          onChange={(v) => set('qrGeoEnabled', v)}
        />
        {form.qrGeoEnabled ? (
          <View style={styles.nested}>
            <View style={styles.twoCols}>
              <Input label="Широта" value={form.qrGeoLat} onChangeText={(v) => set('qrGeoLat', v)} keyboardType="decimal-pad" style={styles.col} />
              <Input label="Долгота" value={form.qrGeoLng} onChangeText={(v) => set('qrGeoLng', v)} keyboardType="decimal-pad" style={styles.col} />
            </View>
            <Input label="Радиус, м" value={form.qrGeoRadius} onChangeText={(v) => set('qrGeoRadius', v)} keyboardType="number-pad" />
          </View>
        ) : null}
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
            <Text style={styles.label}>Что показывать</Text>
            <Select value={form.queueDisplayMode} options={QUEUE_OPTIONS} onChange={(v) => set('queueDisplayMode', v)} title="Экран очереди" />
            {queueUrl ? (
              <View style={styles.noteBox}>
                <Text style={styles.noteText}>Откройте эту ссылку на мониторе/ТВ:</Text>
                <Text style={styles.queueUrl}>{queueUrl}</Text>
              </View>
            ) : (
              <Text style={styles.helper}>Сохраните изменения — появится ссылка для монитора.</Text>
            )}
          </View>
        ) : null}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>ККМ / Фискализация</Text>
        <Text style={styles.helper}>Без подключённой ККМ печатается товарный чек. С ККМ — фискальный чек с QR ГНС.</Text>
        <View style={styles.inputBlock}>
          <Text style={styles.label}>Провайдер</Text>
          <Select
            value={form.fiscalProvider}
            options={FISCAL_OPTIONS}
            onChange={(v) => set('fiscalProvider', v)}
            title="Провайдер"
          />
        </View>
        {form.fiscalProvider === 'ekassa' ? (
          <View style={styles.nested}>
            <Input label="URL API eKassa" value={form.fiscalEkassaUrl} onChangeText={(v) => set('fiscalEkassaUrl', v)} />
            <Input label="API-ключ" value={form.fiscalEkassaApiKey} onChangeText={(v) => set('fiscalEkassaApiKey', v)} />
            <Input label="ИНН заведения" value={form.fiscalEkassaInn} onChangeText={(v) => set('fiscalEkassaInn', v)} keyboardType="number-pad" />
          </View>
        ) : null}
        {form.fiscalProvider === 'yakassa' ? (
          <View style={styles.nested}>
            <Input label="URL API YaKassa" value={form.fiscalYakassaUrl} onChangeText={(v) => set('fiscalYakassaUrl', v)} />
            <Input label="API-ключ" value={form.fiscalYakassaApiKey} onChangeText={(v) => set('fiscalYakassaApiKey', v)} />
          </View>
        ) : null}
        {form.fiscalProvider === 'mock' ? (
          <Text style={styles.warning}>Режим эмуляции: чек не уходит в ГНС, генерируется тестовый номер и QR.</Text>
        ) : null}
        {form.fiscalProvider ? (
          <View style={styles.fiscalActions}>
            <Button
              title={testFiscal.isPending ? 'Проверка...' : 'Проверить соединение'}
              variant="secondary"
              size="md"
              loading={testFiscal.isPending}
              onPress={() => void runFiscalCheck()}
            />
            {fiscalCheck ? (
              <Text style={[styles.fiscalResult, { color: fiscalCheck === 'ok' ? colors.success : colors.danger }]}>
                {fiscalCheck === 'ok' ? 'Соединение установлено' : 'Нет соединения'}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Card>

      <View style={styles.savePanel}>
        <Text style={[styles.saveText, dirty && { color: colors.warning }]}>
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
    </ScrollView>
  );
}

function Input({
  label,
  style,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string; style?: object }) {
  return (
    <View style={[styles.inputBlock, style]}>
      <Text style={styles.label}>{label}</Text>
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
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.helper}>{desc}</Text>
      </View>
      <Toggle checked={checked} onChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  errorBox: { margin: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerSoft, padding: spacing.md },
  errorText: { fontSize: fontSize.sm, color: colors.danger },
  card: { gap: spacing.md },
  cardTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  twoCols: { flexDirection: 'row', gap: spacing.sm },
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
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusTitle: { fontSize: fontSize.base, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  toggleTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  nested: { gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  queueUrl: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  fiscalActions: { gap: spacing.sm },
  fiscalResult: { fontSize: fontSize.sm, fontWeight: '600' },
  savePanel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing.md,
  },
  saveText: { flex: 1, fontSize: fontSize.sm, color: colors.textMuted },
  saveBtn: { minWidth: 150 },
});
