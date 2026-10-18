import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Alert, Text } from '@/components/typography';
import { useRoute, type RouteProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { Button, Field, Loading } from '@/components/ui';
import { API_URL } from '@/config/env';
import { apiError } from '@/lib/api';
import type { RootStackParamList } from '@/navigation/types';
import { getGuestKey } from '@/services/api/guest';
import { getGuestPosition, joinSession, qrSessionKey, useAddItem, useQrMenu, useQrSession, useQrSubmittedOrder, useRemoveItem, useSubmitOrder, useUpdateItem, type QrDish, type QrJoinResult, type QrSubmitResult, type QrSession, type QrSessionItem } from '@/services/api/qr';
import { colors } from '@/theme';
import { money } from '@/utils/format';
import { PublicError } from './PublicLayout';
import { QrClosed, QrFrame, QrMenuPresentation, QrOrderPresentation, QrPhoto, QrQuantity, QrSubmittedPresentation } from './QrPresentation';

type StoredSubmitted = QrSubmitResult & { items?: QrSessionItem[]; totalAmount?: string; itemCount?: number };
const storageKey = (token: string) => `edu_qr_submitted_order_${token}`;

export function QrMenuScreen() {
  const { params: { tableToken } } = useRoute<RouteProp<RootStackParamList, 'QrMenu'>>();
  const qc = useQueryClient();
  const menuQ = useQrMenu(tableToken);
  const [join, setJoin] = React.useState<QrJoinResult | null>(null);
  const [joinError, setJoinError] = React.useState('');
  const [closed, setClosed] = React.useState(false);
  const [reopening, setReopening] = React.useState(false);
  const [page, setPage] = React.useState<'menu' | 'order' | 'submitted'>('menu');
  const [submitted, setSubmitted] = React.useState<StoredSubmitted | null>(null);
  const submittedRef = React.useRef(submitted);
  submittedRef.current = submitted;
  const [category, setCategory] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [dish, setDish] = React.useState<QrDish | null>(null);
  const sessionQ = useQrSession(tableToken, !!join);
  const orderQ = useQrSubmittedOrder(tableToken, submitted?.orderId ?? null, !!submitted);
  const update = useUpdateItem(tableToken);
  const remove = useRemoveItem(tableToken);
  const submit = useSubmitOrder(tableToken);
  const [error, setError] = React.useState('');
  const activeToken = React.useRef(tableToken);
  activeToken.current = tableToken;
  const sending = React.useRef(false);
  const [preparing, setPreparing] = React.useState(false);
  const session = sessionQ.data;

  React.useEffect(() => {
    let cancelled = false;
    setJoin(null); setSubmitted(null); setPage('menu'); setClosed(false); setJoinError('');
    setCategory('all'); setSearch(''); setDish(null); setError(''); setPreparing(false); sending.current = false;
    void joinSession(tableToken).then(value => { if (!cancelled) setJoin(value); }).catch(e => { if (!cancelled) setJoinError(apiError(e)); });
    void AsyncStorage.getItem(storageKey(tableToken)).then(raw => { if (!cancelled && raw) { try { const value = JSON.parse(raw); if (typeof value.orderId === 'string') setSubmitted(value); } catch {} } });
    return () => { cancelled = true; };
  }, [tableToken]);

  const onSubmitted = React.useCallback((result: QrSubmitResult) => {
    if (activeToken.current !== tableToken) return;
    const cached = qc.getQueryData<QrSession>(qrSessionKey(tableToken));
    const previous = submittedRef.current;
    const saved: StoredSubmitted = previous?.orderId === result.orderId && previous.items?.length
      ? { ...previous, ...result }
      : { ...result, items: cached?.items ?? [], totalAmount: cached?.totalAmount ?? '0', itemCount: cached?.itemCount ?? 0 };
    submittedRef.current = saved;
    setSubmitted(saved); setPage('submitted');
    void AsyncStorage.setItem(storageKey(tableToken), JSON.stringify(saved));
    void qc.invalidateQueries({ queryKey: qrSessionKey(tableToken) });
    void qc.invalidateQueries({ queryKey: ['qr', 'submitted-order', tableToken] });
  }, [qc, tableToken]);

  React.useEffect(() => {
    if (!menuQ.data?.table.id || !join) return;
    const tableId = menuQ.data.table.id;
    const socket = io(API_URL, { transports: ['websocket', 'polling'], reconnection: true });
    const enter = async () => socket.emit('qr:join', { tableId, guestKey: await getGuestKey() });
    const refresh = () => { void qc.invalidateQueries({ queryKey: ['qr', 'session', tableToken] }); void qc.invalidateQueries({ queryKey: ['qr', 'submitted-order', tableToken] }); };
    socket.on('connect', () => void enter());
    socket.on('qr:cart_updated', refresh); socket.on('qr:guest_joined', refresh); socket.on('qr:guest_left', refresh);
    socket.on('qr:order_submitted', onSubmitted); socket.on('qr:order_status_changed', refresh);
    socket.on('qr:session_closed', () => { setClosed(true); setDish(null); refresh(); });
    const heartbeat = setInterval(() => void enter(), 30_000);
    return () => { clearInterval(heartbeat); socket.emit('qr:leave', { tableId }); socket.disconnect(); };
  }, [join?.guestId, menuQ.data?.table.id, onSubmitted, qc, tableToken]);

  const reopen = async (explicit = false) => {
    setReopening(true); setError('');
    try {
      const next = await joinSession(tableToken, explicit);
      if (activeToken.current !== tableToken) return;
      setJoin(next); setClosed(next.status === 'closed'); setPage('menu');
      if (explicit) { setSubmitted(null); await AsyncStorage.removeItem(storageKey(tableToken)); }
      await qc.invalidateQueries({ queryKey: qrSessionKey(tableToken) });
    } catch (e) { if (activeToken.current === tableToken) setError(apiError(e)); } finally { if (activeToken.current === tableToken) setReopening(false); }
  };
  const changeQuantity = async (itemId: string, quantity: number) => {
    setError('');
    try { if (quantity < 1) await remove.mutateAsync(itemId); else await update.mutateAsync({ itemId, quantity }); } catch (e) { setError(apiError(e)); }
  };
  const send = async () => {
    if (sending.current) return;
    sending.current = true; setPreparing(true);
    setError('');
    try { const coords = menuQ.data?.geo.required ? await getGuestPosition() : null; if (activeToken.current !== tableToken) return; onSubmitted(await submit.mutateAsync(coords)); }
    catch (e) { if (activeToken.current === tableToken) setError(apiError(e)); }
    finally { if (activeToken.current === tableToken) { sending.current = false; setPreparing(false); } }
  };

  if (menuQ.isLoading) return <QrFrame><Loading /></QrFrame>;
  if (!menuQ.data) return <QrFrame><PublicError message="Стол не найден или ссылка устарела. Отсканируйте QR-код на столе ещё раз." retry={() => void menuQ.refetch()} /></QrFrame>;
  const menu = menuQ.data;
  const isClosed = closed || join?.status === 'closed' || session?.status === 'closed';

  return <QrFrame tableNumber={menu.table.number} page={isClosed ? 'closed' : page}>
    {isClosed ? <QrClosed reopening={reopening} onReopen={() => void reopen(true)} />
      : page === 'submitted' && submitted ? <QrSubmittedPresentation menu={menu}
        orderNumber={orderQ.data?.orderNumber ?? submitted.orderNumber} status={orderQ.data?.status ?? submitted.status}
        items={orderQ.data?.items ?? submitted.items ?? []} total={orderQ.data?.totalAmount ?? submitted.totalAmount ?? '0'}
        count={orderQ.data?.itemCount ?? submitted.itemCount ?? 0} loading={orderQ.isLoading}
        refreshing={orderQ.isRefetching} reopening={reopening} error={orderQ.isError ? apiError(orderQ.error) : undefined}
        onRefresh={() => void orderQ.refetch()} onBack={() => void reopen()} />
      : page === 'order' ? <QrOrderPresentation menu={menu} session={session} guestId={join?.guestId}
        busy={update.isPending || remove.isPending} refreshing={sessionQ.isRefetching} sending={preparing || submit.isPending}
        onRefresh={() => void sessionQ.refetch()} onQuantity={(id, quantity) => void changeQuantity(id, quantity)}
        onBack={() => setPage('menu')} onSend={() => Alert.alert('Отправить общий заказ?', 'На кухню будут отправлены позиции всех гостей этого стола.', [{ text: 'Отмена', style: 'cancel' }, { text: 'Отправить', onPress: () => void send() }])} />
      : <QrMenuPresentation menu={menu} session={session} category={category} search={search}
        joined={!!join?.guestId} hasSubmitted={!!submitted} refreshing={menuQ.isRefetching}
        onRefresh={() => void menuQ.refetch()} onCategory={setCategory} onSearch={setSearch} onDish={setDish}
        onOrder={() => setPage('order')} onSubmitted={() => setPage('submitted')} />}
    {joinError || error ? <View><Text accessibilityRole="alert" style={styles.error}>{joinError || error}</Text>{joinError ? <Button title="Повторить вход в меню" variant="secondary" onPress={() => { setJoinError(''); void joinSession(tableToken).then(value => { if (activeToken.current === tableToken) setJoin(value); }).catch(e => { if (activeToken.current === tableToken) setJoinError(apiError(e)); }); }} /> : null}</View> : null}
    <ProductSheet token={tableToken} dish={dish} geoRequired={menu.geo.required} onClose={() => setDish(null)} />
  </QrFrame>;
}

function ProductSheet({ token, dish, geoRequired, onClose }: { token: string; dish: QrDish | null; geoRequired: boolean; onClose: () => void }) {
  const [variantId, setVariantId] = React.useState(dish?.variants[0]?.id ?? '');
  const [quantity, setQuantity] = React.useState(1);
  const [comment, setComment] = React.useState('');
  const [error, setError] = React.useState('');
  const add = useAddItem(token);
  const activeToken = React.useRef(token);
  activeToken.current = token;
  const saving = React.useRef(false);
  const attempt = React.useRef(0);
  const [preparing, setPreparing] = React.useState(false);
  React.useLayoutEffect(() => {
    attempt.current += 1;
    saving.current = false; setPreparing(false);
    if (dish) { setVariantId(dish.variants[0]?.id ?? ''); setQuantity(1); setComment(''); setError(''); }
  }, [dish?.id, token]);
  React.useEffect(() => () => { attempt.current += 1; }, []);
  const variant = dish?.variants.find(item => item.id === variantId);
  const onAdd = async () => {
    if (!dish || saving.current) return;
    const currentAttempt = attempt.current;
    saving.current = true; setPreparing(true);
    try {
      setError('');
      const coords = geoRequired ? await getGuestPosition() : null;
      if (activeToken.current !== token || attempt.current !== currentAttempt) return;
      await add.mutateAsync({ dishId: dish.id, variantId: variant?.id, quantity, comment: comment.trim() || undefined, ...(coords ?? {}) });
      if (activeToken.current === token && attempt.current === currentAttempt) onClose();
    } catch (e) { if (activeToken.current === token && attempt.current === currentAttempt) setError(apiError(e)); }
    finally { if (attempt.current === currentAttempt) { saving.current = false; setPreparing(false); } }
  };
  const busy = preparing || add.isPending;
  const fromPrice = dish?.variants.length ? Math.min(...dish.variants.map(item => Number(item.price))) : Number(dish?.price ?? 0);
  return <BottomSheet visible={!!dish} onClose={onClose} sheet maxHeight="88%" panelStyle={{ width: '100%', maxWidth: 448, alignSelf: 'center', borderTopLeftRadius: 24, borderTopRightRadius: 24 }} bodyStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
    <SheetScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.productContent} keyboardShouldPersistTaps="handled">
      <View style={styles.productHeader}><QrPhoto url={dish?.imageUrl} name={dish?.name ?? ''} style={styles.productImage} /><View style={{ flex: 1, paddingTop: 4 }}><Text style={styles.productName}>{dish?.name}</Text>{dish?.description ? <Text style={styles.productDescription} numberOfLines={3}>{dish.description}</Text> : null}<Text style={styles.productPrice} translate>от {money(fromPrice)}</Text></View></View>
      {dish?.variants.length ? <View style={{ gap: 8 }}><Text style={styles.productLabel} translate>Размер</Text>{dish.variants.map(item => {
        const selected = variantId === item.id;
        return <FastPressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: busy }} disabled={busy} onPress={() => setVariantId(item.id)} style={[styles.variantRow, selected && styles.variantSelected]}><View style={styles.variantLeft}><View style={[styles.radio, selected && { borderColor: colors.primary }]}>{selected ? <View style={styles.radioDot} /> : null}</View><Text style={styles.variantName} numberOfLines={1}>{item.name}</Text></View><Text style={styles.variantPrice}>{money(item.price)}</Text></FastPressable>;
      })}</View> : null}
      <View style={styles.quantityRow}><Text style={styles.productLabel} translate>Количество</Text><QrQuantity value={quantity} disabled={busy} onChange={value => setQuantity(Math.max(1, Math.min(99, value)))} /></View>
      <Field label="Комментарий" value={comment} onChangeText={setComment} placeholder="Пожелания к блюду" multiline editable={!busy} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </SheetScrollView>
    <View style={styles.productFooter}><Button title={`Добавить · ${money(Number(variant?.price ?? dish?.price ?? 0) * quantity)}`} loading={busy} onPress={() => void onAdd()} style={{ borderRadius: 8 }} /></View>
  </BottomSheet>;
}
const styles = StyleSheet.create({
  productContent: { paddingHorizontal: 20, paddingTop: 12, gap: 16 }, productHeader: { flexDirection: 'row', gap: 16 }, productImage: { width: 112, height: 112, borderRadius: 16 }, productName: { fontSize: 18, lineHeight: 23, fontWeight: '700', color: colors.textPrimary }, productDescription: { marginTop: 8, color: colors.textSecondary, fontSize: 13, lineHeight: 20 }, productPrice: { marginTop: 12, fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  productLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary }, variantRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 10 }, variantSelected: { borderColor: colors.primary }, variantLeft: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }, radio: { height: 16, width: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, radioDot: { height: 8, width: 8, borderRadius: 4, backgroundColor: colors.primary }, variantName: { flex: 1, fontSize: 13, fontWeight: '500', color: colors.textPrimary }, variantPrice: { fontSize: 13, fontWeight: '500', color: colors.textPrimary }, quantityRow: { marginTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, productFooter: { padding: 20 }, error: { padding: 12, color: colors.danger, fontSize: 13 },
});
