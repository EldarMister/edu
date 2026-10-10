import React from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Text, TextInput } from '@/components/typography';
import { FastPressable } from '@/components/FastPressable';
import { Button, Loading } from '@/components/ui';
import { PwaIcon } from '@/components/PwaIcon';
import { NumberTicker } from '@/components/NumberTicker';
import { ScreenTransition } from '@/components/ScreenTransition';
import { API_URL } from '@/config/env';
import { colors } from '@/theme';
import { displayOrderNumber, money } from '@/utils/format';
import type { QrDish, QrMenu as QrMenuData, QrSession, QrSessionItem, QrSubmittedOrderItem } from '@/services/api/qr';

export const qrImageSource = (url: string) => ({ uri: /^(?:https?:\/\/|data:)/i.test(url) ? url : `${API_URL}${url.startsWith('/api/') ? '' : '/api'}${url.startsWith('/') ? '' : '/'}${url}` });
const plural = (value: number, forms: string[]) => {
  const count = Math.abs(value) % 100, last = count % 10;
  return forms[count > 10 && count < 20 ? 2 : last === 1 ? 0 : last > 1 && last < 5 ? 1 : 2];
};
const itemsLabel = (value: number) => `${value} ${plural(value, ['позиция', 'позиции', 'позиций'])}`;

/** Public guest screens share the same 448px frame and EDU MENU header as PWA. */
export function QrFrame({ tableNumber, children, page }: { tableNumber?: number; children: React.ReactNode; page?: string }) {
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}><View style={styles.frame}>
    <View style={styles.header}>
      <Image source={require('../../../assets/qr-menu-logo.png')} style={{ width: 100, height: 20 }} resizeMode="contain" accessibilityLabel="EDU MENU" />
      {tableNumber != null ? <View style={styles.tableBadge}><Text style={styles.tableLabel} translate>Стол {tableNumber}</Text></View> : null}
    </View>
    <ScreenTransition style={styles.flex} transitionKey={page}>{children}</ScreenTransition>
  </View></SafeAreaView>;
}

export function QrPhoto({ url, name, style }: { url: string | null | undefined; name: string; style: StyleProp<ViewStyle> }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [url]);
  return <View style={[styles.photo, style]}>{url && !failed
    ? <Image source={qrImageSource(url)} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={name} onError={() => setFailed(true)} />
    : <Svg width="40%" height="40%" viewBox="0 0 24 24" fill="none"><Path d="M3 7h18v12H3zM3 7l2-3h14l2 3M8 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0" stroke={colors.textLight} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" /></Svg>}
  </View>;
}

export function QrClosed({ reopening, onReopen }: { reopening: boolean; onReopen: () => void }) {
  return <View style={styles.closed}>
    <CheckCircle />
    <View style={{ gap: 6 }}><Text style={[styles.heading, styles.center]} translate>Заказ завершён</Text><Text style={[styles.secondary, styles.center]} translate>Спасибо, что были у нас! Этот заказ закрыт.</Text><Text style={[styles.muted, styles.center]} translate>Чтобы заказать снова, начните новый заказ.</Text></View>
    <Button size="md" title="Сделать новый заказ" loading={reopening} onPress={onReopen} style={{ width: '100%', maxWidth: 320 }} />
  </View>;
}

