import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Alert, Text } from '@/components/typography';
import { BottomSheet } from '@/components/BottomSheet';
import { Button, Field, Loading, PillTabs } from '@/components/ui';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { ScreenTransition } from '@/components/ScreenTransition';
import { DateField } from '@/components/DateField';
import { apiError } from '@/lib/api';
import { usePlatformAuth } from '@/store/platformAuth';
import { useCafeStaff, useCafes, useCleanupCafe, useCreateCafe, useDeleteCafe, useDeleteStaff, useHealth, useMemory, usePlatformLogin, useResumeCafe, useSetStaffActive, useSuspendCafe, useUpdateSubscription, type CleanupScope, type PlatformCafe } from '@/services/api/platform';
import { colors, fontSize, radius, spacing } from '@/theme';
import { PublicError } from './PublicLayout';

export function PlatformScreen() {
  const navigation = useNavigation();
  const token = usePlatformAuth(state => state.token);
  const hydrated = usePlatformAuth(state => state.hydrated);
  const [login, setLogin] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const mutation = usePlatformLogin();
  const authenticate = async () => {
    if (!login.trim() || !password) { setError('Введите логин и пароль'); return; }
    try { setError(''); const data = await mutation.mutateAsync({ login: login.trim(), password }); usePlatformAuth.getState().setSession(data.accessToken, data.admin); setPassword(''); }
    catch (e) { setError(apiError(e)); }
  };
  return <SafeAreaView style={styles.screen}>
    {!hydrated ? <Loading /> : token ? <PlatformDashboard /> : <>
      <FastPressable style={styles.loginBack} accessibilityLabel="Назад" hitSlop={12} onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('PublicHome' as never)}><PwaIcon name="chevronLeft" size={22} color={colors.textMuted} /></FastPressable>
      <ScrollView contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled"><View style={styles.loginCard}>
        <Text style={styles.loginTitle}>EDU POS · Платформа</Text><Text style={styles.loginSubtitle} translate>Панель управления кафе</Text>
        <Field label="Логин" value={login} onChangeText={setLogin} autoCapitalize="none" autoComplete="username" placeholder="superadmin" />
        <Field label="Пароль" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" placeholder="••••••••" onSubmitEditing={() => void authenticate()} />
        {error ? <Text style={styles.error}>{error}</Text> : null}<Button size="md" title="Войти" onPress={() => void authenticate()} loading={mutation.isPending} />
      </View></ScrollView>
    </>}
  </SafeAreaView>;
}
function PlatformDashboard() {
  const [page, setPage] = React.useState<'cafes' | 'monitoring'>('cafes');
  return <View style={styles.screen}>
    <View style={styles.platformHeader}><View style={styles.row}><Text style={styles.platformTitle}>EDU POS · Платформа</Text><FastPressable hitSlop={10} onPress={() => usePlatformAuth.getState().logout()}><Text style={styles.logout} translate>Выйти</Text></FastPressable></View>
      <View style={styles.platformTabs}>{([{ key: 'cafes', label: 'Кафе' }, { key: 'monitoring', label: 'Мониторинг' }] as const).map(item => <FastPressable key={item.key} onPress={() => setPage(item.key)} style={[styles.platformTab, page === item.key && styles.platformTabActive]}><Text style={[styles.platformTabText, page === item.key && { color: colors.primary }]} translate>{item.label}</Text></FastPressable>)}</View>
    </View>
    <ScreenTransition style={styles.screen} transitionKey={page}>{page === 'cafes' ? <Cafes /> : <Monitoring />}</ScreenTransition>
  </View>;
}
function Cafes() {
  const query = useCafes();
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<'all' | 'active' | 'suspended'>('all');
  const [creating, setCreating] = React.useState(false);
  const [selected, setSelected] = React.useState<PlatformCafe | null>(null);
  return <View style={{ flex: 1 }}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}>
    <View style={styles.row}><Text style={styles.heading} translate>Заведения</Text><Button size="md" title="Добавить" onPress={() => setCreating(true)} /></View><Field value={search} onChangeText={setSearch} placeholder="Поиск по названию" /><PillTabs value={filter} items={[{ key: 'all', label: 'Все' }, { key: 'active', label: 'Активные' }, { key: 'suspended', label: 'Приостановленные' }]} onChange={setFilter} />
    {query.isLoading ? <Loading /> : query.isError ? <PublicError message={apiError(query.error)} retry={() => void query.refetch()} /> : query.data?.filter(cafe => cafe.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (filter === 'all' || cafe.status === filter)).map(cafe => <FastPressable key={cafe.id} style={styles.card} onPress={() => setSelected(cafe)}><View style={styles.row}><Text style={styles.name}>{cafe.name}</Text><Text style={{ color: cafe.status === 'active' ? colors.success : colors.danger }} translate>{cafe.status === 'active' ? 'Активно' : 'Приостановлено'}</Text></View><Text style={styles.muted} translate>Сотрудников: {cafe.staffCount} · Заказов: {cafe.ordersCount}</Text><Text style={styles.muted} translate>Оплачено до: {cafe.paidUntil ? new Date(cafe.paidUntil).toLocaleDateString('ru-RU') : 'Без ограничения'}</Text>{cafe.suspendedReason ? <Text style={styles.error}>{cafe.suspendedReason}</Text> : null}<Text style={styles.link} translate>Управление →</Text></FastPressable>)}
  </ScrollView><CreateCafe visible={creating} onClose={() => setCreating(false)} />{selected ? <ManageCafe key={selected.id} cafe={query.data?.find(cafe => cafe.id === selected.id) ?? selected} onClose={() => setSelected(null)} /> : null}</View>;
}
function CreateCafe({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [cafeName, setCafeName] = React.useState('');
  const [ownerName, setOwnerName] = React.useState('');
  const [ownerPhone, setOwnerPhone] = React.useState('');
  const [ownerPassword, setOwnerPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const create = useCreateCafe();
  const save = async () => {
    if (!cafeName.trim() || !ownerName.trim() || !ownerPhone.trim() || ownerPassword.length < 6) { setError('Заполните все поля. Пароль — минимум 6 символов.'); return; }
    try { setError(''); await create.mutateAsync({ cafeName: cafeName.trim(), ownerName: ownerName.trim(), ownerPhone: ownerPhone.trim(), ownerPassword }); setCafeName(''); setOwnerName(''); setOwnerPhone(''); setOwnerPassword(''); onClose(); }
    catch (e) { setError(apiError(e)); }
  };
  return <BottomSheet visible={visible} onClose={onClose} title="Новое заведение" sheet footer={<Button title="Создать заведение" loading={create.isPending} onPress={() => void save()} />}><ScrollView contentContainerStyle={{ gap: spacing.md }} keyboardShouldPersistTaps="handled"><Field label="Название заведения" value={cafeName} onChangeText={setCafeName} /><Field label="Имя владельца" value={ownerName} onChangeText={setOwnerName} /><Field label="Телефон владельца" value={ownerPhone} onChangeText={setOwnerPhone} keyboardType="phone-pad" /><Field label="Пароль владельца" value={ownerPassword} onChangeText={setOwnerPassword} secureTextEntry />{error ? <Text style={styles.error}>{error}</Text> : null}</ScrollView></BottomSheet>;
}
function ManageCafe({ cafe, onClose }: { cafe: PlatformCafe; onClose: () => void }) {
  const [paidUntil, setPaidUntil] = React.useState(cafe.paidUntil?.slice(0, 10) ?? '');
  const [reason, setReason] = React.useState('');
  const [confirmName, setConfirmName] = React.useState('');
  const [scopes, setScopes] = React.useState<CleanupScope[]>([]);
  const [error, setError] = React.useState('');
  const staff = useCafeStaff(cafe.id, true);
  const suspend = useSuspendCafe(); const resume = useResumeCafe(); const subscription = useUpdateSubscription();
  const cleanup = useCleanupCafe(); const remove = useDeleteCafe(); const active = useSetStaffActive(cafe.id); const deleteStaff = useDeleteStaff(cafe.id);
  const busy = suspend.isPending || resume.isPending || subscription.isPending || cleanup.isPending || remove.isPending || active.isPending || deleteStaff.isPending;
  const run = async (action: () => Promise<unknown>) => { setError(''); try { await action(); } catch (e) { setError(apiError(e)); } };
  const updateSubscription = () => {
    if (paidUntil && (!/^\d{4}-\d{2}-\d{2}$/.test(paidUntil) || Number.isNaN(Date.parse(paidUntil)))) { setError('Введите дату в формате YYYY-MM-DD'); return; }
    void run(() => subscription.mutateAsync({ id: cafe.id, paidUntil: paidUntil ? `${paidUntil}T23:59:59+06:00` : null }));
  };
  return <BottomSheet visible onClose={onClose} title={cafe.name} sheet fillBody><ScrollView contentContainerStyle={{ gap: spacing.lg }} keyboardShouldPersistTaps="handled">
    <View style={styles.card}><Text style={styles.name} translate>Подписка и доступ</Text><DateField label="Оплачено до" value={paidUntil} onChangeText={setPaidUntil} placeholder="Без ограничения" /><Button size="md" title="Сохранить подписку" onPress={updateSubscription} loading={subscription.isPending} disabled={busy} />{cafe.status === 'active' ? <><Field label="Причина приостановки" value={reason} onChangeText={setReason} /><Button size="md" variant="danger" title="Приостановить" disabled={busy} onPress={() => Alert.alert('Приостановить заведение?', 'Вход персонала и QR-меню будут заблокированы.', [{ text: 'Отмена', style: 'cancel' }, { text: 'Приостановить', style: 'destructive', onPress: () => void run(() => suspend.mutateAsync({ id: cafe.id, reason: reason.trim() || undefined })) }])} /></> : <Button size="md" title="Возобновить работу" disabled={busy} onPress={() => void run(() => resume.mutateAsync(cafe.id))} />}</View>
    <View style={styles.card}><Text style={styles.name} translate>Персонал</Text>{staff.isLoading ? <Loading /> : staff.isError ? <Text style={styles.error}>{apiError(staff.error)}</Text> : staff.data?.map(person => <View key={person.id} style={styles.staff}><View style={styles.row}><View style={{ flex: 1 }}><Text style={styles.name}>{person.name}</Text><Text style={styles.muted}>{person.phone} · {person.role}</Text></View><Switch value={person.isActive} onValueChange={value => { if (!busy) void run(() => active.mutateAsync({ userId: person.id, isActive: value })); }} /></View>{person.role !== 'OWNER' ? <Button size="md" variant="secondary" danger title="Удалить сотрудника" disabled={busy} onPress={() => Alert.alert('Удалить сотрудника?', person.name, [{ text: 'Отмена', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: () => void run(() => deleteStaff.mutateAsync(person.id)) }])} /> : null}</View>)}</View>
    <View style={styles.card}><Text style={styles.name} translate>Очистка данных</Text><Text style={styles.muted} translate>При очистке меню или склада также удаляются заказы и история. Это действие нельзя отменить.</Text>{([{ key: 'orders', label: 'Заказы и история' }, { key: 'menu', label: 'Меню' }, { key: 'warehouse', label: 'Склад' }] as const).map(item => <View key={item.key} style={styles.row}><Text style={styles.muted} translate>{item.label}</Text><Switch value={scopes.includes(item.key)} onValueChange={value => setScopes(previous => value ? [...previous, item.key] : previous.filter(scope => scope !== item.key))} /></View>)}<Button size="md" variant="danger" title="Очистить выбранное" disabled={busy || !scopes.length} onPress={() => Alert.alert('Очистить данные?', scopes.includes('menu') || scopes.includes('warehouse') ? 'Также будут удалены заказы и история заведения. Эту операцию нельзя отменить.' : 'Будут удалены заказы и история. Эту операцию нельзя отменить.', [{ text: 'Отмена', style: 'cancel' }, { text: 'Очистить', style: 'destructive', onPress: () => void run(() => cleanup.mutateAsync({ id: cafe.id, scopes })) }])} /></View>
    <View style={styles.card}><Text style={styles.error} translate>Удаление заведения</Text><Field label={`Введите «${cafe.name}» для подтверждения`} value={confirmName} onChangeText={setConfirmName} /><Button size="md" variant="danger" title="Удалить заведение" disabled={busy || confirmName !== cafe.name} onPress={() => Alert.alert('Удалить заведение навсегда?', 'Все данные этого заведения будут удалены.', [{ text: 'Отмена', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: () => void run(async () => { await remove.mutateAsync({ id: cafe.id, confirmName }); onClose(); }) }])} /></View>{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </ScrollView></BottomSheet>;
}
function Monitoring() {
  const health = useHealth(); const memory = useMemory();
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={health.isRefetching || memory.isRefetching} onRefresh={() => { void health.refetch(); void memory.refetch(); }} />}><Text style={styles.heading} translate>Мониторинг приложения</Text>
    {health.isLoading ? <Loading /> : health.isError ? <PublicError message={apiError(health.error)} retry={() => void health.refetch()} /> : health.data ? <View style={styles.card}><Text style={styles.name} translate>Статус: {health.data.status}</Text><Text style={styles.muted} translate>База данных: {health.data.database}</Text><Text style={styles.muted} translate>Окружение: {health.data.env}</Text><Text style={styles.muted} translate>Версия: {health.data.commit ?? '—'}</Text><Text style={styles.muted} translate>Миграций: {health.data.migrations.appliedCount} / {health.data.migrations.localCount}</Text><Text style={styles.muted} translate>Последняя: {health.data.migrations.latestApplied ?? '—'}</Text>{health.data.migrations.behind ? <Text style={styles.error} translate>Есть неприменённые миграции</Text> : null}{health.data.migrations.failed.map(item => <Text key={item} style={styles.error}>{item}</Text>)}{health.data.error ? <Text style={styles.error}>{health.data.error}</Text> : null}</View> : null}
    {memory.isError ? <Text style={styles.error}>{apiError(memory.error)}</Text> : memory.data ? <View style={styles.card}><Text style={styles.name} translate>Память и время работы</Text><Text style={styles.muted} translate>RSS: {memory.data.rssMb} МБ</Text><Text style={styles.muted} translate>Heap: {memory.data.heapUsedMb} / {memory.data.heapTotalMb} МБ</Text><Text style={styles.muted} translate>Время работы: {Math.floor(memory.data.uptimeSec / 60)} мин</Text></View> : null}
  </ScrollView>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.background }, loginBack: { position: 'absolute', top: 12, left: 16, zIndex: 1 }, loginContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }, loginCard: { width: '100%', maxWidth: 384, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, padding: 24, gap: 12 }, loginTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary }, loginSubtitle: { fontSize: 14, color: colors.textMuted, marginTop: -8, marginBottom: 8 }, platformHeader: { paddingHorizontal: 16, paddingVertical: 12, gap: 12, backgroundColor: colors.white, borderBottomWidth: 1, borderColor: colors.border }, platformTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary }, logout: { fontSize: 14, fontWeight: '500', color: colors.textSecondary }, platformTabs: { flexDirection: 'row', alignSelf: 'flex-start', borderRadius: 8, backgroundColor: colors.background, padding: 4 }, platformTab: { borderRadius: 6, paddingHorizontal: 16, paddingVertical: 6 }, platformTabActive: { backgroundColor: colors.white, elevation: 1 }, platformTabText: { fontSize: 14, fontWeight: '500', color: colors.textMuted }, content: { padding: spacing.lg, gap: spacing.md, width: '100%', maxWidth: 1024, alignSelf: 'center' }, heading: { fontSize: 24, color: colors.textPrimary, fontWeight: '700', flexShrink: 1 }, name: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 }, muted: { fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 20 }, card: { padding: spacing.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, gap: spacing.md }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }, error: { color: colors.danger, fontSize: fontSize.sm }, link: { color: colors.primary, fontWeight: '600' }, staff: { gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderColor: colors.border } });