export function QrMenuPresentation({ menu, session, category, search, joined, hasSubmitted, refreshing, onRefresh, onCategory, onSearch, onDish, onOrder, onSubmitted }: {
  menu: QrMenuData; session?: QrSession; category: string; search: string; joined: boolean; hasSubmitted: boolean; refreshing: boolean;
  onRefresh: () => void; onCategory: (id: string) => void; onSearch: (text: string) => void; onDish: (dish: QrDish) => void; onOrder: () => void; onSubmitted: () => void;
}) {
  const query = search.trim().toLocaleLowerCase();
  const { width } = useWindowDimensions();
  const cardWidth = (Math.min(width, 448) - 44) / 2;
  const dishes = menu.dishes.filter(item => !item.isSet && item.isAvailable && (category === 'all' || item.categoryId === category) && (!query || item.name.toLocaleLowerCase().includes(query)));
  const count = session?.itemCount ?? 0;
  return <View style={styles.flex}>
    <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.searchWrap}><PwaIcon name="search" size={17} color={colors.textLight} /><TextInput value={search} onChangeText={onSearch} placeholder="Поиск по меню" accessibilityLabel="Поиск по меню" style={styles.search} /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories} keyboardShouldPersistTaps="handled">
        {[{ id: 'all', name: 'Все' }, ...menu.categories].map(item => <FastPressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: category === item.id }} onPress={() => onCategory(item.id)} style={[styles.category, category === item.id && styles.categoryActive]}><Text style={[styles.categoryLabel, category === item.id && styles.white]} translate={item.id === 'all'}>{item.name}</Text></FastPressable>)}
      </ScrollView>
      {dishes.length ? <View style={styles.dishes}>{dishes.map(item => <FastPressable key={item.id} accessibilityRole="button" disabled={!joined} onPress={() => onDish(item)} style={[styles.dishCard, { width: cardWidth }]}>
        <QrPhoto url={item.imageUrl} name={item.name} style={{ width: '100%', aspectRatio: 4 / 3 }} />
        <View style={styles.dishBody}><Text style={styles.dishName} numberOfLines={2}>{item.name}</Text>{item.description ? <Text style={styles.description} numberOfLines={2}>{item.description}</Text> : null}<Text style={styles.dishPrice} translate>{item.variants.length ? 'от ' : ''}{money(item.variants.length ? Math.min(...item.variants.map(variant => Number(variant.price))) : item.price)}</Text></View>
      </FastPressable>)}</View> : <Text style={styles.nothing} translate>Ничего не найдено</Text>}
      <Text style={styles.disclaimer} translate>Фото блюд могут незначительно отличаться от реального вида.</Text><Text style={[styles.disclaimer, { paddingTop: 0 }]} translate>Тамак-аштардын сүрөттөрү чыныгы көрүнүштөн бир аз айырмаланышы мүмкүн.</Text>
      <View style={{ height: hasSubmitted && !count ? 96 : 24 }} />
    </ScrollView>
    {count || hasSubmitted ? <View style={[styles.menuFooter, !count && styles.historyOnly]} pointerEvents="box-none">
      {count ? <View style={styles.cartPanel}>
        <FastPressable onPress={onOrder} style={styles.cartLeft} accessibilityRole="button"><PwaIcon name="bag" size={24} color={colors.white} /><View style={styles.flex}><Text numberOfLines={1} style={styles.cartTitle} translate>{(session?.activeGuestCount ?? 0) > 1 ? 'Общий заказ' : 'Корзина'}</Text><View style={styles.inline}><Text style={styles.cartSubtitle} translate>{itemsLabel(count)} · </Text><NumberTicker value={Number(session?.totalAmount ?? 0)} style={styles.cartSubtitle} digitHeight={17} /></View></View></FastPressable>
        {hasSubmitted ? <View style={{ width: 76 }} /> : null}<FastPressable onPress={onOrder} style={styles.cartOpen} accessibilityRole="button"><Text style={styles.cartTitle} translate>Открыть</Text></FastPressable>
      </View> : null}
      {hasSubmitted ? <View style={[styles.historyWrap, !!count && styles.historyRaised]} pointerEvents="box-none"><View style={styles.historyNotch}><FastPressable onPress={onSubmitted} style={styles.historyButton} accessibilityRole="button" accessibilityLabel="Мои заказы"><PwaIcon name="bag" size={17} color="#1E40AF" /><Text style={styles.historyLabel} translate>Мои заказы</Text></FastPressable></View></View> : null}
    </View> : null}
  </View>;
}

export function QrQuantity({ value, onChange, disabled, small = false }: { value: number; onChange: (value: number) => void; disabled?: boolean; small?: boolean }) {
  const size = small ? 32 : 40;
  return <View style={styles.stepper}>
    <FastPressable accessibilityLabel="Меньше" disabled={disabled || value <= 1} onPress={() => onChange(Math.max(1, value - 1))} style={[styles.stepperButton, { width: size, height: size }, (disabled || value <= 1) && { opacity: 0.4 }]}><Text style={styles.stepperText}>−</Text></FastPressable>
    <Text style={[styles.quantity, small && { fontSize: 13 }]}>{value}</Text>
    <FastPressable accessibilityLabel="Больше" disabled={disabled} onPress={() => onChange(value + 1)} style={[styles.stepperButton, { width: size, height: size }, disabled && { opacity: 0.4 }]}><Text style={styles.stepperText}>+</Text></FastPressable>
  </View>;
}

export function QrOrderPresentation({ menu, session, guestId, busy, refreshing, sending, onRefresh, onQuantity, onBack, onSend }: {
  menu: QrMenuData; session?: QrSession; guestId?: string; busy: boolean; refreshing: boolean; sending: boolean; onRefresh: () => void; onQuantity: (id: string, value: number) => void; onBack: () => void; onSend: () => void;
}) {
  const groups = (session?.guests ?? []).map(guest => ({ guest, items: session?.items.filter(item => item.guestId === guest.id) ?? [] })).filter(group => group.items.length);
  const shared = (session?.activeGuestCount ?? 0) > 1;
  const renderItem = (item: QrSessionItem) => {
    const own = item.guestId === guestId;
    return <View key={item.id} style={styles.orderItem}>
      <QrPhoto url={menu.dishes.find(dish => dish.id === item.dishId)?.imageUrl} name={item.name} style={styles.itemPhoto} />
      <View style={styles.flex}><Text style={styles.itemName}>{item.name}</Text>{item.variantName ? <Text style={styles.variant}><Text translate>Размер: </Text>{item.variantName}</Text> : null}<Text style={styles.muted}>{item.quantity} × {money(item.price)}</Text>{item.comment ? <Text style={styles.variant}>{item.comment}</Text> : null}</View>
      {own ? <View style={styles.ownItem}><QrQuantity value={item.quantity} disabled={busy || sending} small onChange={value => onQuantity(item.id, value)} /><NumberTicker value={Number(item.lineTotal)} style={styles.itemAmount} digitHeight={18} /><FastPressable accessibilityRole="button" disabled={busy || sending} onPress={() => onQuantity(item.id, 0)}><Text style={styles.remove} translate>Удалить</Text></FastPressable></View> : <Text style={styles.otherAmount}>{money(item.lineTotal)}</Text>}
    </View>;
  };
  return <View style={styles.flex}>
    <ScrollView style={styles.flex} contentContainerStyle={styles.orderContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.pageTitle}><FastPressable accessibilityRole="button" accessibilityLabel="Назад в меню" onPress={onBack} style={styles.back}><PwaIcon name="chevronLeft" size={20} color={colors.textSecondary} /></FastPressable><Text style={styles.heading} translate>{shared ? 'Заказ' : 'Корзина'}</Text></View>
      {shared ? <View style={styles.guestsBadge}><PwaIcon name="user" size={15} color={colors.textSecondary} /><Text style={styles.secondary} translate>За столом: {groups.length} {plural(groups.length, ['гость', 'гостя', 'гостей'])}</Text></View> : null}
      <View style={{ gap: 16 }}>{shared ? groups.map((group, index) => <View style={styles.group} key={group.guest.id}><View style={styles.groupHeader}><View style={styles.inline}><Text style={styles.guestName} translate>Гость {index + 1}</Text>{group.guest.id === guestId ? <View style={styles.youBadge}><Text style={styles.youLabel} translate>вы</Text></View> : null}</View><View style={[styles.online, !group.guest.isOnline && { backgroundColor: colors.textLight }]} /></View>{group.items.map(renderItem)}</View>) : session?.items.length ? <View style={styles.group}>{session.items.map(renderItem)}</View> : <Text style={styles.nothing} translate>Заказ пока пуст. Выберите блюда в меню.</Text>}</View>
    </ScrollView>
    <View style={styles.footer}><OrderTotal total={session?.totalAmount ?? '0'} count={session?.itemCount ?? 0} /><Button title={`${shared ? 'Отправить заказ' : 'Отправить'} · ${money(session?.totalAmount ?? '0')}`} disabled={!session?.items.length || !guestId || busy} loading={sending} onPress={onSend} style={styles.actionButton} /></View>
  </View>;
}

export type SubmittedDisplayItem = QrSessionItem | QrSubmittedOrderItem;
export function QrSubmittedPresentation({ menu, orderNumber, status, items, total, count, loading, refreshing, reopening, error, onRefresh, onBack }: {
  menu: QrMenuData; orderNumber: string; status: string; items: SubmittedDisplayItem[]; total: string; count: number; loading: boolean; refreshing: boolean; reopening: boolean; error?: string; onRefresh: () => void; onBack: () => void;
}) {
  const current = status === 'cooking' ? 1 : status === 'ready' ? 2 : ['served', 'picked_up', 'paid'].includes(status) ? 3 : 0;
  return <View style={styles.flex}>
    <ScrollView style={styles.flex} contentContainerStyle={styles.submittedContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.heading} translate>Мои заказы</Text>
      <View style={styles.confirmation}><CheckCircle /><Text style={styles.sentHeading} translate>Заказ отправлен</Text><Text style={styles.secondary} translate>Ваш общий заказ принят</Text><Text style={[styles.muted, { marginTop: 12 }]} translate>Номер заказа</Text><Text style={styles.orderNumber}>{displayOrderNumber(orderNumber)}</Text></View>
      <View style={styles.statusCard}><Text style={styles.sectionLabel} translate>Статус заказа</Text>{['Принят', 'Готовится', 'Готов', 'Подан'].map((label, index) => <View key={label} style={styles.statusRow}><View style={[styles.statusCircle, index < current ? styles.done : index === current ? styles.active : styles.future]}>{index < current ? <PwaIcon name="check" size={15} color={colors.white} strokeWidth={3} /> : <Text style={[styles.statusIndex, index <= current && styles.white]}>{index + 1}</Text>}</View><Text style={[styles.statusText, index === current ? styles.statusCurrent : index < current ? styles.secondary : styles.muted]} translate>{label}</Text>{index === current ? <View style={styles.activeDot} /> : null}</View>)}</View>
      {loading && !items.length ? <Loading /> : null}{error ? <View style={styles.errorBox}><Text style={styles.error}>{error}</Text><Button title="Повторить" variant="secondary" size="md" onPress={onRefresh} /></View> : null}
      {items.length ? <View style={styles.group}><Text style={[styles.sectionLabel, { padding: 16, paddingBottom: 8 }]} translate>Состав заказа</Text>{items.map(item => {
        const badge = 'status' in item ? itemStatusBadge(item.status) : null;
        return <View key={item.id} style={styles.orderItem}><QrPhoto url={menu.dishes.find(dish => dish.id === item.dishId)?.imageUrl} name={item.name} style={styles.itemPhoto} /><View style={styles.flex}><Text style={styles.itemName}>{item.name}</Text>{badge ? <View style={[styles.itemBadge, { backgroundColor: badge.background }]}><Text style={[styles.itemBadgeText, { color: badge.color }]} translate>{badge.label}</Text></View> : null}{item.variantName ? <Text style={styles.variant}><Text translate>Размер: </Text>{item.variantName}</Text> : null}<Text style={styles.muted}>{item.quantity} × {money(item.price)}</Text></View><Text style={styles.otherAmount}>{money(item.lineTotal)}</Text></View>;
      })}</View> : null}
    </ScrollView>
    <View style={styles.footer}>{items.length ? <OrderTotal total={total} count={count} /> : null}<Button title="Вернуться в меню" loading={reopening} onPress={onBack} style={styles.actionButton} /></View>
  </View>;
}

function itemStatusBadge(status: string) {
  if (status === 'ready') return { label: 'Готов', background: colors.successSoft, color: colors.success };
  if (status === 'rejected' || status === 'cancelled') return { label: status === 'rejected' ? 'Отказано' : 'Отменено', background: colors.dangerSoft, color: colors.danger };
  if (status === 'served') return { label: 'Подан', background: colors.background, color: colors.textMuted };
  if (status === 'accepted' || status === 'cooking') return { label: 'Готовится', background: colors.warningSoft, color: colors.warning };
  return { label: 'Отправлен на кухню', background: colors.primarySoft, color: colors.primary };
}
function OrderTotal({ total, count }: { total: string; count: number }) {
  return <View style={styles.total}><View><Text style={styles.totalLabel} translate>Итого к оплате</Text><NumberTicker value={Number(total)} style={styles.totalAmount} digitHeight={30} /></View><Text style={styles.muted} translate>{itemsLabel(count)}</Text></View>;
}
function CheckCircle() { return <ScreenTransition><View style={styles.checkCircle}><PwaIcon name="check" size={32} color={colors.success} strokeWidth={2.4} /></View></ScreenTransition>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, frame: { flex: 1, width: '100%', maxWidth: 448, alignSelf: 'center' }, flex: { flex: 1 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border }, tableBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.background }, tableLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  photo: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, overflow: 'hidden' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 16, paddingHorizontal: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }, search: { flex: 1, height: 44, fontSize: 14, color: colors.textPrimary, padding: 0 },
  categories: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }, category: { paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.white }, categoryActive: { backgroundColor: colors.primary, borderColor: colors.primary }, categoryLabel: { fontSize: 14, fontWeight: '500', color: colors.textSecondary }, white: { color: colors.white },
  dishes: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }, dishCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, overflow: 'hidden' }, dishBody: { flex: 1, padding: 12 }, dishName: { fontSize: 14, fontWeight: '600', lineHeight: 18, color: colors.textPrimary }, description: { fontSize: 12, lineHeight: 15, color: colors.textMuted, marginTop: 4 }, dishPrice: { marginTop: 8, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  disclaimer: { fontSize: 11, lineHeight: 16, color: colors.textLight, textAlign: 'center', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 }, nothing: { paddingHorizontal: 16, paddingVertical: 64, textAlign: 'center', color: colors.textMuted, fontSize: 13 },
  menuFooter: { position: 'relative' }, historyOnly: { position: 'absolute', bottom: 8, left: 0, right: 0 }, cartPanel: { marginHorizontal: 12, borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: colors.primary, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', minHeight: 72 }, cartLeft: { flex: 1, minWidth: 0, flexDirection: 'row', gap: 10, alignItems: 'center' }, cartTitle: { fontSize: 15, fontWeight: '700', color: colors.white, lineHeight: 19 }, cartSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 17 }, cartOpen: { flex: 1, alignItems: 'flex-end' },
  historyWrap: { alignItems: 'center' }, historyRaised: { position: 'absolute', top: -20, left: 0, right: 0 }, historyNotch: { borderRadius: 999, padding: 3, backgroundColor: colors.background }, historyButton: { height: 64, width: 64, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.9)', elevation: 3, shadowColor: '#0F172A', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 2 } }, historyLabel: { fontSize: 10, fontWeight: '600', color: colors.textPrimary },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 }, heading: { fontSize: 19, fontWeight: '700', color: colors.textPrimary }, secondary: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 }, muted: { fontSize: 13, color: colors.textMuted, lineHeight: 18 }, center: { textAlign: 'center' },
  pageTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 }, back: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }, orderContent: { padding: 16, gap: 16 }, guestsBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.background, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  group: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, overflow: 'hidden' }, groupHeader: { paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, guestName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary }, youBadge: { borderRadius: 999, backgroundColor: colors.primarySoft, paddingHorizontal: 8, paddingVertical: 2 }, youLabel: { fontSize: 11, fontWeight: '500', color: colors.primary }, online: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  orderItem: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 16, paddingVertical: 12 }, itemPhoto: { width: 48, height: 48, borderRadius: 8 }, itemName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, lineHeight: 18 }, variant: { fontSize: 12, color: colors.textMuted, lineHeight: 17 }, ownItem: { alignItems: 'flex-end', gap: 6 }, itemAmount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary }, otherAmount: { fontSize: 15, fontWeight: '700', color: colors.textPrimary }, remove: { fontSize: 12, fontWeight: '500', color: colors.danger },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 }, stepperButton: { borderRadius: 999, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, stepperText: { fontSize: 18, fontWeight: '600', color: colors.primary }, quantity: { minWidth: 24, textAlign: 'center', fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  footer: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.white, padding: 16, paddingVertical: 12 }, total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 }, totalLabel: { fontSize: 12, color: colors.textMuted }, totalAmount: { fontSize: 22, fontWeight: '700', color: colors.textPrimary }, actionButton: { borderRadius: 8 },
  closed: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 }, checkCircle: { height: 64, width: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successSoft }, submittedContent: { padding: 16, gap: 16 }, confirmation: { alignItems: 'center', marginTop: -4 }, sentHeading: { marginTop: 12, fontSize: 18, fontWeight: '700', color: colors.textPrimary }, orderNumber: { fontSize: 26, fontWeight: '700', color: colors.primary },
  statusCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, backgroundColor: colors.white, gap: 12, marginTop: 4 }, sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted }, statusRow: { flexDirection: 'row', gap: 12, alignItems: 'center' }, statusCircle: { height: 28, width: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, done: { backgroundColor: colors.success }, active: { backgroundColor: colors.primary }, future: { backgroundColor: colors.background }, statusIndex: { fontSize: 12, fontWeight: '600', color: colors.textLight }, statusText: { fontSize: 15, color: colors.textMuted }, statusCurrent: { fontWeight: '600', color: colors.textPrimary }, activeDot: { height: 8, width: 8, borderRadius: 4, marginLeft: 'auto', backgroundColor: colors.primary }, itemBadge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 3, marginBottom: 1 }, itemBadgeText: { fontSize: 10, fontWeight: '600' }, errorBox: { gap: 8 }, error: { color: colors.danger, fontSize: 13 },
});
